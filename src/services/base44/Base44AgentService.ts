import type { AgentConversation, AgentMessage, AgentPort } from "../ports";

/** All this adapter needs of a conversation, and all the runtime promises. */
export interface ConversationRef {
  id: string;
}

/**
 * A message as the runtime actually sends it, which is wider than `AgentMessage`
 * in three ways that matter — see `visibleMessages`.
 */
export interface RawAgentMessage {
  role?: string;
  content?: unknown;
  hidden?: boolean;
}

export interface AgentClient {
  agents: {
    createConversation(input: { agent_name: string; metadata?: Record<string, unknown> }): Promise<{ id: string }>;
    /** `undefined` when the id no longer resolves — the SDK says so, so do we. */
    getConversation(id: string): Promise<ConversationRef | undefined>;
    addMessage(conversation: ConversationRef, message: { role: string; content: string }): Promise<unknown>;
    subscribeToConversation(id: string, cb: (data: { messages?: RawAgentMessage[] }) => void): () => void;
  };
}

/**
 * What the visitor is allowed to see, which is narrower than what arrives.
 *
 * The runtime's message type is `role: "user" | "assistant" | "system"`,
 * `content?: string | Record<string, any>` and `hidden?: boolean`. Passing that
 * through unfiltered — which is what this adapter used to do — means three
 * things, in rising order of cost:
 *
 *   - `content` as an object reaches `<ReactMarkdown>`, which throws "Objects
 *     are not valid as a React child". There is no error boundary above this
 *     chat, so that is a white page.
 *   - a `system` message fails the `role === "user"` test in the component and
 *     is rendered in an assistant bubble — the visitor is shown scaffolding as
 *     though the agent said it.
 *   - a message the platform marked `hidden` is displayed. On a chat whose tool
 *     payloads carry a visitor's name, phone and life circumstances, that is the
 *     one default worth getting right without being asked.
 *
 * Translating the vendor's shape into the app's is the whole job of an adapter,
 * and this is the translation it exists to perform.
 */
export const visibleMessages = (messages: RawAgentMessage[]): AgentMessage[] =>
  messages.flatMap((m) =>
    (m.role === "user" || m.role === "assistant") &&
    typeof m.content === "string" &&
    m.content.length > 0 &&
    !m.hidden
      ? [{ role: m.role, content: m.content }]
      : []
  );

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

    const conv = await this.client.agents.getConversation(conversation.id);
    // The id stopped resolving — a redeploy, an expiry, a tab left open over a
    // weekend. Say so here rather than hand `undefined` to the SDK and fail
    // somewhere inside axios with a message nobody sees.
    if (!conv) throw new Error("agent_conversation_gone");
    await this.client.agents.addMessage(conv, { role: "user", content: text });

    // Counted after the call, not before. The cap exists to bound how many
    // times a visitor can invoke the model, and a send that threw invoked it
    // zero times. Charging for it means a backend outage eventually reports
    // itself as "השיחה הגיעה לאורכה המרבי" — a second, differently wrong
    // diagnosis, and the one message that would stop them retrying.
    this.turns.set(conversation.id, used + 1);
  }

  subscribe(conversationId: string, onMessages: (messages: AgentMessage[]) => void): () => void {
    return this.client.agents.subscribeToConversation(conversationId, (data) =>
      onMessages(visibleMessages(data.messages ?? []))
    );
  }
}
