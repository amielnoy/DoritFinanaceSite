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
