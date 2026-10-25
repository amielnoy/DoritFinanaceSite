import { STAFF_LEADS } from "@/config/staff-leads";
import type { AgendaMeeting, CreatedLead, LeadAdminPort, LeadEvent, LeadMeeting, LeadMeetingUpdate, LeadRecord, LeadStatus, NewLeadMeeting, NewStaffLead, TranscriptLine } from "../ports";
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
const LEAD_COLUMNS = "id,name,phone,email,source,topic,timing,message,status,created_at,agency_id,assigned_user_id,merged_into,next_follow_up_on,channel,campaign";

/** The staff-created-lead columns; they exist in production only once the staff-leads migration is applied, so they are asked for only when STAFF_LEADS is on. */
const STAFF_LEAD_COLUMNS = "brought_by,intake,referrer_note,notice_method,possible_duplicate";

export const leadColumns = (staffLeads: boolean): string => (staffLeads ? `${LEAD_COLUMNS},${STAFF_LEAD_COLUMNS}` : LEAD_COLUMNS);

/** Leads per read; PostgREST's own default cap is 1,000. */
export const LEAD_PAGE = 1000;
/** A bound on one list, far past what the agency holds. */
export const LEAD_LIST_MAX = 20_000;

const NOT_APPLIED = "הפעולה לא בוצעה — אין הרשאה או שהפנייה כבר לא קיימת";

const MERGE_UNAVAILABLE = "מיזוג פניות אינו זמין כאן.";
/** merge_leads / unmerge_lead / add_lead_note refusals, by the exception each raises. */
const MERGE_REFUSALS: Record<string, string> = {
  forbidden: "רק מנהל/ת בסוכנות יכול/ה למזג פניות.",
  not_found: NOT_APPLIED,
  bad_merge: "אי אפשר למזג את הפניות האלה.",
  not_merged: "הפנייה כבר לא ממוזגת.",
  field_required: "ההערה ריקה.",
  field_too_long: "ההערה ארוכה מדי (עד 2,000 תווים).",
  field_invalid: "אין לכתוב בהערה מספר זהות, כרטיס אשראי או חשבון בנק.",
};

/** A meeting's columns for staff — Dorit's notes included, which the client's door never returns. */
const MEETING_COLUMNS = "id,scheduled_at,duration_min,topic,kind,status,mode,location,notes,client_summary,summary_published_at,source";

/**
 * The agenda's columns: a meeting's card, its lead's name and assignee, and its
 * requests (the open one is picked here). No notes, no summary text.
 */
const AGENDA_COLUMNS =
  "id,lead_id,scheduled_at,duration_min,topic,kind,status,mode,location,summary_published_at,source," +
  "lead:leads!lead_id(name,assigned_user_id),meeting_requests(id,kind,note,status)";

/** A bound on one agenda read, far past what the agency holds; the oldest fall off first. */
export const AGENDA_MAX = 1000;

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The port's update, in the table's column names. Only the fields given. */
function meetingColumns(update: LeadMeetingUpdate): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (update.status !== undefined) out.status = update.status;
  if (update.notes !== undefined) out.notes = update.notes;
  if (update.clientSummary !== undefined) out.client_summary = update.clientSummary;
  if (update.summaryPublishedAt !== undefined) out.summary_published_at = update.summaryPublishedAt;
  return out;
}

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
    private readonly staffLeads: boolean = STAFF_LEADS,
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
      const query = this.client.from("leads").select(leadColumns(this.staffLeads)).order("created_at", { ascending: false }).order("id", { ascending: false });
      const page = await fetchRows(query.range ? query.range(from, to) : query.limit(to + 1), "leads");
      rows.push(...page);
      if (!query.range || page.length < to - from + 1) break;
    }
    return rows.map((row) => {
      const lead = { ...toPortRow(row), id: row.id } as Record<string, unknown>;
      delete lead.merged_into;
      delete lead.next_follow_up_on;
      lead.mergedInto = typeof row.merged_into === "string" ? row.merged_into : null;
      lead.nextFollowUpOn = typeof row.next_follow_up_on === "string" ? row.next_follow_up_on : null;
      if (this.staffLeads) {
        for (const key of ["brought_by", "intake", "referrer_note", "notice_method", "possible_duplicate"]) delete lead[key];
        lead.broughtBy = typeof row.brought_by === "string" ? row.brought_by : null;
        lead.intake = typeof row.intake === "string" ? row.intake : null;
        lead.referrerNote = typeof row.referrer_note === "string" ? row.referrer_note : null;
        lead.noticeMethod = typeof row.notice_method === "string" ? row.notice_method : null;
        lead.possibleDuplicate = row.possible_duplicate === true;
      }
      return lead as unknown as LeadRecord;
    });
  }

  /**
   * A lead entered by a member, through create-lead. Unlike `call`, a 409 is an
   * answer here (a visible duplicate), so the Response is read before deciding.
   */
  async createLead(input: NewStaffLead): Promise<CreatedLead> {
    const token = await this.accessToken();
    if (!token || !this.functions) throw new Error("נדרשת התחברות.");
    const { data, error } = await this.functions.functions.invoke("create-lead", {
      body: { ...input },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error) {
      const res = error.context instanceof Response ? error.context : null;
      const answer = res ? ((await res.json().catch(() => null)) as { error?: string; leadId?: string; duplicate?: string } | null) : null;
      if (res?.status === 409 && answer?.duplicate === "visible" && typeof answer.leadId === "string") {
        return { leadId: answer.leadId, duplicate: "visible", noticeSent: null };
      }
      throw new Error(answer?.error ?? `הפעולה נכשלה (${res?.status ?? "ללא תשובה"}).`);
    }
    const answer = (data ?? {}) as Record<string, unknown>;
    if (typeof answer.leadId !== "string" || !answer.leadId) throw new Error("הפנייה לא נשמרה.");
    return {
      leadId: answer.leadId,
      duplicate: answer.duplicate === "hidden" || answer.duplicate === "visible" ? answer.duplicate : null,
      noticeSent: typeof answer.noticeSent === "boolean" ? answer.noticeSent : null,
    };
  }

  clearDuplicate(leadId: string): Promise<void> {
    return applied(this.client.from("leads").update({ possible_duplicate: false }).eq("id", leadId).select("id"), "duplicate");
  }

  async mergeLeads(primaryId: string, otherIds: string[]): Promise<number> {
    const data = await this.rpc("merge_leads", { p_primary: primaryId, p_others: otherIds });
    return typeof data === "number" ? data : 0;
  }

  async unmergeLead(leadId: string): Promise<void> {
    await this.rpc("unmerge_lead", { p_id: leadId });
  }

  /** The lead's activity log, newest first; lead_events_read decides whose. */
  async leadEvents(leadId: string): Promise<LeadEvent[]> {
    const rows = await fetchRows(
      this.client.from("lead_events").select("id,kind,actor_id,from_value,to_value,note,at").eq("lead_id", leadId).order("at", { ascending: false }).limit(500),
      "lead_events",
    );
    const text = (v: unknown) => (typeof v === "string" ? v : null);
    return rows.map((r) => ({
      id: String(r.id),
      kind: r.kind as LeadEvent["kind"],
      actorId: text(r.actor_id),
      from: text(r.from_value),
      to: text(r.to_value),
      note: text(r.note),
      at: String(r.at ?? ""),
    }));
  }

  async addLeadNote(leadId: string, text: string): Promise<void> {
    await this.rpc("add_lead_note", { p_lead_id: leadId, p_note: text });
  }

  async logWhatsapp(leadId: string): Promise<void> {
    await this.rpc("log_lead_whatsapp", { p_lead_id: leadId });
  }

  setFollowUp(leadId: string, on: string | null): Promise<void> {
    return applied(this.client.from("leads").update({ next_follow_up_on: on }).eq("id", leadId).select("id"), "follow-up");
  }

  /** A merge or note function as the signed-in person; its refusal in Hebrew. */
  private async rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client.rpc) throw new Error(MERGE_UNAVAILABLE);
    const { data, error } = await this.client.rpc(fn, args);
    if (error) throw new Error(MERGE_REFUSALS[error.message] ?? `${fn} failed: ${error.message}`);
    return data;
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
      // A merged lead is history, as on the screen: its main lead is the one to assign.
      this.client.from("leads").select("id").is("assigned_user_id", null).not("status", "eq", "closed").is("merged_into", null).limit(1000),
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
    const rows = await fetchRows(
      this.client.from("leads").select("id").or("status.eq.new,status.eq.escalated").is("merged_into", null).limit(1000),
      "leads",
    );
    return rows.length;
  }

  /**
   * Clients' open requests to move or cancel a meeting — what the agenda's
   * "בקשות שינוי" chip counts. `meeting_requests_read_lead` is the gate, so a
   * User counts their assigned leads' requests only. Ids only, capped at a
   * thousand, as countNew.
   */
  async countOpenMeetingRequests(): Promise<number> {
    const rows = await fetchRows(this.client.from("meeting_requests").select("id").eq("status", "open").limit(1000), "meeting_requests");
    return rows.length;
  }

  /**
   * A lead's meetings, newest first (no time last), under the person's own
   * session: `meetings_read_admin` and `meeting_requests_read_lead` both rest
   * on can_see_lead, so a User reads only their assigned leads' meetings.
   */
  async meetings(leadId: string): Promise<LeadMeeting[]> {
    const rows = await fetchRows(
      this.client.from("meetings").select(MEETING_COLUMNS).eq("lead_id", leadId).order("scheduled_at", { ascending: false }).limit(200),
      "meetings",
    );
    if (rows.length === 0) return [];
    const ids = new Set(rows.map((r) => String(r.id)));
    const requests = await fetchRows(
      this.client.from("meeting_requests").select("id,meeting_id,kind,note").eq("status", "open").limit(500),
      "meeting_requests",
    );
    const open = new Map(requests.filter((r) => ids.has(String(r.meeting_id))).map((r) => [String(r.meeting_id), r]));
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const meetings = rows.map((r): LeadMeeting => {
      const request = open.get(String(r.id));
      return {
        id: String(r.id),
        scheduledAt: typeof r.scheduled_at === "string" ? r.scheduled_at : null,
        durationMin: typeof r.duration_min === "number" ? r.duration_min : null,
        topic: str(r.topic),
        kind: (r.kind as LeadMeeting["kind"]) ?? "first",
        status: (r.status as LeadMeeting["status"]) ?? "scheduled",
        mode: (r.mode as LeadMeeting["mode"]) ?? null,
        location: str(r.location),
        notes: str(r.notes),
        clientSummary: str(r.client_summary),
        summaryPublishedAt: typeof r.summary_published_at === "string" ? r.summary_published_at : null,
        source: typeof r.source === "string" ? r.source : null,
        openRequest: request ? { id: String(request.id), kind: request.kind as "reschedule" | "cancel", note: str(request.note) } : null,
      };
    });
    // Postgres puts nulls first in a descending order; a meeting with no time goes last.
    return [...meetings.filter((m) => m.scheduledAt), ...meetings.filter((m) => !m.scheduledAt)];
  }

  /**
   * The agency's agenda in one read: its meetings, newest first (no time
   * last), with the lead's name and assignee and the requests on each, embedded
   * by PostgREST. Under the person's own session, as `meetings()`:
   * `meetings_read_admin`, `leads_read_admin` and `meeting_requests_read_lead`
   * all rest on can_see_lead, so a User's agenda holds their assigned leads'
   * meetings and nothing else. `leads!lead_id` names the key, because the old
   * `lead_base44_id` is a second one to `leads`. Notes and the summary's text
   * stay out: the agenda shows neither.
   */
  async agencyMeetings(agencyId: string): Promise<AgendaMeeting[]> {
    const rows = await fetchRows(
      this.client
        .from("meetings")
        .select(AGENDA_COLUMNS)
        .eq("agency_id", agencyId)
        .order("scheduled_at", { ascending: false })
        .limit(AGENDA_MAX),
      "meetings",
    );
    const meetings = rows.map((r): AgendaMeeting => {
      const lead = (Array.isArray(r.lead) ? r.lead[0] : r.lead) as Record<string, unknown> | null | undefined;
      const requests = Array.isArray(r.meeting_requests) ? (r.meeting_requests as Record<string, unknown>[]) : [];
      const request = requests.find((q) => q.status === "open");
      return {
        id: String(r.id),
        leadId: String(r.lead_id ?? ""),
        leadName: str(lead?.name),
        assignedUserId: typeof lead?.assigned_user_id === "string" ? lead.assigned_user_id : null,
        scheduledAt: typeof r.scheduled_at === "string" ? r.scheduled_at : null,
        durationMin: typeof r.duration_min === "number" ? r.duration_min : null,
        topic: str(r.topic),
        kind: (r.kind as AgendaMeeting["kind"]) ?? "first",
        status: (r.status as AgendaMeeting["status"]) ?? "scheduled",
        mode: (r.mode as AgendaMeeting["mode"]) ?? null,
        location: str(r.location),
        summaryPublishedAt: typeof r.summary_published_at === "string" ? r.summary_published_at : null,
        source: typeof r.source === "string" ? r.source : null,
        openRequest: request ? { id: String(request.id), kind: request.kind as "reschedule" | "cancel", note: str(request.note) } : null,
      };
    });
    return [...meetings.filter((m) => m.scheduledAt), ...meetings.filter((m) => !m.scheduledAt)];
  }

  /** As the signed-in person: `created_by` defaults to them, and the policy holds them to it. */
  addMeeting(meeting: NewLeadMeeting): Promise<void> {
    return applied(
      this.client.from("meetings").insert({
        lead_id: meeting.leadId,
        agency_id: meeting.agencyId,
        scheduled_at: meeting.scheduledAt,
        duration_min: meeting.durationMin,
        mode: meeting.mode,
        location: meeting.location || null,
        kind: meeting.kind,
        topic: meeting.topic,
        status: "scheduled",
      }).select("id"),
      "meeting insert",
    );
  }

  updateMeeting(id: string, update: LeadMeetingUpdate): Promise<void> {
    return applied(this.client.from("meetings").update(meetingColumns(update)).eq("id", id).select("id"), "meeting update");
  }

  handleMeetingRequest(requestId: string): Promise<void> {
    return applied(
      this.client.from("meeting_requests").update({ status: "handled", handled_at: new Date().toISOString() }).eq("id", requestId).select("id"),
      "meeting request",
    );
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
