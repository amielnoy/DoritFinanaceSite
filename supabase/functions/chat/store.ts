/**
 * The chat function's reads and writes, through PostgREST with the service key
 * (_shared/rest.ts). The only module that knows the tables' names.
 */
import { callRpc, insertRow, selectRows, updateRow } from '../_shared/rest.ts';
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
  attribution: Attribution;
  is_eval: boolean;
  last_message_at: string;
}

export interface NewConversation {
  agency_id: string;
  role: string;
  token_hash: string;
  consent_version: string;
  consent_at: string;
  attribution: Attribution;
  is_eval: boolean;
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
  updateConversation(id: string, fields: Partial<Pick<ConversationRow, 'status' | 'lead_id' | 'turns' | 'last_message_at'>>, options?: UpdateOptions): Promise<void>;
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
