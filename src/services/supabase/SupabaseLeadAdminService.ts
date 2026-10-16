import type { LeadAdminPort, LeadRecord, LeadStatus, TranscriptLine } from "../ports";
import type { ContentFunctionsClient } from "./EdgeContentAdminService";
import { CLAIM_DOCUMENT_REF_PREFIX } from "./SupabaseUploadService";
import {
  fetchRows,
  toPortRow,
  type SupabaseLeadTableClient,
  type SupabaseReadResult,
} from "./SupabaseTableClient";

/** The port's fields. Not `*`: a lead row also carries the visitor's summary,
 *  profile and consent record, none of which this list shows, and personal data
 *  the screen does not need stays out of the browser. */
const LEAD_COLUMNS = "id,name,phone,email,source,topic,timing,message,status,created_at,agency_id,assigned_user_id";

/** Leads per read; PostgREST's own default cap is 1,000. */
export const LEAD_PAGE = 1000;
/** A bound on one list, far past what the agency holds. */
export const LEAD_LIST_MAX = 20_000;

const NOT_APPLIED = "הפעולה לא בוצעה — אין הרשאה או שהפנייה כבר לא קיימת";

/**
 * The agency's leads, read and written in Supabase under the person's own session.
 *
 * `leads_read_admin`, `leads_update_admin` and `leads_delete_admin` are the gate:
 * Admin+ in the lead's agency, or the User it is assigned to (who may change
 * its status but not delete it), or the platform operator. Assigning and a
 * claim document's link go through Edge Functions (assign-lead,
 * claim-document-link), which ask the same rules under the same session.
 *
 * Leads are handed out under their Supabase `id`, not `base44_id ?? id` as
 * `toPortRow` does for content — the writes below act on `id`, and claims
 * written by the `submit-claim` Edge Function have no Base44 id at all.
 */
export class SupabaseLeadAdminService implements LeadAdminPort {
  constructor(
    private readonly client: SupabaseLeadTableClient,
    private readonly functions: ContentFunctionsClient | null = null,
    private readonly accessToken: () => Promise<string | null> = async () => null,
  ) {}

  /** An Edge Function as the signed-in person; its refusal in its own words. */
  private async call(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const token = await this.accessToken();
    if (!token || !this.functions) throw new Error("נדרשת התחברות.");
    const { data, error } = await this.functions.functions.invoke(name, { body, headers: { Authorization: `Bearer ${token}` } });
    if (error) {
      const res = error.context instanceof Response ? error.context : null;
      const answer = res ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
      throw new Error(answer?.error ?? `הפעולה נכשלה (${res?.status ?? "ללא תשובה"}).`);
    }
    return (data ?? {}) as Record<string, unknown>;
  }

  /**
   * Every lead, newest first, a page at a time: "כל הפניות", the counts and
   * "ייצוא הכל" read this list, and at a fixed 500 the older leads left all
   * three without a word (review 2026-10-15). `id` breaks ties so no row falls
   * between pages; LEAD_LIST_MAX only bounds a runaway read.
   */
  async list(limit = LEAD_LIST_MAX): Promise<LeadRecord[]> {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; from < limit; from += LEAD_PAGE) {
      const to = Math.min(from + LEAD_PAGE, limit) - 1;
      const query = this.client.from("leads").select(LEAD_COLUMNS).order("created_at", { ascending: false }).order("id", { ascending: false });
      const page = await fetchRows(query.range ? query.range(from, to) : query.limit(to + 1), "leads");
      rows.push(...page);
      if (!query.range || page.length < to - from + 1) break;
    }
    return rows.map((row) => ({ ...toPortRow(row), id: row.id }) as unknown as LeadRecord);
  }

  setStatus(id: string, status: LeadStatus): Promise<void> {
    return applied(this.client.from("leads").update({ status }).eq("id", id).select("id"), "status");
  }

  remove(id: string): Promise<void> {
    return applied(this.client.from("leads").delete().eq("id", id).select("id"), "delete");
  }

  /**
   * A storage reference signed for five minutes by claim-document-link, for
   * whoever may see the lead it belongs to. Anything else (a Base44 file URL
   * from before the switch) is returned as it is.
   */
  async documentLink(ref: string, leadId: string): Promise<string> {
    if (!ref.startsWith(CLAIM_DOCUMENT_REF_PREFIX)) return ref;
    const answer = await this.call("claim-document-link", { leadId, path: ref.slice(CLAIM_DOCUMENT_REF_PREFIX.length) });
    if (typeof answer.url !== "string" || !answer.url) throw new Error("לא ניתן לפתוח את המסמך");
    return answer.url;
  }

  async assign(leadId: string, userId: string | null): Promise<{ mailed: boolean }> {
    const answer = await this.call("assign-lead", { leadId, userId });
    return { mailed: answer.mailed === true };
  }

  /** Open (not closed) leads with nobody on them; capped at a thousand, as countNew. */
  async countUnassigned(): Promise<number> {
    const rows = await fetchRows(
      this.client.from("leads").select("id").is("assigned_user_id", null).not("status", "eq", "closed").limit(1000),
      "leads",
    );
    return rows.length;
  }

  /**
   * The chat behind a lead, read under the admin's session —
   * `chat_*_read_member_or_admin` is the gate, as for the leads themselves.
   * Read-only: this class holds no write to the chat tables.
   */
  async transcript(leadId: string): Promise<TranscriptLine[]> {
    const conversations = await fetchRows(
      this.client.from("chat_conversations").select("id").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1),
      "chat_conversations",
    );
    const id = conversations[0]?.id;
    if (!id) return [];
    const rows = await fetchRows(
      this.client.from("chat_messages").select("role,content,created_at").eq("conversation_id", id).order("id", { ascending: true }).limit(500),
      "chat_messages",
    );
    return rows
      .filter((r) => r.role === "user" || r.role === "assistant")
      .map((r) => ({ role: r.role as TranscriptLine["role"], content: String(r.content ?? ""), at: String(r.created_at ?? "") }));
  }

  /**
   * Which leads have a conversation: one read of the link column, so the screen
   * can show the tab only where there is something to read. Only linked rows:
   * conversations without a lead (most of them) would otherwise fill the window
   * and hide an older lead's tab.
   */
  async transcriptLeadIds(): Promise<string[]> {
    const rows = await fetchRows(
      this.client.from("chat_conversations").select("lead_id").not("lead_id", "is", null).order("created_at", { ascending: false }).limit(1000),
      "chat_conversations",
    );
    return [...new Set(rows.map((r) => r.lead_id).filter((v): v is string => typeof v === "string" && v !== ""))];
  }

  /**
   * The leads that need someone: `new`, and `escalated` — a visitor who asked for
   * Dorit herself (review 2026-10-15). `leads_read_admin` is the gate here too.
   * Capped at a thousand, which the menu shows as it is.
   */
  async countNew(): Promise<number> {
    const rows = await fetchRows(this.client.from("leads").select("id").or("status.eq.new,status.eq.escalated").limit(1000), "leads");
    return rows.length;
  }
}

/**
 * A write that changed exactly the row it named, or an error.
 *
 * Row-level security does not refuse an update or delete it filters out: it
 * changes nothing and reports success. Asking for the row back is the only way
 * to tell "done" from "not allowed", and the screen must not show a refused
 * deletion as a deleted lead.
 */
async function applied(query: PromiseLike<SupabaseReadResult>, action: string): Promise<void> {
  const { data, error } = await query;
  if (error) throw new Error(`leads ${action} failed: ${error.message}`);
  if (!data || data.length === 0) throw new Error(NOT_APPLIED);
}
