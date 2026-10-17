import { israelWallClock } from "@/lib/wall-clock";

/**
 * A client's meetings with Dorit: the words the screens use for them, and how
 * a meeting's time reads (docs/superpowers/specs/2026-10-17-client-meetings-design.md).
 * Every time a person reads is Israel's wall clock (A-63).
 */

export type MeetingStatus = "scheduled" | "done" | "cancelled" | "no_show";
export type MeetingMode = "office" | "phone" | "video";
export type MeetingKind = "first" | "follow_up" | "annual_review" | "other";
export type MeetingRequestKind = "reschedule" | "cancel";

export const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  scheduled: "מתוכננת",
  done: "התקיימה",
  cancelled: "בוטלה",
  no_show: "לא התקיימה",
};

export const MEETING_MODE_LABEL: Record<MeetingMode, string> = {
  office: "במשרד",
  phone: "טלפון",
  video: "וידאו",
};

export const MEETING_KIND_LABEL: Record<MeetingKind, string> = {
  first: "פגישת היכרות",
  follow_up: "פגישת המשך",
  annual_review: "סקירה שנתית",
  other: "פגישה",
};

/** What staff may set: a first meeting is the site's booking, never added by hand. */
export const STAFF_MEETING_KINDS: MeetingKind[] = ["follow_up", "annual_review", "other"];

export const MEETING_REQUEST_LABEL: Record<MeetingRequestKind, string> = {
  reschedule: "הלקוח ביקש מועד אחר",
  cancel: "הלקוח ביקש לבטל",
};

/** The lengths staff choose from, in minutes. */
export const MEETING_DURATIONS = [30, 45, 60, 90] as const;

/** "14.12 · 17:30" — a meeting's day and hour in Israel; "לא נקבע מועד" without one. */
export function meetingWhen(iso: string | null | undefined): string {
  const at = iso ? israelWallClock(iso) : null;
  if (!at) return "לא נקבע מועד";
  const [, m, d] = at.ymd.split("-");
  return `${Number(d)}.${Number(m)} · ${at.hhmm}`;
}

/** "14.12, 09:12" — when something was done, for a status line. */
export function meetingStamp(iso: string | null | undefined): string {
  const at = iso ? israelWallClock(iso) : null;
  if (!at) return "";
  const [, m, d] = at.ymd.split("-");
  return `${Number(d)}.${Number(m)}, ${at.hhmm}`;
}

/** A meeting as the client sees it — exactly what `my_meetings()` returns. */
export interface ClientMeeting {
  id: string;
  scheduledAt: string | null;
  durationMin: number | null;
  topic: string;
  kind: MeetingKind;
  status: MeetingStatus;
  mode: MeetingMode | null;
  location: string;
  /** Null until Dorit publishes it. */
  clientSummary: string | null;
  summaryPublishedAt: string | null;
  inCalendar: boolean;
  /** The client's open request, if any — the button then waits for Dorit. */
  openRequest: MeetingRequestKind | null;
}

/** How a client reads the mode: "שיחת וידאו", not staff's "וידאו". */
export const CLIENT_MODE_LABEL: Record<MeetingMode, string> = {
  office: "במשרד",
  phone: "בטלפון",
  video: "שיחת וידאו",
};

/** When a meeting has no length, the calendar and the time range take this. */
export const DEFAULT_DURATION_MIN = 45;

const at = (m: ClientMeeting) => (m.scheduledAt ? new Date(m.scheduledAt).getTime() : NaN);

/**
 * The client's tab, in the spec's order: the next upcoming meeting on its own;
 * then the other upcoming ones, soonest first (an undated one last); then the
 * past ones, most recent first; cancelled ones apart, to be shown collapsed.
 * A scheduled meeting whose time has gone by counts as past.
 */
export function orderClientMeetings(list: ClientMeeting[], now: Date): {
  next: ClientMeeting | null;
  upcoming: ClientMeeting[];
  past: ClientMeeting[];
  cancelled: ClientMeeting[];
} {
  const t = now.getTime();
  const cancelled = list.filter((m) => m.status === "cancelled").sort((a, b) => (at(b) || 0) - (at(a) || 0));
  const live = list.filter((m) => m.status !== "cancelled");
  const ahead = live
    .filter((m) => m.status === "scheduled" && (Number.isNaN(at(m)) || at(m) >= t))
    .sort((a, b) => (Number.isNaN(at(a)) ? Infinity : at(a)) - (Number.isNaN(at(b)) ? Infinity : at(b)));
  const past = live.filter((m) => !ahead.includes(m)).sort((a, b) => (at(b) || 0) - (at(a) || 0));
  const [first, ...rest] = ahead;
  // An undated meeting is "upcoming", but the next meeting is one with a time.
  const next = first && !Number.isNaN(at(first)) ? first : null;
  return { next, upcoming: next ? rest : ahead, past, cancelled };
}

const he = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", ...options }).format(new Date(iso));

/** The next meeting's date tile: "נובמבר", "4", "יום ג׳" — Israel's calendar. */
export function dateTile(iso: string): { month: string; day: string; weekday: string } {
  return { month: he(iso, { month: "long" }), day: he(iso, { day: "numeric" }), weekday: he(iso, { weekday: "short" }) };
}

/** "10:00–10:45" on Israel's clock. */
export function timeRange(iso: string, durationMin: number | null): string {
  const end = new Date(new Date(iso).getTime() + (durationMin ?? DEFAULT_DURATION_MIN) * 60_000).toISOString();
  const hm = (v: string) => he(v, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${hm(iso)}–${hm(end)}`;
}

/** "יום א׳, 14 בדצמבר · 17:30" — an upcoming meeting's line. */
export function longWhen(iso: string | null): string {
  if (!iso) return "המועד טרם נקבע";
  return `${he(iso, { weekday: "short" })}, ${he(iso, { day: "numeric", month: "long" })} · ${he(iso, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
}

/** "22 בספטמבר" — a past meeting's or a publication's day. */
export function dayMonth(iso: string | null): string {
  return iso ? he(iso, { day: "numeric", month: "long" }) : "";
}
