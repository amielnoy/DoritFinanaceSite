import { describe, expect, it } from "vitest";
import type { AgendaMeeting } from "@/services/ports";
import {
  AWAITING_SUMMARY_LABEL, agendaCounts, agendaGroups, dayLabel, endOfWeek, nextMeetingByLead, nextMeetingLabel, needsSummary,
} from "@/lib/meetings-agenda";

/*
 * The agenda on /admin/leads ("פגישות") and the leads table's "הפגישה הבאה":
 * which meetings each view holds, and how they fall into Israel's days. Israel
 * leaves summer time at 02:00 on Sunday 25 October 2026, so the week below
 * crosses a daylight-saving change as well as midnights.
 */

// Thursday 22 October 2026, 10:00 in Israel (+03:00).
const NOW = new Date("2026-10-22T07:00:00Z");

const m = (id: string, scheduledAt: string | null, over: Partial<AgendaMeeting> = {}): AgendaMeeting => ({
  id, leadId: `lead-${id}`, leadName: `לקוח ${id}`, assignedUserId: null, scheduledAt, durationMin: 45, topic: "", kind: "follow_up",
  status: "scheduled", mode: "office", location: "", summaryPublishedAt: null, source: null, openRequest: null, ...over,
});

const shape = (groups: ReturnType<typeof agendaGroups>) => groups.map((g) => [g.label, g.meetings.map((x) => x.id)]);

describe("agendaGroups — by Israel's day", () => {
  it("files a meeting by Israel's calendar across midnight, not by UTC's", () => {
    const list = [
      m("late", "2026-10-22T20:59:00Z"), // Thu 23:59 — today
      m("after-midnight", "2026-10-22T21:15:00Z"), // Fri 00:15 — tomorrow, though still the 22nd in UTC
      m("morning", "2026-10-22T05:00:00Z"), // Thu 08:00 — today, its hour gone but not marked held
    ];
    expect(shape(agendaGroups(list, "upcoming", NOW))).toEqual([
      ["היום", ["morning", "late"]],
      ["מחר", ["after-midnight"]],
    ]);
  });

  it("keeps a day whole across the change from summer to winter time", () => {
    const list = [
      m("mon", "2026-10-25T23:30:00Z"), // Mon 26, 01:30 (+02) — the 25th in UTC
      m("sun-late", "2026-10-25T21:30:00Z"), // Sun 25, 23:30 (+02)
      m("sun-early", "2026-10-24T21:30:00Z"), // Sun 25, 00:30 (+03) — the 24th in UTC
    ];
    expect(shape(agendaGroups(list, "upcoming", NOW))).toEqual([
      ["יום ראשון, 25.10", ["sun-early", "sun-late"]],
      ["יום שני, 26.10", ["mon"]],
    ]);
  });

  it("puts the undated last, then the held meetings waiting for a summary, most recent first", () => {
    const list = [
      m("undated", null),
      m("tomorrow", "2026-10-23T06:00:00Z"),
      m("held-old", "2026-10-15T07:00:00Z", { status: "done" }),
      m("held-new", "2026-10-21T07:00:00Z", { status: "done" }),
      m("summarised", "2026-10-20T07:00:00Z", { status: "done", summaryPublishedAt: "2026-10-20T10:00:00Z" }),
      m("cancelled", "2026-10-23T08:00:00Z", { status: "cancelled" }),
      m("forgotten", "2026-10-20T07:00:00Z"), // scheduled, two days ago: past, not upcoming
    ];
    expect(shape(agendaGroups(list, "upcoming", NOW))).toEqual([
      ["מחר", ["tomorrow"]],
      ["ללא מועד", ["undated"]],
      [AWAITING_SUMMARY_LABEL, ["held-new", "held-old"]],
    ]);
  });

  it("shows the past most recent day first, without the cancelled", () => {
    const list = [
      m("a", "2026-10-20T07:00:00Z", { status: "done" }),
      m("b", "2026-10-21T07:00:00Z", { status: "no_show" }),
      m("c", "2026-10-21T05:00:00Z"),
      m("x", "2026-10-21T08:00:00Z", { status: "cancelled" }),
      m("ahead", "2026-10-23T08:00:00Z"),
    ];
    expect(shape(agendaGroups(list, "past", NOW))).toEqual([
      ["יום רביעי, 21.10", ["b", "c"]],
      ["יום שלישי, 20.10", ["a"]],
    ]);
  });

  it("narrows to requests, to held meetings without a summary, and to the cancelled", () => {
    const request = { id: "r-1", kind: "reschedule" as const, note: "" };
    const list = [
      m("req", "2026-10-26T07:00:00Z", { openRequest: request }),
      m("held", "2026-10-21T07:00:00Z", { status: "done" }),
      m("gone", "2026-10-23T07:00:00Z", { status: "cancelled" }),
      m("plain", "2026-10-23T09:00:00Z"),
    ];
    expect(agendaGroups(list, "requests", NOW).flatMap((g) => g.meetings.map((x) => x.id))).toEqual(["req"]);
    expect(agendaGroups(list, "unsummarised", NOW).flatMap((g) => g.meetings.map((x) => x.id))).toEqual(["held"]);
    expect(agendaGroups(list, "cancelled", NOW).flatMap((g) => g.meetings.map((x) => x.id))).toEqual(["gone"]);
  });

  it("holds today, and this week to Saturday, for the two cards", () => {
    const list = [
      m("today", "2026-10-22T12:00:00Z"),
      m("sat", "2026-10-24T08:00:00Z"),
      m("sun", "2026-10-25T08:00:00Z"),
    ];
    expect(agendaGroups(list, "today", NOW).flatMap((g) => g.meetings.map((x) => x.id))).toEqual(["today"]);
    expect(agendaGroups(list, "week", NOW).flatMap((g) => g.meetings.map((x) => x.id))).toEqual(["today", "sat"]);
  });
});

describe("agendaCounts", () => {
  it("counts today, the rest of the week, open requests and held meetings without a summary", () => {
    const list = [
      m("today", "2026-10-22T12:00:00Z"),
      m("today-held", "2026-10-22T05:00:00Z", { status: "done" }),
      m("fri", "2026-10-22T21:15:00Z"),
      m("sun", "2026-10-25T08:00:00Z", { openRequest: { id: "r", kind: "cancel", note: "" } }),
      m("yesterday", "2026-10-21T07:00:00Z", { status: "done", summaryPublishedAt: "2026-10-21T10:00:00Z" }),
    ];
    expect(agendaCounts(list, NOW)).toEqual({ today: 1, week: 2, requests: 1, unsummarised: 1 });
  });

  it("ends the week on Saturday", () => {
    expect(endOfWeek("2026-10-22")).toBe("2026-10-24");
    expect(endOfWeek("2026-10-25")).toBe("2026-10-31");
  });
});

describe("the next meeting", () => {
  it("is the soonest scheduled one not yet over — one in progress still counts", () => {
    const list = [
      m("over", "2026-10-22T05:00:00Z", { leadId: "a" }), // 08:00–08:45, over
      m("now", "2026-10-22T06:30:00Z", { leadId: "a" }), // 09:30–10:15, in progress
      m("later", "2026-10-23T06:30:00Z", { leadId: "a" }),
      m("cancelled", "2026-10-22T08:00:00Z", { leadId: "b", status: "cancelled" }),
      m("undated", null, { leadId: "b" }),
    ];
    const next = nextMeetingByLead(list, NOW);
    expect(next.get("a")?.id).toBe("now");
    expect(next.has("b")).toBe(false);
  });

  it("reads 'היום', 'מחר', a weekday within the week ahead, and a date beyond it", () => {
    expect(nextMeetingLabel("2026-10-22T07:00:00Z", NOW)).toBe("היום 10:00");
    expect(nextMeetingLabel("2026-10-23T14:30:00Z", NOW)).toBe("מחר 17:30");
    expect(nextMeetingLabel("2026-10-28T10:00:00Z", NOW)).toBe("רביעי 12:00"); // +02:00 by then
    expect(nextMeetingLabel("2026-12-14T15:30:00Z", NOW)).toBe("14.12 · 17:30");
  });

  it("names the hour on Israel's clock on either side of the change", () => {
    expect(nextMeetingLabel("2026-10-24T21:30:00Z", NOW)).toBe("ראשון 00:30");
    expect(nextMeetingLabel("2026-10-25T21:30:00Z", NOW)).toBe("ראשון 23:30");
  });
});

describe("the card's action", () => {
  it("asks for a summary once a meeting is held or its time has passed, until one is published", () => {
    expect(needsSummary(m("held", "2026-10-21T07:00:00Z", { status: "done" }), NOW)).toBe(true);
    expect(needsSummary(m("passed", "2026-10-22T05:00:00Z"), NOW)).toBe(true);
    expect(needsSummary(m("ahead", "2026-10-22T09:00:00Z"), NOW)).toBe(false);
    expect(needsSummary(m("published", "2026-10-21T07:00:00Z", { status: "done", summaryPublishedAt: "x" }), NOW)).toBe(false);
    expect(needsSummary(m("cancelled", "2026-10-21T07:00:00Z", { status: "cancelled" }), NOW)).toBe(false);
  });

  it("labels days relative to Israel's today", () => {
    expect(dayLabel("2026-10-22", "2026-10-22")).toBe("היום");
    expect(dayLabel("2026-10-23", "2026-10-22")).toBe("מחר");
    expect(dayLabel("2026-10-21", "2026-10-22")).toBe("יום רביעי, 21.10");
  });
});
