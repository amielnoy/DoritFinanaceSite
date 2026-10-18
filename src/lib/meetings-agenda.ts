import type { AgendaMeeting } from "@/services/ports";
import { DEFAULT_DURATION_MIN, meetingWhen } from "@/lib/meetings";
import { addDays, hebrewDay, israelToday, israelWallClock, weekday, type Ymd } from "@/lib/wall-clock";

/**
 * The agency's agenda on /admin/leads ("פגישות"): which meetings each view
 * holds, how they group by day, and how the leads table names a lead's next
 * meeting. Every day here is Israel's calendar day and every hour Israel's
 * wall clock (A-63) — never UTC's, which names the wrong day near midnight and
 * shifts an hour across a daylight-saving change.
 *
 * Pure: the meetings and the instant `now` in, the answer out.
 */

/** The agenda's views: the chips, and the two cards that are not chips. */
export type AgendaFilter = "upcoming" | "past" | "requests" | "unsummarised" | "cancelled" | "today" | "week";

export interface AgendaGroup {
  key: string;
  label: string;
  meetings: AgendaMeeting[];
}

export interface AgendaCounts {
  /** Scheduled for today. */
  today: number;
  /** Scheduled from today to Saturday, the end of Israel's week. */
  week: number;
  /** With a client's request still open. */
  requests: number;
  /** Held, and no summary published to the client. */
  unsummarised: number;
}

const WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

const startMs = (m: AgendaMeeting) => (m.scheduledAt ? Date.parse(m.scheduledAt) : Number.NaN);
const endMs = (m: AgendaMeeting) => startMs(m) + (m.durationMin ?? DEFAULT_DURATION_MIN) * 60_000;

/** The meeting's day on Israel's calendar; null without a time. */
export function meetingDay(m: AgendaMeeting): Ymd | null {
  return m.scheduledAt ? (israelWallClock(m.scheduledAt)?.ymd ?? null) : null;
}

/** "10:00" on Israel's clock; "" without a time. */
export function meetingTime(m: AgendaMeeting): string {
  return m.scheduledAt ? (israelWallClock(m.scheduledAt)?.hhmm ?? "") : "";
}

/** Saturday of `today`'s week: Israel's week runs Sunday to Saturday. */
export const endOfWeek = (today: Ymd): Ymd => addDays(today, 6 - weekday(today));

/**
 * Still ahead: scheduled, on today or later — the whole of today, so a meeting
 * at 09:00 not yet marked held stays on today's list in the afternoon. A
 * scheduled meeting with no time is ahead too (it has not happened).
 */
export function isUpcoming(m: AgendaMeeting, today: Ymd): boolean {
  if (m.status !== "scheduled") return false;
  const day = meetingDay(m);
  return day === null || day >= today;
}

/** "התקיימו, בלי סיכום": held, and nothing published to the client. */
export const isAwaitingSummary = (m: AgendaMeeting): boolean => m.status === "done" && !m.summaryPublishedAt;

/**
 * Whether the card's action is "כתיבת סיכום": nothing published, and the
 * meeting held or its time gone by (still "scheduled" because nobody marked it).
 */
export function needsSummary(m: AgendaMeeting, now: Date): boolean {
  if (m.summaryPublishedAt) return false;
  return m.status === "done" || (m.status === "scheduled" && startMs(m) < now.getTime());
}

export function agendaCounts(list: readonly AgendaMeeting[], now: Date): AgendaCounts {
  const today = israelToday(now);
  const saturday = endOfWeek(today);
  const counts: AgendaCounts = { today: 0, week: 0, requests: 0, unsummarised: 0 };
  for (const m of list) {
    const day = meetingDay(m);
    if (m.status === "scheduled" && day !== null) {
      if (day === today) counts.today += 1;
      if (day >= today && day <= saturday) counts.week += 1;
    }
    if (m.openRequest) counts.requests += 1;
    if (isAwaitingSummary(m)) counts.unsummarised += 1;
  }
  return counts;
}

/** A day group's heading: "היום", "מחר", else "יום רביעי, 22.10". */
export function dayLabel(day: Ymd, today: Ymd): string {
  if (day === today) return "היום";
  if (day === addDays(today, 1)) return "מחר";
  return hebrewDay(day);
}

const byStart = (descending: boolean) => (a: AgendaMeeting, b: AgendaMeeting) =>
  descending ? startMs(b) - startMs(a) : startMs(a) - startMs(b);

/**
 * Meetings grouped by Israel's day, in `order`, each day's meetings in the same
 * order; the ones with no time last, under "ללא מועד".
 */
export function groupByDay(list: readonly AgendaMeeting[], today: Ymd, order: "asc" | "desc"): AgendaGroup[] {
  const dated = list.filter((m) => meetingDay(m) !== null).sort(byStart(order === "desc"));
  const groups: AgendaGroup[] = [];
  for (const m of dated) {
    const day = meetingDay(m)!;
    const last = groups[groups.length - 1];
    if (last?.key === day) last.meetings.push(m);
    else groups.push({ key: day, label: dayLabel(day, today), meetings: [m] });
  }
  const undated = list.filter((m) => meetingDay(m) === null);
  if (undated.length) groups.push({ key: "undated", label: "ללא מועד", meetings: undated });
  return groups;
}

export const AWAITING_SUMMARY_LABEL = "התקיימו — ממתינות לסיכום";

/**
 * What a view shows. "קרובות" is the days ahead, soonest first, and after them
 * the held meetings still waiting for a summary, most recent first.
 */
export function agendaGroups(list: readonly AgendaMeeting[], filter: AgendaFilter, now: Date): AgendaGroup[] {
  const today = israelToday(now);
  const saturday = endOfWeek(today);
  const scheduledOn = (test: (day: Ymd) => boolean) =>
    list.filter((m) => {
      const day = meetingDay(m);
      return m.status === "scheduled" && day !== null && test(day);
    });
  switch (filter) {
    case "upcoming": {
      const groups = groupByDay(list.filter((m) => isUpcoming(m, today)), today, "asc");
      const waiting = list.filter(isAwaitingSummary).sort(byStart(true));
      return waiting.length ? [...groups, { key: "awaiting-summary", label: AWAITING_SUMMARY_LABEL, meetings: waiting }] : groups;
    }
    case "today":
      return groupByDay(scheduledOn((day) => day === today), today, "asc");
    case "week":
      return groupByDay(scheduledOn((day) => day >= today && day <= saturday), today, "asc");
    case "past":
      return groupByDay(list.filter((m) => m.status !== "cancelled" && !isUpcoming(m, today)), today, "desc");
    case "requests":
      return groupByDay(list.filter((m) => m.openRequest), today, "asc");
    case "unsummarised":
      return groupByDay(list.filter(isAwaitingSummary), today, "desc");
    case "cancelled":
      return groupByDay(list.filter((m) => m.status === "cancelled"), today, "desc");
  }
}

/**
 * Each lead's next meeting: scheduled, with a time, and not yet over (one in
 * progress still counts); the soonest wins.
 */
export function nextMeetingByLead(list: readonly AgendaMeeting[], now: Date): Map<string, AgendaMeeting> {
  const t = now.getTime();
  const next = new Map<string, AgendaMeeting>();
  for (const m of list) {
    if (m.status !== "scheduled" || !m.scheduledAt || !(endMs(m) > t)) continue;
    const held = next.get(m.leadId);
    if (!held || startMs(m) < startMs(held)) next.set(m.leadId, m);
  }
  return next;
}

/**
 * How the leads table names a next meeting: "היום 10:00", "מחר 17:30",
 * "רביעי 12:00" within the week ahead, and "14.12 · 17:30" further off — a
 * weekday alone would be ambiguous past six days.
 */
export function nextMeetingLabel(iso: string, now: Date): string {
  const at = israelWallClock(iso);
  if (!at) return meetingWhen(null);
  const today = israelToday(now);
  if (at.ymd === today) return `היום ${at.hhmm}`;
  if (at.ymd === addDays(today, 1)) return `מחר ${at.hhmm}`;
  if (at.ymd > today && at.ymd <= addDays(today, 6)) return `${WEEKDAYS[weekday(at.ymd)]} ${at.hhmm}`;
  return meetingWhen(iso);
}
