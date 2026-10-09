// Which marketing channel brought a visitor, kept only as a channel name —
// never anything that could identify them — so GA4 events, lead emails and
// the saved lead record can all say where a lead came from.
//
// First-touch only: once a channel is on record for this browser, a later
// visit from a different channel does not overwrite it. That answers "what
// channel originally earned this visitor's attention" — the standard model
// for ranking marketing spend — not "what brought them back just now."
//
// This is the one place that reads `document.referrer` or the query string
// for attribution. Nothing else in the app does; everything else reads
// `getAttribution()`.

const STORAGE_KEY = "lead_attribution";
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export type Channel =
  | "google"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "ai_assistant"
  | "email"
  | "sms"
  | "referral"
  | "direct";

export interface Attribution {
  channel: Channel;
  campaign: string | null;
}

interface StoredAttribution extends Attribution {
  capturedAt: number;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** `utm_source` values that map directly to a channel — no referrer guessing needed. */
const UTM_SOURCE_MAP: Record<string, Channel> = {
  linkedin: "linkedin",
  facebook: "facebook",
  fb: "facebook",
  instagram: "instagram",
  ig: "instagram",
  google: "google",
  adwords: "google",
  cpc: "google",
};

/**
 * Referrer hostnames checked before the broad Google match. Gemini's own
 * referrer host (`gemini.google.com`) contains "google." too, so it has to be
 * excluded here first, or the broad suffix check below would misclassify
 * every AI-assistant visit that happens to come via Google's own domain as a
 * plain Google search.
 */
const AI_ASSISTANT_HOSTS = [
  "chat.openai.com",
  "chatgpt.com",
  "claude.ai",
  "perplexity.ai",
  "gemini.google.com",
];

const SOCIAL_HOSTS: Record<string, Channel> = {
  "facebook.com": "facebook",
  "fb.com": "facebook",
  "instagram.com": "instagram",
  "linkedin.com": "linkedin",
};

/** Strips a leading "www." so a regional or mobile subdomain still matches. */
function bareHost(hostname: string): string {
  return hostname.replace(/^www\./, "");
}

function hostMatches(host: string, known: string): boolean {
  return host === known || host.endsWith(`.${known}`);
}

function classifyReferrer(referrer: string): Channel {
  if (!referrer) return "direct";
  let hostname: string;
  try {
    hostname = new URL(referrer).hostname.toLowerCase();
  } catch {
    return "direct";
  }
  const host = bareHost(hostname);
  if (AI_ASSISTANT_HOSTS.some((known) => hostMatches(host, known))) return "ai_assistant";
  for (const [known, channel] of Object.entries(SOCIAL_HOSTS)) {
    if (hostMatches(host, known)) return channel;
  }
  if (/(^|\.)google\.[a-z.]+$/i.test(host)) return "google";
  return "referral";
}

/** Strips anything that is not alphanumeric/`-`/`_`, capped to a safe length. */
function sanitiseCampaign(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
  return cleaned || null;
}

function classify(search: string, referrer: string): Attribution {
  const params = new URLSearchParams(search);
  const utmSource = params.get("utm_source")?.toLowerCase().trim();
  const campaign = sanitiseCampaign(params.get("utm_campaign"));
  if (utmSource && utmSource in UTM_SOURCE_MAP) {
    return { channel: UTM_SOURCE_MAP[utmSource], campaign };
  }
  return { channel: classifyReferrer(referrer), campaign };
}

/**
 * Captures the channel on first visit, once per 90 days. Safe to call on
 * every page load: it reads the existing value first and does nothing when
 * one is already on record and not yet expired — first-touch is never
 * overwritten by a later visit.
 */
export function captureAttribution(): void {
  try {
    const store = storage();
    if (!store) return;
    const raw = store.getItem(STORAGE_KEY);
    if (raw) {
      const existing = JSON.parse(raw) as StoredAttribution;
      if (typeof existing.capturedAt === "number" && Date.now() - existing.capturedAt < MAX_AGE_MS) {
        return;
      }
    }
    const { channel, campaign } = classify(window.location.search, document.referrer);
    const stored: StoredAttribution = { channel, campaign, capturedAt: Date.now() };
    store.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* attribution is best-effort — never block the page over it */
  }
}

/** Reads the stored attribution, or `null` if none is on record (or storage is blocked/corrupt). */
export function getAttribution(): Attribution | null {
  try {
    const store = storage();
    if (!store) return null;
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const existing = JSON.parse(raw) as StoredAttribution;
    if (typeof existing.channel !== "string") return null;
    return { channel: existing.channel, campaign: existing.campaign ?? null };
  } catch {
    return null;
  }
}
