import { readSnapshot } from "@/lib/clearinghouse/snapshot";
import type { ClientSnapshot, Enquiry, PublishedRecommendation, RecommendationPriority } from "./ports";

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

export const priorityOf = (value: unknown): RecommendationPriority | null =>
  value === "important" || value === "check" ? value : null;

/** A published item's client-facing fields, or null when a row does not fit them. */
export function toPublishedRecommendation(row: Record<string, unknown>): PublishedRecommendation | null {
  const priority = priorityOf(row.priority);
  if (typeof row.id !== "string" || typeof row.title !== "string" || typeof row.body !== "string" || !priority) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    priority,
    clientStatus: row.client_status === "accepted" || row.client_status === "question" ? row.client_status : "open",
    clientNote: typeof row.client_note === "string" && row.client_note ? row.client_note : null,
  };
}

/**
 * `my_snapshot()`'s answer in the page's shape, or null when there is none or
 * it cannot be read. The snapshot goes through `readSnapshot`, so a malformed
 * report shows as "no snapshot yet" rather than half a page.
 */
export function toClientSnapshot(value: unknown): ClientSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const snapshot = readSnapshot(v.data);
  if (!snapshot || typeof v.published_at !== "string") return null;
  const items = Array.isArray(v.items)
    ? v.items.flatMap((i) => {
        const item = i && typeof i === "object" ? toPublishedRecommendation(i as Record<string, unknown>) : null;
        return item ? [item] : [];
      })
    : [];
  return { takenAt: typeof v.taken_at === "string" ? v.taken_at : snapshot.takenAt, publishedAt: v.published_at, snapshot, items };
}
