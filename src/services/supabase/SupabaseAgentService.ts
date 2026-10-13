import { AgentLimitError, AgentUnavailableError, MAX_MESSAGE_CHARS } from "../agent-errors";
import type { AgentConversation, AgentMessage, AgentPort } from "../ports";
import type { SupabaseFunctionsClient } from "./SupabaseLeadService";

/** Longer than the function's own 25-second turn budget plus a tool call. */
export const CHAT_REQUEST_TIMEOUT_MS = 40_000;

interface LocalConversation {
  agent: string;
  metadata: Record<string, unknown>;
  serverId: string | null;
  token: string | null;
  messages: AgentMessage[];
  listeners: Set<(messages: AgentMessage[]) => void>;
}

interface ChatAnswer {
  ok?: boolean;
  rid?: string;
  code?: string;
  conversationId?: string;
  token?: string;
  reply?: string;
  leadSaved?: boolean;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The on-site agents on the `chat` Edge Function: one POST per message, the
 * whole reply in its answer. Keeps AgentPort's shape — `start` makes a local
 * handle (the server conversation is created by the first send), `send` posts
 * and hands the transcript to whoever `subscribe`d.
 */
export class SupabaseAgentService implements AgentPort {
  private readonly conversations = new Map<string, LocalConversation>();

  constructor(
    private readonly client: SupabaseFunctionsClient,
    private readonly newId: () => string = () => `chat_${crypto.randomUUID()}`,
  ) {}

  async start(agentName: string, metadata: Record<string, unknown> = {}): Promise<AgentConversation> {
    const id = this.newId();
    this.conversations.set(id, { agent: agentName, metadata, serverId: null, token: null, messages: [], listeners: new Set() });
    return { id };
  }

  async send(conversation: AgentConversation, text: string): Promise<void> {
    const local = this.conversations.get(conversation.id);
    if (!local) throw new Error("agent_conversation_gone");
    if (text.length > MAX_MESSAGE_CHARS) throw new AgentLimitError("too_long");

    const m = local.metadata;
    const body: Record<string, unknown> = local.serverId
      ? { agent: local.agent, conversationId: local.serverId, token: local.token, message: text }
      : {
          agent: local.agent,
          message: text,
          consentVersion: str(m.consent_version),
          consentAt: str(m.consent_at),
          attribution: { channel: str(m.channel), campaign: str(m.campaign), landingPath: str(m.landing_path) },
        };

    const { data, error } = await withTimeout(this.client.functions.invoke("chat", { body }), CHAT_REQUEST_TIMEOUT_MS);
    if (error) throw await this.failure(local, error);
    const answer = (data ?? {}) as ChatAnswer;
    if (answer.ok !== true || typeof answer.reply !== "string") throw new AgentUnavailableError(answer.rid);
    if (answer.conversationId) local.serverId = answer.conversationId;
    if (answer.token) local.token = answer.token;
    local.messages = [
      ...local.messages,
      { role: "user", content: text },
      { role: "assistant", content: answer.reply, ...(answer.leadSaved ? { signal: "lead_saved" as const } : {}) },
    ];
    for (const listener of local.listeners) listener(local.messages);
  }

  subscribe(conversationId: string, onMessages: (messages: AgentMessage[]) => void): () => void {
    const local = this.conversations.get(conversationId);
    if (!local) return () => undefined;
    local.listeners.add(onMessages);
    if (local.messages.length) onMessages(local.messages);
    return () => local.listeners.delete(onMessages);
  }

  private async failure(local: LocalConversation, error: { message: string; context?: unknown }): Promise<Error> {
    const res = error.context instanceof Response ? error.context : null;
    const body = (res ? await res.json().catch(() => null) : null) as ChatAnswer | null;
    // A 503 may already have opened the conversation; keep it so the next message continues it.
    if (body?.conversationId) local.serverId = body.conversationId;
    if (body?.token) local.token = body.token;
    if (body?.code === "too_long") return new AgentLimitError("too_long");
    if (body?.code === "too_many_turns") return new AgentLimitError("too_many_turns");
    if (res?.status === 429) return new AgentLimitError("rate_limited");
    if (body?.code === "gone" || body?.code === "closed") {
      local.serverId = null;
      local.token = null;
      return new AgentLimitError("conversation_closed");
    }
    return new AgentUnavailableError(body?.rid);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AgentUnavailableError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
