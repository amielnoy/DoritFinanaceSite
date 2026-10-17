import { readSnapshot } from "@/lib/clearinghouse/snapshot";
import type { ClientMeeting, ClientSnapshot, Enquiry, PublishedRecommendation, RecommendationPriority } from "./ports";

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

const one = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/**
 * A row of `my_meetings()` — its twelve columns and no others. A value outside
 * a column's set falls back rather than reaching the page as a raw key; a
 * summary is shown only with its publication time, as the function sends it.
 */
export function toClientMeeting(row: Record<string, unknown>): ClientMeeting {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const time = (v: unknown) => (typeof v === "string" && !Number.isNaN(new Date(v).getTime()) ? v : null);
  const publishedAt = time(row.summary_published_at);
  const summary = text(row.client_summary).trim();
  return {
    id: text(row.id),
    scheduledAt: time(row.scheduled_at),
    durationMin: typeof row.duration_min === "number" ? row.duration_min : null,
    topic: text(row.topic),
    kind: one(row.kind, ["first", "follow_up", "annual_review", "other"] as const, "other"),
    status: one(row.status, ["scheduled", "done", "cancelled", "no_show"] as const, "scheduled"),
    mode: row.mode === "office" || row.mode === "phone" || row.mode === "video" ? row.mode : null,
    location: text(row.location),
    clientSummary: publishedAt && summary ? summary : null,
    summaryPublishedAt: publishedAt,
    inCalendar: row.in_calendar === true,
    openRequest: row.open_request === "reschedule" || row.open_request === "cancel" ? row.open_request : null,
  };
}

