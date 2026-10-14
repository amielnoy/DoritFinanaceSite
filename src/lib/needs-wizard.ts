import type { InterviewSummary } from "@/lib/interview-handoff";
import {
  CALL_TIME,
  CLEARINGHOUSE,
  CLEARINGHOUSE_REPORT,
  CLEARINGHOUSE_VALUES,
  CONCERNS,
  DAY_LABELS,
  GOAL,
  LIFE_STAGE,
  URGENCY,
  SLOTS,
  TOPIC_BY_TRACK,
  TRACK_QUESTIONS,
  UNKNOWN,
  UNKNOWN_LABEL,
  type DayChoice,
  type MeetingTopic,
  type Question,
  type SlotKey,
  type Track,
} from "@/config/needs-wizard";
import { dayChoices, hebrewDay, wallClockStamp, type Ymd } from "@/lib/wall-clock";

/** One question's answer: a chip's label, several, or typed text. */
export type Answer = string | readonly string[];

/** Everything the wizard holds, in the visitor's own choices — nothing derived. */
export interface WizardState {
  /** By profile key. A key that is absent was not answered. */
  answers: Record<string, Answer>;
  /** The concern chip, by its label. */
  concern?: string;
  /** The free text behind "יודע/ת" on fees. */
  feesText?: string;
  /** Set only when the visitor changed the topic the track implies. */
  topic?: MeetingTopic;
  day?: DayChoice;
  /** The picked date, when `day` is "date". */
  date?: Ymd;
  slot?: SlotKey;
  name: string;
  phone: string;
  email: string;
  notes: string;
}

export const emptyState = (): WizardState => ({ answers: {}, name: "", phone: "", email: "", notes: "" });

export const TRACK_LABELS: Record<Track, string> = {
  pension: "פנסיה, גמל והשתלמות",
  insurance: "ביטוחי חיים ובריאות",
  retirement: "פרישה וקיבוע זכויות",
  tax: "מיסוי ופיננסים",
  savings: "חיסכון לטווח",
  self_employed: "עצמאים",
  general: "הקשר כללי",
};

/** The track the concern implies; a skipped concern is the general track. */
export function trackOf(state: WizardState): Track {
  return CONCERNS.find((c) => c.label === state.concern)?.track ?? "general";
}

export const isClaim = (concern?: string): boolean =>
  CONCERNS.some((c) => c.label === concern && c.claim);

/**
 * What one question contributes to the profile, or nothing.
 *
 * Two answers that must never be confused, because Dorit reads them
 * differently: "לא יודע/ת" is an answer and records `UNKNOWN`; a question left
 * unanswered records nothing at all — never "לא ידוע".
 */
export function valueOf(question: Question, answer: Answer | undefined, state: WizardState): string | undefined {
  if (question.textOnly) {
    const text = typeof answer === "string" ? answer.trim() : "";
    return text || undefined;
  }
  if (answer === undefined) return undefined;
  const chosen = typeof answer === "string" ? [answer] : [...answer];
  if (chosen.length === 0) return undefined;
  if (chosen.includes(UNKNOWN_LABEL)) return UNKNOWN;
  if (question.revealsText && chosen[0] === question.revealsText.option) {
    const typed = (state.feesText ?? "").trim();
    return typed ? `${typed}, לפי מה שנמסר` : "ידוע למבקר";
  }
  if (question.key === CLEARINGHOUSE.key) return CLEARINGHOUSE_VALUES[chosen[0]] ?? chosen[0];
  return chosen.join(", ");
}

/** The profile, with exactly the keys `submitLead` keeps for this track. */
export function buildProfile(state: WizardState): Record<string, string> {
  const profile: Record<string, string> = {};
  const put = (key: string, value: string | undefined) => {
    if (value) profile[key] = value;
  };
  put(LIFE_STAGE.key, valueOf(LIFE_STAGE, state.answers[LIFE_STAGE.key], state));
  put(GOAL.key, valueOf(GOAL, state.answers[GOAL.key], state));
  if (state.concern) put("concern", state.concern);
  for (const q of TRACK_QUESTIONS[trackOf(state)]) put(q.key, valueOf(q, state.answers[q.key], state));
  put(CLEARINGHOUSE.key, valueOf(CLEARINGHOUSE, state.answers[CLEARINGHOUSE.key], state));
  put(URGENCY.key, valueOf(URGENCY, state.answers[URGENCY.key], state));
  put(CLEARINGHOUSE_REPORT.key, valueOf(CLEARINGHOUSE_REPORT, state.answers[CLEARINGHOUSE_REPORT.key], state));
  return profile;
}

export const meetingTopicOf = (state: WizardState): MeetingTopic => state.topic ?? TOPIC_BY_TRACK[trackOf(state)];

/** The calendar day the visitor asked for, if any. */
export function requestedDay(state: WizardState, now: Date): Ymd | undefined {
  if (!state.day) return undefined;
  if (state.day === "date") return state.date;
  const days = dayChoices(now);
  return state.day === "tomorrow" ? days.tomorrow : state.day === "this_week" ? days.thisWeek : days.nextWeek;
}

const slotOf = (key?: SlotKey) => SLOTS.find((s) => s.key === key);

/**
 * When the meeting goes in the diary, on Israel's wall clock.
 *
 * The start of the slot; a day with no slot starts at the first slot's start,
 * because the agent's rule is that a given day is booked — without `scheduledAt`
 * the meeting never reaches the diary at all. No day, no stamp.
 */
export function scheduledAtOf(state: WizardState, now: Date): string {
  const day = requestedDay(state, now);
  if (!day) return "";
  return wallClockStamp(day, (slotOf(state.slot) ?? SLOTS[0]).start);
}

/** The requested time as a person would say it: "השבוע הבא, בוקר 09:00–12:00". */
export function timingOf(state: WizardState): string {
  // The questionnaire asks a time of day only (2026-10-14); a day and a slot are
  // still read for anyone holding the older answers.
  const callTime = valueOf(CALL_TIME, state.answers[CALL_TIME.key], state);
  if (callTime && !state.day) return callTime;
  const day = state.day === "date" && state.date ? hebrewDay(state.date) : state.day && state.day !== "date" ? DAY_LABELS[state.day] : "";
  const slot = slotOf(state.slot)?.label ?? "";
  return [day, slot].filter(Boolean).join(", ");
}

/** A few plain lines for the top of Dorit's mail — what was said, not what it means. */
export function summaryTextOf(state: WizardState): string {
  const track = trackOf(state);
  const lines = [`ראיון היכרות שמולא בשאלון באתר. מסלול: ${TRACK_LABELS[track]}.`];
  if (state.concern) lines.push(`מה מעסיק: ${state.concern}.`);
  const goal = valueOf(GOAL, state.answers[GOAL.key], state);
  if (goal) lines.push(`יעד לפגישה: ${goal}.`);
  lines.push(`נושא הפגישה: ${meetingTopicOf(state)}.`);
  const timing = timingOf(state);
  if (timing) lines.push(`מועד מבוקש: ${timing}.`);
  return lines.join(" ");
}

/** Exactly what `submitInterview` receives — the same shape the chat's close sends. */
export function toInterviewSummary(state: WizardState, now: Date): InterviewSummary {
  const profile = buildProfile(state);
  return {
    name: state.name.trim(),
    phone: state.phone.trim(),
    email: state.email.trim() || undefined,
    track: trackOf(state),
    meetingTopic: meetingTopicOf(state),
    timing: timingOf(state) || undefined,
    scheduledAt: scheduledAtOf(state, now) || undefined,
    notes: state.notes.trim() || undefined,
    summary: summaryTextOf(state),
    profile: Object.keys(profile).length ? profile : undefined,
  };
}
