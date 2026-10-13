import type { AgentConversation, AgentMessage, AgentPort } from "./ports";

/**
 * Each agent to whoever serves it: the `chat` function for the agents in
 * `VITE_CHAT_AGENTS`, Base44 for the rest. A conversation stays with the
 * adapter that started it.
 */
export class RoutedAgentService implements AgentPort {
  private readonly owner = new Map<string, AgentPort>();

  constructor(
    private readonly fallback: AgentPort,
    private readonly chat: AgentPort | null,
    private readonly served: ReadonlySet<string>,
  ) {}

  async start(agentName: string, metadata?: Record<string, unknown>): Promise<AgentConversation> {
    const port = this.chat && this.served.has(agentName) ? this.chat : this.fallback;
    const conversation = await port.start(agentName, metadata);
    this.owner.set(conversation.id, port);
    return conversation;
  }

  send(conversation: AgentConversation, text: string): Promise<void> {
    return (this.owner.get(conversation.id) ?? this.fallback).send(conversation, text);
  }

  subscribe(conversationId: string, onMessages: (messages: AgentMessage[]) => void): () => void {
    return (this.owner.get(conversationId) ?? this.fallback).subscribe(conversationId, onMessages);
  }
}
