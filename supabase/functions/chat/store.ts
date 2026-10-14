/**
 * The chat function's reads and writes, through PostgREST with the service key
 * (_shared/rest.ts). The only module that knows the tables' names.
 */
import { callRpc, insertRow, selectRows, updateRow, updateRows } from '../_shared/rest.ts';
import type { UsageTotals } from './budget.ts';
import type { ConversationFacts, ConversationStatus } from './tools.ts';
import type { StoredMessage } from './turn.ts';

export interface Attribution {
  channel: string;
  campaign: string;
  landingPath: string;
}

export interface ConversationRow {
  id: string;
  agency_id: string;
  role: string;
  token_hash: string;
  consent_version: string;
  consent_at: string;
  status: ConversationStatus;
  lead_id: string | null;
  /** When a hand-off was made; null until then. Apart from status (Ruling 9). */
  escalated_at: string | null;
  turns: number;
  /** A running turn's hold on the conversation; null when none runs (I3). */
  busy_until: string | null;
  attribution: Attribution;
  is_eval: boolean;
  last_message_at: string;
  /** When the sheet sweep claimed this conversation; null until then. */
  sheet_logged_at?: string | null;
}

export interface NewConversation {
  agency_id: string;
  role: string;
  token_hash: string;
  consent_version: string;
  consent_at: string;
  attribution: Attribution;
  is_eval: boolean;
  /** Created already claimed for its first turn: turns 1, busy_until set. */
  turns: number;
  busy_until: string;
  delete_after?: string;
}

export interface UpdateOptions {
  /** Write lead_id only while it is still null (PATCH filter `lead_id=is.null`). */
  onlyIfLeadIdNull?: boolean;
}

export interface ChatStore {
  createConversation(row: NewConversation): Promise<ConversationRow>;
  getConversation(id: string): Promise<ConversationRow | null>;
  listMessages(conversationId: string): Promise<StoredMessage[]>;
  addMessage(m: { conversation_id: string; agency_id: string; role: 'user' | 'assistant' | 'tool'; content: string }): Promise<void>;
  updateConversation(id: string, fields: Partial<Pick<ConversationRow, 'status' | 'lead_id'>>, options?: UpdateOptions): Promise<void>;
  /**
   * Claim the conversation for one turn, atomically: only while its turn count
   * is still `turns`, its status open or escalated, and no other turn holds it
   * (`busy_until` null or past `nowIso`). Counts the turn and holds it until
   * `leaseUntilIso`. The claimed row, or null when nothing matched.
   */
  claimTurn(id: string, turns: number, nowIso: string, leaseUntilIso: string): Promise<ConversationRow | null>;
  /** Mark every idle, unlogged, non-eval conversation of these roles as logged now, and return them. One PATCH: what one sweep claims, no other can. */
  claimSheetLogs(roles: readonly string[], cutoffIso: string, nowIso: string): Promise<ConversationRow[]>;
  /** End this turn's claim (only while it is still `leaseUntilIso`), stamping last_message_at. */
  releaseTurn(id: string, leaseUntilIso: string, lastMessageAt: string): Promise<void>;
  /** Persist a hand-off: escalated_at = now. */
  recordEscalation(id: string): Promise<void>;
  recordUsage(row: { conversation_id: string; agency_id: string; model: string; input_tokens: number; cached_tokens: number; output_tokens: number }): Promise<void>;
  monthUsage(agencyId: string, sinceIso: string): Promise<UsageTotals[]>;
  claimBudgetAlert(agencyId: string, month: string): Promise<boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A transcript this long is already far past the 40-turn cap. */
const MESSAGE_LIMIT = 200;
/** chat_messages.content has a CHECK at this length; an over-long reply must not fail the insert. */
export const MESSAGE_CONTENT_LIMIT = 8000;

/** The model-facing facts of a stored conversation; `escalated` is `escalated_at is not null`. */
export function toFacts(row: ConversationRow): ConversationFacts {
  return {
    id: row.id,
    status: row.status,
    escalated: row.escalated_at != null,
    consentVersion: row.consent_version,
    consentAt: row.consent_at,
    attribution: row.attribution,
  };
}

/** At most the limit in UTF-16 units (never more than it in characters), without a split surrogate pair. */
function clip(content: string): string {
  if (content.length <= MESSAGE_CONTENT_LIMIT) return content;
  const cut = content.slice(0, MESSAGE_CONTENT_LIMIT);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

export const restStore: ChatStore = {
  async createConversation(row) {
    return (await insertRow('chat_conversations', { ...row })) as unknown as ConversationRow;
  },
  async getConversation(id) {
    if (!UUID.test(id)) return null;
    const rows = await selectRows('chat_conversations', `id=eq.${id}&select=*&limit=1`);
    return (rows[0] as unknown as ConversationRow | undefined) ?? null;
  },
  async listMessages(conversationId) {
    if (!UUID.test(conversationId)) return [];
    const rows = await selectRows('chat_messages', `conversation_id=eq.${conversationId}&select=role,content&order=id.asc&limit=${MESSAGE_LIMIT}`);
    return rows.map((r) => ({ role: r.role as StoredMessage['role'], content: String(r.content ?? '') }));
  },
  async addMessage(m) {
    await insertRow('chat_messages', { ...m, content: clip(m.content) });
  },
  async updateConversation(id, fields, options) {
    await updateRow('chat_conversations', id, { ...fields }, options?.onlyIfLeadIdNull ? 'lead_id=is.null' : undefined);
  },
  async claimTurn(id, turns, nowIso, leaseUntilIso) {
    if (!UUID.test(id) || !Number.isInteger(turns)) return null;
    // Values in or=() with `:` or `.` are double-quoted (PostgREST's reserved characters).
    const free = encodeURIComponent(`(busy_until.is.null,busy_until.lt."${nowIso}")`);
    const rows = await updateRows(
      'chat_conversations',
      `id=eq.${id}&turns=eq.${turns}&status=in.(open,escalated)&or=${free}`,
      { turns: turns + 1, busy_until: leaseUntilIso },
    );
    return rows.length === 1 ? (rows[0] as unknown as ConversationRow) : null;
  },
  async claimSheetLogs(roles, cutoffIso, nowIso) {
    if (roles.length === 0 || roles.some((r) => !/^[a-z]+$/.test(r))) return [];
    // Values in or=() with `:` or `.` are double-quoted (PostgREST's reserved characters).
    const free = encodeURIComponent(`(busy_until.is.null,busy_until.lt."${nowIso}")`);
    const rows = await updateRows(
      'chat_conversations',
      `role=in.(${roles.join(',')})&is_eval=is.false&sheet_logged_at=is.null&last_message_at=lt.${encodeURIComponent(cutoffIso)}&or=${free}`,
      { sheet_logged_at: nowIso },
    );
    return rows as unknown as ConversationRow[];
  },
  async releaseTurn(id, leaseUntilIso, lastMessageAt) {
    await updateRow('chat_conversations', id, { busy_until: null, last_message_at: lastMessageAt }, `busy_until=eq.${encodeURIComponent(leaseUntilIso)}`);
  },
  async recordEscalation(id) {
    await updateRow('chat_conversations', id, { escalated_at: new Date().toISOString() });
  },
  async recordUsage(row) {
    await insertRow('chat_usage', { ...row });
  },
  async monthUsage(agencyId, sinceIso) {
    const rows = await callRpc('chat_month_usage', { p_agency_id: agencyId, p_since: sinceIso });
    return (Array.isArray(rows) ? rows : []).map((r: Record<string, unknown>) => ({
      model: String(r.model ?? ''),
      input_tokens: Number(r.input_tokens ?? 0),
      cached_tokens: Number(r.cached_tokens ?? 0),
      output_tokens: Number(r.output_tokens ?? 0),
    }));
  },
  async claimBudgetAlert(agencyId, month) {
    try {
      await insertRow('chat_budget_alerts', { agency_id: agencyId, month });
      return true;
    } catch (e) {
      // A conflict is the normal "already sent this month". Anything else is
      // thrown for the caller to log by its code (insertRow's errors carry the
      // status and PostgREST code only); the caller sends nothing either way.
      if (String((e as Error)?.message ?? '').startsWith('insert_http_409')) return false;
      throw e;
    }
  },
};
