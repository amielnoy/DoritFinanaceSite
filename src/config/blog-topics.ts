/**
 * The blog's five topic buttons, and which one each article belongs to.
 *
 * An article's tags are listed most-important first in its front matter, so
 * it belongs to the topic of its own first tag that names one — not to the
 * first topic in this list it happens to touch. Read the second way, nearly
 * every article is "pension" (most mention it somewhere), including the
 * year-end tax guide.
 */

export type TopicId = "all" | "pension" | "insurance" | "family" | "tax";
type Topic = Exclude<TopicId, "all">;

export const TOPICS: readonly { id: TopicId; label: string }[] = [
  { id: "all", label: "הכל" },
  { id: "pension", label: "פנסיה וגמל" },
  { id: "insurance", label: "ביטוח" },
  { id: "family", label: "משפחה ואירועי חיים" },
  { id: "tax", label: "מיסוי ועצמאים" },
];

const TOPIC_TAGS: Record<Topic, readonly string[]> = {
  pension: ["פנסיה", "גמל והשתלמות", "דמי ניהול", "תשואות", "ניוד", "קרנות ברירת מחדל", "AI"],
  insurance: ["ביטוח", "בריאות", "ביטוח חיים", "משכנתא", "אובדן כושר עבודה"],
  family: ["ילדים", "חיסכון", "פיצויים", "משפחה"],
  tax: ["מיסוי", "החזר מס", "עצמאים", "נקודות זיכוי", "סוף שנה"],
};

/** Too general to decide a topic while any other tag can. */
const FAMILY_FALLBACK_TAG = "תכנון פיננסי";

const TAG_TO_TOPIC = new Map<string, Topic>(
  (Object.entries(TOPIC_TAGS) as [Topic, readonly string[]][]).flatMap(([topic, tags]) =>
    tags.map((tag) => [tag, topic] as const)
  )
);

export function topicOf(tags: string | undefined): Topic | null {
  const list = (tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  for (const tag of list) {
    const topic = TAG_TO_TOPIC.get(tag);
    if (topic) return topic;
  }
  return list.includes(FAMILY_FALLBACK_TAG) ? "family" : null;
}

export function topicCounts(posts: readonly { tags?: string }[]): Record<TopicId, number> {
  const counts: Record<TopicId, number> = { all: posts.length, pension: 0, insurance: 0, family: 0, tax: 0 };
  for (const p of posts) {
    const topic = topicOf(p.tags);
    if (topic) counts[topic] += 1;
  }
  return counts;
}

const NAMED_DURATIONS: Record<string, number> = {
  "רבע שעה": 15,
  "חצי שעה": 30,
  "שעה": 60,
  "ערב אחד": 180,
  "חודש ראשון": 30 * 24 * 60,
};

/**
 * An article's `action_time` in minutes, for ordering "fastest to do" — the
 * field is free Hebrew for the reader ("רבע שעה"), not a number. Anything
 * unreadable sorts last: an unknown time must not be presented as the quickest.
 */
export function actionMinutes(actionTime: string | undefined): number {
  const text = (actionTime ?? "").trim();
  if (text in NAMED_DURATIONS) return NAMED_DURATIONS[text];
  const minutes = text.match(/^(\d+)\s*דקות?$/);
  if (minutes) return Number(minutes[1]);
  const hours = text.match(/^(\d+)\s*שעות$/);
  if (hours) return Number(hours[1]) * 60;
  return Infinity;
}

/**
 * The article pinned above the grid while its deadline is ahead.
 *
 * Matched by title, so renaming the article unpins it; a unit test fails if
 * the title stops matching one in content/blog. The page also drops the row
 * when the article is not published.
 */
export const FEATURED = {
  title: "עצמאים: מה להפקיד עד 31 בדצמבר כדי לא לוותר על הטבת מס",
  badge: "עד 31.12 · מועד אחרון",
  until: "2026-12-31",
} as const;

/** The topics the featured row appears under. */
export const FEATURED_TOPICS: readonly TopicId[] = ["all", "tax"];

/** Through the whole of `until`, by the Israeli calendar — the reader's. */
export function isFeaturedLive(now: Date = new Date()): boolean {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return today <= FEATURED.until;
}
