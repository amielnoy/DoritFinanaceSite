import type { LeadAdminPort, LeadRecord, LeadStatus, TranscriptLine } from "../ports";
import {
  CLAIM_DOCUMENT_REF_PREFIX,
  CLAIM_DOCUMENTS_BUCKET,
  type SupabaseStorageClient,
} from "./SupabaseUploadService";
import {
  fetchRows,
  toPortRow,
  type SupabaseLeadTableClient,
  type SupabaseReadResult,
} from "./SupabaseTableClient";

/** The port's fields. Not `*`: a lead row also carries the visitor's summary,
 *  profile and consent record, none of which this list shows, and personal data
 *  the screen does not need stays out of the browser. */
const LEAD_COLUMNS = "id,name,phone,email,source,topic,timing,message,status,created_at";

const NOT_APPLIED = "הפעולה לא בוצעה — אין הרשאה או שהפנייה כבר לא קיימת";

/** How long a document link from the leads screen opens the file: long enough to open it, not to keep it. */
const DOCUMENT_LINK_SECONDS = 5 * 60;

/**
 * The admin's leads, read and written in Supabase under her own session.
 *
 * `leads_read_admin`, `leads_update_admin` and `leads_delete_admin` are the gate:
 * `can_see(agency_id) or is_admin()`. No backend function is involved.
 *
 * Leads are handed out under their Supabase `id`, not `base44_id ?? id` as
 * `toPortRow` does for content — the writes below act on `id`, and claims
 * written by the `submit-claim` Edge Function have no Base44 id at all.
 */
export class SupabaseLeadAdminService implements LeadAdminPort {
  constructor(
    private readonly client: SupabaseLeadTableClient,
    private readonly storage: SupabaseStorageClient | null = null,
  ) {}

  async list(limit = 500): Promise<LeadRecord[]> {
    const rows = await fetchRows(
      this.client.from("leads").select(LEAD_COLUMNS).order("created_at", { ascending: false }).limit(limit),
      "leads",
    );
    return rows.map((row) => ({ ...toPortRow(row), id: row.id }) as unknown as LeadRecord);
  }

  setStatus(id: string, status: LeadStatus): Promise<void> {
    return applied(this.client.from("leads").update({ status }).eq("id", id).select("id"), "status");
  }

  remove(id: string): Promise<void> {
    return applied(this.client.from("leads").delete().eq("id", id).select("id"), "delete");
  }

  /**
   * A storage reference signed for five minutes under the admin's session —
   * `claim_documents_read_admin` is what allows it. Anything else (a Base44
   * file URL from before the switch) is returned as it is.
   */
  async documentLink(ref: string): Promise<string> {
    if (!ref.startsWith(CLAIM_DOCUMENT_REF_PREFIX)) return ref;
    if (!this.storage) throw new Error("אין חיבור לאחסון המסמכים");
    const path = ref.slice(CLAIM_DOCUMENT_REF_PREFIX.length);
    const { data, error } = await this.storage.storage
      .from(CLAIM_DOCUMENTS_BUCKET)
      .createSignedUrl(path, DOCUMENT_LINK_SECONDS);
    if (error || !data) throw new Error(`לא ניתן לפתוח את המסמך: ${error?.message ?? "no data"}`);
    return data.signedUrl;
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

  /** `leads_read_admin` is the gate here too. Capped at a thousand, which the menu shows as it is. */
  async countNew(): Promise<number> {
    const rows = await fetchRows(this.client.from("leads").select("id").eq("status", "new").limit(1000), "leads");
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
