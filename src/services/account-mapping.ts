import type { Enquiry } from "./ports";

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * One enquiry row, as `enquiries_for` returns it, in the page's shape.
 *
 * Shared by both adapters so the two sign-ins cannot disagree about what a
 * row means. `profile` is trusted only as an array of string pairs: anything
 * else — an old row, a hand-edited one — becomes "no answers stored" rather
 * than something the page tries to render.
 */
export function toEnquiry(row: Record<string, unknown>): Enquiry {
  const profile = Array.isArray(row.profile)
    ? (row.profile as unknown[]).filter(
        (p): p is [string, string] =>
          Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string"
      )
    : [];
  return {
    createdAt: String(row.created_at ?? ""),
    source: String(row.source ?? ""),
    track: str(row.track),
    trackLabel: str(row.track_label),
    meetingTopic: str(row.meeting_topic),
    timing: str(row.timing),
    scheduledAt: str(row.scheduled_at),
    summary: str(row.summary),
    profile,
    completed: row.completed !== false,
    inCalendar: row.in_calendar === true,
  };
}
