import type { LeadRecord, LeadStatus } from "@/services/ports";
import type { Ymd } from "@/lib/wall-clock";
import { parseLeadDetails } from "@/components/dorit/admin/LeadDetails";

/**
 * The lead pipeline (feature 2): the statuses a member moves a lead through,
 * the follow-up a lead is due for, and the urgent-lead SLA.
 *
 * The stored keys did not change when the pipeline was named: `client` and
 * `closed` are what retention (never anonymise a client) and the personal area
 * read. Only the labels did — "נסגר" is a deal won, "לא רלוונטי" a lead let go.
 */

/** The statuses a member may set, in pipeline order. */
export const STATUS: LeadStatus[] = ["new", "contacted", "meeting_set", "proposal_sent", "client", "closed"];

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "חדשה",
  contacted: "נוצר קשר",
  meeting_set: "נקבעה פגישה",
  proposal_sent: "נשלחה הצעה",
  client: "נסגר (לקוח/ה)",
  closed: "לא רלוונטי",
};

/* Display labels for every status the entity can hold, settable or not. Without
   the backend-written ones a lead rendered with its raw English key. */
export const ANY_STATUS_LABEL: Record<string, string> = {
  ...STATUS_LABEL,
  escalated: "הועברה לטיפול אישי",
  partial: "ראיון שלא הושלם",
};

/** Contact made and the sale under way: the "בתהליך" card. */
export const IN_PROGRESS: ReadonlySet<string> = new Set(["contacted", "meeting_set", "proposal_sent"]);

/** Whether a member may move a lead from `from` to `to`: any pipeline status, never a backend-only one, never the same. */
export function canChooseStatus(from: string, to: string): boolean {
  return to !== from && (STATUS as string[]).includes(to);
}

/** Where a lead moves once a member has written to it on WhatsApp: a new lead to "נוצר קשר" (after the member confirms); any other stays. */
export function statusAfterWhatsapp(status: string): LeadStatus | null {
  return status === "new" ? "contacted" : null;
}

/** A lead that needs nothing more: won, or let go. */
const done = (status: string) => status === "client" || status === "closed";

export type FollowUpState = "overdue" | "today" | "later";

/** Where a lead's next follow-up stands on `today` (Israel's date); null with no date, or once the lead is done. */
export function followUpState(lead: Pick<LeadRecord, "status" | "nextFollowUpOn">, today: Ymd): FollowUpState | null {
  const on = lead.nextFollowUpOn;
  if (!on || done(lead.status)) return null;
  return on < today ? "overdue" : on === today ? "today" : "later";
}

/** The interview's "דחיפות" line says the person wants a call this week. */
export function isUrgent(lead: Pick<LeadRecord, "topic" | "timing" | "message">): boolean {
  return parseLeadDetails(lead).urgency.startsWith("דחוף");
}

/** An urgent lead still new more than `hours` after it arrived. */
export function slaBreached(lead: LeadRecord, now: Date, hours: number): boolean {
  const arrived = Date.parse(lead.created_date);
  if (lead.status !== "new" || Number.isNaN(arrived) || !isUrgent(lead)) return false;
  return now.getTime() - arrived > hours * 3_600_000;
}
