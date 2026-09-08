import type { AgentConversation, AgentMessage, AgentPort } from "../ports";

export interface AgentClient {
  agents: {
    createConversation(input: { agent_name: string; metadata?: Record<string, unknown> }): Promise<{ id: string }>;
    getConversation(id: string): Promise<unknown>;
    addMessage(conversation: unknown, message: { role: string; content: string }): Promise<unknown>;
    subscribeToConversation(id: string, cb: (data: { messages?: AgentMessage[] }) => void): () => void;
  };
}

/**
 * Adapter over the Base44 agent runtime.
 *
 * It also enforces the one guardrail the browser can enforce: a cap on message
 * length and on how many turns a single anonymous visitor may take. That is not
 * a substitute for server-side rate limiting — see docs — but it removes the
 * trivial abuse path of pasting a novel into a public LLM endpoint.
 */
export const MAX_MESSAGE_CHARS = 1000;
export const MAX_TURNS_PER_CONVERSATION = 40;

export class AgentLimitError extends Error {
  constructor(public readonly reason: "too_long" | "too_many_turns") {
    super(reason);
    this.name = "AgentLimitError";
  }
}

export class Base44AgentService implements AgentPort {
  private turns = new Map<string, number>();

  constructor(private readonly client: AgentClient) {}

  async start(agentName: string, metadata?: Record<string, unknown>): Promise<AgentConversation> {
    const conv = await this.client.agents.createConversation({ agent_name: agentName, metadata });
    this.turns.set(conv.id, 0);
    return { id: conv.id };
  }

  async send(conversation: AgentConversation, text: string): Promise<void> {
    if (text.length > MAX_MESSAGE_CHARS) throw new AgentLimitError("too_long");

    const used = this.turns.get(conversation.id) ?? 0;
    if (used >= MAX_TURNS_PER_CONVERSATION) throw new AgentLimitError("too_many_turns");
    this.turns.set(conversation.id, used + 1);

    const conv = await this.client.agents.getConversation(conversation.id);
    await this.client.agents.addMessage(conv, { role: "user", content: text });
  }

  subscribe(conversationId: string, onMessages: (messages: AgentMessage[]) => void): () => void {
    return this.client.agents.subscribeToConversation(conversationId, (data) =>
      onMessages(data.messages ?? [])
    );
  }
}
