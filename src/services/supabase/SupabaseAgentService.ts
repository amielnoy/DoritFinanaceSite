import { AgentLimitError, AgentUnavailableError, LEAD_SAVED_WITHOUT_REPLY, MAX_MESSAGE_CHARS } from "../agent-errors";
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

/** A refusal that still saved the lead: the send succeeded as far as the visitor is concerned. */
const SAVED = Symbol("lead_saved");

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

    // On screen at once, not after the reply (up to 25 s): the visitor sees what was sent.
    const sent: AgentMessage = { role: "user", content: text };
    this.publish(local, [...local.messages, sent]);
    try {
      const { data, error } = await this.invokeWithin(local, body);
      if (error) {
        const failed = await this.failure(local, error);
        if (failed !== SAVED) throw failed;
        // The lead is saved; only the reply was lost. Not a failure to the visitor.
        this.publish(local, [...local.messages, { role: "assistant", content: LEAD_SAVED_WITHOUT_REPLY, signal: "lead_saved", replyMissing: true }]);
        return;
      }
      const answer = (data ?? {}) as ChatAnswer;
      if (answer.ok !== true || typeof answer.reply !== "string") throw new AgentUnavailableError(answer.rid);
      if (answer.conversationId) local.serverId = answer.conversationId;
      if (answer.token) local.token = answer.token;
      this.publish(local, [
        ...local.messages,
        { role: "assistant", content: answer.reply, ...(answer.leadSaved ? { signal: "lead_saved" as const } : {}) },
      ]);
    } catch (e) {
      // Not sent after all: off the screen, and AgentChat puts the text back in the box.
      this.publish(local, local.messages.filter((m) => m !== sent));
      throw e;
    }
  }

  private publish(local: LocalConversation, messages: AgentMessage[]): void {
    local.messages = messages;
    for (const listener of local.listeners) listener(local.messages);
  }

  subscribe(conversationId: string, onMessages: (messages: AgentMessage[]) => void): () => void {
    const local = this.conversations.get(conversationId);
    if (!local) return () => undefined;
    local.listeners.add(onMessages);
    if (local.messages.length) onMessages(local.messages);
    return () => local.listeners.delete(onMessages);
  }

  private async failure(local: LocalConversation, error: { message: string; context?: unknown }): Promise<Error | typeof SAVED> {
    const res = error.context instanceof Response ? error.context : null;
    const body = (res ? await res.json().catch(() => null) : null) as ChatAnswer | null;
    // A 503 may already have opened the conversation; keep it so the next message continues it.
    if (body?.conversationId) local.serverId = body.conversationId;
    if (body?.token) local.token = body.token;
    // A turn whose tool saved the lead and whose closing reply then failed.
    if (body?.leadSaved === true) return SAVED;
    if (body?.code === "too_long") return new AgentLimitError("too_long");
    if (body?.code === "too_many_turns") return new AgentLimitError("too_many_turns");
    // The function answers one message per conversation at a time; this one was not run.
    if (body?.code === "busy") return new AgentLimitError("busy");
    if (res?.status === 429) return new AgentLimitError("rate_limited");
    if (body?.code === "gone" || body?.code === "closed") {
      local.serverId = null;
      local.token = null;
      return new AgentLimitError("conversation_closed");
    }
    return new AgentUnavailableError(body?.rid);
  }

  /**
   * One request, cancelled at the timeout. The abort can arrive after the server
   * committed the turn, so a late answer still gives the conversation its ids:
   * the next message continues it instead of opening a second one. The late
   * reply's text is dropped; the visitor was already told it failed.
   */
  private invokeWithin(local: LocalConversation, body: Record<string, unknown>) {
    const controller = new AbortController();
    const request = this.client.functions.invoke("chat", { body, signal: controller.signal });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        void request.then(
          async ({ data, error }) => {
            const res = error?.context instanceof Response ? error.context : null;
            const late = (res ? await res.json().catch(() => null) : data) as ChatAnswer | null;
            if (!local.serverId && late?.conversationId && late.token) {
              local.serverId = late.conversationId;
              local.token = late.token;
            }
          },
          () => undefined,
        );
        reject(new AgentUnavailableError());
      }, CHAT_REQUEST_TIMEOUT_MS);
    });
    return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
  }
}
