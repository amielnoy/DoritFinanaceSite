import { AgentLimitError, AgentUnavailableError, LEAD_SAVED_WITHOUT_REPLY, MAX_MESSAGE_CHARS } from "../agent-errors";
import type { AgentConversation, AgentMessage, AgentPort } from "../ports";
import type { SupabaseFunctionsClient } from "./SupabaseLeadService";

/** Longer than the function's own 25-second turn budget plus a tool call. */
export const CHAT_REQUEST_TIMEOUT_MS = 40_000;
/** After a timeout, how often the adapter asks how the turn ended, and for how long. */
export const STATUS_POLL_MS = 3_000;
export const STATUS_RECOVERY_MS = 60_000;
/** One status request's own wait: it runs no turn, so it answers at once or not at all. */
export const STATUS_REQUEST_TIMEOUT_MS = 10_000;

/** The wait ran out; the turn may still be running on the server. */
class TimedOut extends AgentUnavailableError {}

interface LocalConversation {
  agent: string;
  metadata: Record<string, unknown>;
  /** The conversation's id and token, made here before the first message (review 2026-10-15). */
  serverId: string;
  token: string;
  /** Whether the function has answered for the row; until then each message carries the consent that opens it. */
  opened: boolean;
  /** The number of the server's last turn this page knows of; a status request names the next. */
  turns: number;
  messages: AgentMessage[];
  listeners: Set<(messages: AgentMessage[]) => void>;
}

interface ChatAnswer {
  ok?: boolean;
  rid?: string;
  code?: string;
  conversationId?: string;
  /** This turn's number in the conversation. */
  turn?: number;
  reply?: string;
  leadSaved?: boolean;
  /** The articles the blog recommender's turn highlighted (recommendArticles). */
  recommended?: unknown;
}

/**
 * The reply as the page reads it. The blog page has one protocol for both
 * backends — the ```recommended block (src/lib/blog-recommendation.ts), which
 * Base44's agent writes itself — so the function's `recommended` list is
 * written into the same block here. A reply that already carries one keeps it,
 * and gets no second.
 */
function withRecommendation(reply: string, recommended: unknown): string {
  if (!Array.isArray(recommended)) return reply;
  const slugs = recommended.filter((s): s is string => typeof s === "string" && s.length > 0);
  if (slugs.length === 0 || reply.includes("```recommended")) return reply;
  return `${reply}\n\n\`\`\`recommended\n${JSON.stringify(slugs)}\n\`\`\``;
}

/** A refusal that still saved the lead: the send succeeded as far as the visitor is concerned. */
const SAVED = Symbol("lead_saved");

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A conversation's id and the token only this page holds: a random uuid, and 32 random bytes as hex. */
export interface ConversationKeys {
  id: string;
  token: string;
}

function newKeys(): ConversationKeys {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return { id: crypto.randomUUID(), token: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") };
}

/**
 * The on-site agents on the `chat` Edge Function: one POST per message, the
 * whole reply in its answer. Keeps AgentPort's shape — `start` makes a local
 * handle and the conversation's id and token (the function opens the row on
 * the first send), `send` posts and hands the transcript to whoever
 * `subscribe`d.
 */
export class SupabaseAgentService implements AgentPort {
  private readonly conversations = new Map<string, LocalConversation>();

  constructor(
    private readonly client: SupabaseFunctionsClient,
    private readonly newId: () => string = () => `chat_${crypto.randomUUID()}`,
    private readonly makeKeys: () => ConversationKeys = newKeys,
  ) {}

  async start(agentName: string, metadata: Record<string, unknown> = {}): Promise<AgentConversation> {
    const id = this.newId();
    const keys = this.makeKeys();
    this.conversations.set(id, { agent: agentName, metadata, serverId: keys.id, token: keys.token, opened: false, turns: 0, messages: [], listeners: new Set() });
    return { id };
  }

  async send(conversation: AgentConversation, text: string): Promise<void> {
    const local = this.conversations.get(conversation.id);
    if (!local) throw new Error("agent_conversation_gone");
    if (text.length > MAX_MESSAGE_CHARS) throw new AgentLimitError("too_long");

    const m = local.metadata;
    const ids = { agent: local.agent, conversationId: local.serverId, token: local.token, message: text };
    const body: Record<string, unknown> = local.opened
      ? ids
      : {
          ...ids,
          consentVersion: str(m.consent_version),
          consentAt: str(m.consent_at),
          attribution: { channel: str(m.channel), campaign: str(m.campaign), landingPath: str(m.landing_path) },
        };
    // On screen at once, not after the reply (up to 25 s): the visitor sees what was sent.
    const sent: AgentMessage = { role: "user", content: text };
    this.publish(local, [...local.messages, sent]);
    try {
      const { data, error } = await this.invokeWithin(body, CHAT_REQUEST_TIMEOUT_MS);
      if (error) {
        const failed = await this.failure(local, error);
        if (failed !== SAVED) throw failed;
        // The lead is saved; only the reply was lost. Not a failure to the visitor.
        this.publish(local, [...local.messages, { role: "assistant", content: LEAD_SAVED_WITHOUT_REPLY, signal: "lead_saved", replyMissing: true }]);
        return;
      }
      const answer = (data ?? {}) as ChatAnswer;
      if (answer.ok !== true || typeof answer.reply !== "string") throw new AgentUnavailableError(answer.rid);
      local.opened = true;
      if (typeof answer.turn === "number") local.turns = answer.turn;
      this.publish(local, [
        ...local.messages,
        { role: "assistant", content: withRecommendation(answer.reply, answer.recommended), ...(answer.leadSaved ? { signal: "lead_saved" as const } : {}) },
      ]);
    } catch (e) {
      // The wait ran out, but the turn may have run on — its tools are not in the
      // model's 25 s budget — and saved the lead (review 2026-10-15). Ask before
      // telling the visitor it failed, or they send again what was already done.
      if (e instanceof TimedOut) {
        const ended = await this.recover(local);
        if (ended === "running") {
          // Still running when the window closed: received, not failed, so it stays on screen (review 2026-10-15).
          throw new AgentLimitError("still_processing");
        }
        if (ended === "saved") {
          this.publish(local, [...local.messages, { role: "assistant", content: LEAD_SAVED_WITHOUT_REPLY, signal: "lead_saved", replyMissing: true }]);
          return;
        }
        if (ended) {
          this.publish(local, [...local.messages, { role: "assistant", content: ended.reply, ...(ended.leadSaved ? { signal: "lead_saved" as const } : {}) }]);
          return;
        }
      }
      // Not sent after all: off the screen, and AgentChat puts the text back in the box.
      this.publish(local, local.messages.filter((m) => m !== sent));
      throw e;
    }
  }

  /**
   * How the turn that outlived the wait ended, asked every STATUS_POLL_MS for
   * STATUS_RECOVERY_MS: its reply, "saved" for a lead saved with no reply,
   * "running" when the last answer in the window still said busy, or null when
   * it ended with neither, or no answer came.
   * A status request that fails is asked again; it runs no turn. It names the
   * turn it asks about, and an answer about any other turn — one that never
   * started, or an earlier reply — is not this one's (review 2026-10-15).
   */
  private async recover(local: LocalConversation): Promise<{ reply: string; leadSaved: boolean } | "saved" | "running" | null> {
    const turn = local.turns + 1;
    const body = { agent: local.agent, conversationId: local.serverId, token: local.token, status: true, turn };
    const deadline = Date.now() + STATUS_RECOVERY_MS;
    let running = false;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
      const { data, error } = await this.invokeWithin(body, STATUS_REQUEST_TIMEOUT_MS).catch(() => ({
        data: null,
        error: { message: "network" } as { message: string; context?: unknown },
      }));
      // No such conversation: the first message never opened it, so no turn ran.
      if (error?.context instanceof Response && error.context.status === 403) return null;
      if (error || !data) continue;
      local.opened = true;
      const answer = data as { busy?: boolean; leadSaved?: boolean; turns?: unknown; last?: { role?: string; content?: unknown } | null };
      // The server's count, so the next request names the right turn.
      if (typeof answer.turns === "number") local.turns = answer.turns;
      running = answer.busy === true;
      if (running) continue;
      if (answer.turns !== turn) return null;
      if (answer.last?.role === "assistant" && typeof answer.last.content === "string") {
        return { reply: answer.last.content, leadSaved: answer.leadSaved === true };
      }
      return answer.leadSaved === true ? "saved" : null;
    }
    return running ? "running" : null;
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
    // A 503 may already have opened the conversation: the next message continues it.
    if (body?.conversationId) local.opened = true;
    if (typeof body?.turn === "number") local.turns = body.turn;
    // A turn whose tool saved the lead and whose closing reply then failed.
    if (body?.leadSaved === true) return SAVED;
    if (body?.code === "too_long") return new AgentLimitError("too_long");
    if (body?.code === "too_many_turns") return new AgentLimitError("too_many_turns");
    // The function answers one message per conversation at a time; this one was not run.
    if (body?.code === "busy") {
      local.opened = true;
      return new AgentLimitError("busy");
    }
    if (res?.status === 429) return new AgentLimitError("rate_limited");
    if (body?.code === "gone" || body?.code === "closed") {
      // A new conversation, under the same consent, on the next message.
      const keys = this.makeKeys();
      Object.assign(local, { serverId: keys.id, token: keys.token, opened: false, turns: 0 });
      return new AgentLimitError("conversation_closed");
    }
    return new AgentUnavailableError(body?.rid);
  }

  /**
   * One request, cancelled at the timeout. The turn may still run on; `recover`
   * asks how it ended. The conversation's ids are the page's own, so nothing a
   * late answer carries is needed (review 2026-10-15).
   */
  private invokeWithin(body: Record<string, unknown>, ms: number) {
    const controller = new AbortController();
    const request = this.client.functions.invoke("chat", { body, signal: controller.signal });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimedOut());
      }, ms);
    });
    return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
  }
}
