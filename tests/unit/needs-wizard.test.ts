import { describe, expect, it } from "vitest";
import { CONCERNS, TOPIC_BY_TRACK, TRACK_QUESTIONS, UNKNOWN, UNKNOWN_LABEL, type Track } from "@/config/needs-wizard";
import {
  buildProfile,
  emptyState,
  meetingTopicOf,
  scheduledAtOf,
  timingOf,
  toInterviewSummary,
  trackOf,
  type WizardState,
} from "@/lib/needs-wizard";
import { dayChoices, israelToday } from "@/lib/wall-clock";
import { isIsraeliPhone } from "@/lib/phone";

const state = (over: Partial<WizardState> = {}): WizardState => ({ ...emptyState(), ...over });

/** 01:30 on Tuesday 13 October in Israel — still Monday the 12th in UTC. */
const NEAR_MIDNIGHT = new Date("2026-10-12T22:30:00Z");

describe("track → questions", () => {
  const expected: Record<Track, string[]> = {
    pension: ["employer", "seniority", "products", "fees"],
    insurance: ["dependents", "mortgage", "health_flag", "coverage"],
    retirement: ["retirement_horizon", "employment_status", "rights_fixing", "severance_history"],
    tax: ["tax_event", "filing_status", "prior_handling", "products"],
    savings: ["horizon", "purpose", "existing_savings", "liquidity"],
    self_employed: ["business_type", "years_active", "pension_status", "study_fund_status"],
    general: ["products", "notes"],
  };

  it.each(Object.entries(expected))("the %s track asks exactly its four (or two) questions", (track, keys) => {
    expect(TRACK_QUESTIONS[track as Track].map((q) => q.key)).toEqual(keys);
  });

  it("each concern leads to its track, and a skipped concern to the general one", () => {
    for (const c of CONCERNS.filter((x) => x.track)) expect(trackOf(state({ concern: c.label }))).toBe(c.track);
    expect(trackOf(state())).toBe("general");
  });

  it("never asks for an ID number", () => {
    const everything = JSON.stringify(TRACK_QUESTIONS);
    expect(everything).not.toMatch(/ת״ז|ת"ז|תעודת זהות/);
  });
});

describe("'לא יודע/ת' is an answer; skipping is not", () => {
  const pension = (answers: WizardState["answers"], extra: Partial<WizardState> = {}) =>
    buildProfile(state({ concern: "דמי ניהול / הפנסיה שלי", answers, ...extra }));

  it("records 'לא ידוע למבקר' for the don't-know chip", () => {
    const profile = pension({ seniority: UNKNOWN_LABEL, products: [UNKNOWN_LABEL] });
    expect(profile.seniority).toBe(UNKNOWN);
    expect(profile.products).toBe(UNKNOWN);
  });

  it("omits a question that was not answered — never writes 'לא ידוע' for it", () => {
    const profile = pension({ employer: "שכיר/ה" });
    expect(profile).not.toHaveProperty("seniority");
    expect(profile).not.toHaveProperty("fees");
    expect(Object.values(profile)).not.toContain(UNKNOWN);
  });

  it("joins a multi-select into one Hebrew string", () => {
    expect(pension({ products: ["פנסיה", "השתלמות"] }).products).toBe("פנסיה, השתלמות");
  });

  it("records typed fees as the visitor gave them", () => {
    expect(pension({ fees: "יודע/ת" }, { feesText: "0.5% מהצבירה" }).fees).toBe("0.5% מהצבירה, לפי מה שנמסר");
  });

  it("records the clearinghouse answer as the agent does, and omits it when unanswered", () => {
    expect(buildProfile(state({ answers: { clearinghouse: "לא כרגע" } })).clearinghouse).toBe("לא");
    expect(buildProfile(state({ answers: { clearinghouse: "מעוניין/ת" } })).clearinghouse).toBe("מעוניין/ת");
    expect(buildProfile(state())).not.toHaveProperty("clearinghouse");
  });

  it("drops answers to another track's questions when the track changed", () => {
    // Answered on the pension screen, then went back and chose insurance.
    const profile = buildProfile(state({ concern: "ביטוחים והגנה על המשפחה", answers: { employer: "שכיר/ה", mortgage: "אין" } }));
    expect(profile).not.toHaveProperty("employer");
    expect(profile.mortgage).toBe("אין");
  });
});

describe("meeting topic", () => {
  it.each(Object.entries(TOPIC_BY_TRACK))("is derived from the %s track", (track, topic) => {
    const concern = CONCERNS.find((c) => c.track === track)!.label;
    expect(meetingTopicOf(state({ concern }))).toBe(topic);
  });

  it("follows the visitor's own change", () => {
    expect(meetingTopicOf(state({ concern: "דמי ניהול / הפנסיה שלי", topic: "ביטוחי חיים ובריאות" }))).toBe("ביטוחי חיים ובריאות");
  });
});

describe("scheduledAt, on Israel's wall clock", () => {
  it("names Israel's day, not UTC's, near midnight", () => {
    expect(israelToday(NEAR_MIDNIGHT)).toBe("2026-10-13");
    // A toISOString() implementation reads the 12th here and books Tuesday.
    expect(NEAR_MIDNIGHT.toISOString().slice(0, 10)).toBe("2026-10-12");
  });

  it("books 'tomorrow, morning' at 09:00 on Israel's tomorrow", () => {
    const stamp = scheduledAtOf(state({ day: "tomorrow", slot: "morning" }), NEAR_MIDNIGHT);
    expect(stamp).toBe("2026-10-14T09:00:00");
    expect(stamp).not.toMatch(/Z$|[+-]\d\d:\d\d$/);
  });

  it("starts at the slot's first hour", () => {
    expect(scheduledAtOf(state({ day: "tomorrow", slot: "afternoon" }), NEAR_MIDNIGHT)).toBe("2026-10-14T15:00:00");
  });

  it("is empty when no day was chosen", () => {
    expect(scheduledAtOf(state({ slot: "morning" }), NEAR_MIDNIGHT)).toBe("");
  });

  it("uses a picked date as given", () => {
    expect(scheduledAtOf(state({ day: "date", date: "2026-10-20", slot: "noon" }), NEAR_MIDNIGHT)).toBe("2026-10-20T12:00:00");
  });

  it("offers no 'tomorrow' or 'this week' on a Thursday, and next week starts on Sunday", () => {
    const thursday = dayChoices(new Date("2026-10-15T12:00:00Z"));
    expect(thursday.tomorrow).toBeUndefined();
    expect(thursday.thisWeek).toBeUndefined();
    expect(thursday.nextWeek).toBe("2026-10-18");
  });

  it("'this week' is the next working day this week", () => {
    expect(dayChoices(NEAR_MIDNIGHT).thisWeek).toBe("2026-10-14");
  });

  it("says the time as a person would", () => {
    expect(timingOf(state({ day: "next_week", slot: "morning" }))).toBe("השבוע הבא, בוקר 09:00–12:00");
  });
});

describe("the submitted payload", () => {
  it("matches InterviewSummary, with exactly the track's profile keys", () => {
    const summary = toInterviewSummary(
      state({
        concern: "חיסכון למטרה",
        answers: { life_stage: "משפחה עם ילדים קטנים", goal: "לחסוך למטרה", horizon: "3–10 שנים", existing_savings: ["פיקדון", "חיסכון לכל ילד"], clearinghouse: "לא כרגע" },
        day: "next_week",
        slot: "noon",
        name: " רונית ",
        phone: "050-1234567",
        email: "",
        notes: "אפשר גם בזום",
      }),
      NEAR_MIDNIGHT,
    );
    expect(summary).toMatchObject({
      name: "רונית",
      phone: "050-1234567",
      track: "savings",
      meetingTopic: "גמל, השתלמות ופנסיה",
      timing: "השבוע הבא, צהריים 12:00–15:00",
      scheduledAt: "2026-10-18T12:00:00",
      notes: "אפשר גם בזום",
    });
    expect(summary.email).toBeUndefined();
    expect(Object.keys(summary.profile!).sort()).toEqual(
      ["clearinghouse", "concern", "existing_savings", "goal", "horizon", "life_stage"].sort(),
    );
    expect(summary.summary).toMatch(/חיסכון לטווח/);
  });
});

describe("isIsraeliPhone", () => {
  it.each(["0501234567", "050-123-4567", "03 123 4567", "021234567"])("accepts %s", (p) => expect(isIsraeliPhone(p)).toBe(true));
  it.each(["501234567", "+972501234567", "05012345", "050123456789", "abc"])("refuses %s", (p) => expect(isIsraeliPhone(p)).toBe(false));
});
