# Lead-source attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach the marketing channel that brought a visitor (google / facebook / instagram / linkedin / ai_assistant / email / sms / referral / direct) to every GA4 event, Dorit's lead-notification emails, and the saved Lead record, so leads can be ranked by channel instead of every event reading `(not set)`.

**Architecture:** One new client-side module (`src/lib/attribution.ts`) is the sole place that reads `document.referrer`/UTM params and the sole place attribution is persisted (localStorage, first-touch, 90-day TTL, channel name only — no PII). Everything else reads through its `getAttribution()`: `analytics.ts` auto-attaches `lead_source`/`lead_campaign` to every GA4 event; the three lead-submission UI call sites (`QuickContact`, `ClaimForm`, `AgentChat`) attach `channel`/`campaign`/`landingPath` to their existing submission payloads; the three backend functions that email Dorit (`submitLead`, `submitClaim`, `escalateToHuman`) validate the channel against a closed taxonomy, add one line to her notification, and persist `channel`/`campaign` on the Lead (Base44 + the Supabase mirror) as new fields distinct from the existing `source` enum (which already means "which form").

**Tech Stack:** TypeScript/React (frontend), Deno (Base44 backend functions, no shared modules — constants are duplicated by convention), Base44 entity schema (JSONC), Supabase/Postgres (SQL migration), Vitest (unit/component/integration), Playwright (e2e, not touched by this plan).

**Spec:** `docs/superpowers/specs/2026-10-09-lead-source-attribution-design.md`

## Global Constraints

- **Channel taxonomy (exact 9 values, client-side):** `google`, `facebook`, `instagram`, `linkedin`, `ai_assistant`, `email`, `sms`, `referral`, `direct`. The backend schema enum adds a tenth, `unknown`, as the catch-all for pre-this-change leads and rejected values — never produced by the client.
- **First-touch only.** Once a channel is on record for a browser (within 90 days), a later visit never overwrites it.
- **No PII in attribution.** Only `{channel, campaign, capturedAt}` — never name, phone, email, or anything else.
- **`channel`/`campaign` are a new field, never a reuse of the existing `source` enum** (`Lead.source` / `leads.source` already means "which form": `consultation`/`detailed`/`quick`/`claim`/`escalation`/`interview`).
- **Server-side re-validation, never trust the client.** `channel` against the closed taxonomy, `campaign` re-sanitised (alphanumeric/`-`/`_` only, length-capped) — a POST can bypass the UI entirely.
- **`landingPath` is never persisted** — informational only, in the email line, validated as a bare site-relative path (`^/[a-zA-Z0-9/_-]{0,80}$`, no query string, no scheme).
- **Nothing here may block a lead from saving.** Every layer degrades to absent/`"unknown"` on a missing or bad value, never a rejected submission.
- **Base44 backend functions are isolated Deno entry points with no shared module.** A constant (here: the channel taxonomy) is duplicated by hand into each of `submitLead`, `submitClaim`, `escalateToHuman`, and `tests/contract/agents.contract.test.ts` already enforces that duplicated copies of other constants (`NOTIFY_EMAILS`, `CALENDAR_ATTENDEES`) stay identical — this plan extends that same guard to the new constant.
- **`InterviewSummary`'s `channel`/`campaign`/`landingPath` are never parsed from the agent's fenced JSON block** — the model cannot know a visitor's attribution. They are merged in by `AgentChat.tsx` from `getAttribution()` at the moment it calls `submitInterview`, same as the other two UI call sites.

## Review Focus

- **localStorage blocked or absent** (private browsing, an ad blocker, a locked-down browser): `captureAttribution()`/`getAttribution()` must not throw and must not block the page load or any lead submission — resolves to doing nothing / returning `null`. (Task 1)
- **A direct POST to a backend function with a `channel` value outside the closed taxonomy** (bypassing the UI entirely — anyone can POST to these endpoints): must not be echoed into Dorit's email, must not crash the function, and the Lead record gets `"unknown"` rather than the garbage value. (Tasks 6–8)
- **A `campaign` value containing HTML-significant characters or absurd length, posted directly** (same bypass): must come out re-sanitised server-side, never trusted from the client's own stripping. (Tasks 6–8)
- **Two visits in one session from different channels** (a visitor clicks a Google ad, bounces, then arrives again minutes later from a LinkedIn post): the first-touch channel must hold; the second visit must not overwrite it. (Task 1)
- **The interview agent's model output happens to include `channel`/`campaign` keys in its fenced JSON block** (a hallucination, not a real input, but the fence is parsed as arbitrary JSON): `readHandoff` must continue to ignore them — `InterviewSummary`'s attribution fields must only ever come from `AgentChat.tsx`'s own merge, never from the model. (Task 11)

---

## Task 1: `src/lib/attribution.ts` — capture and read

**Files:**
- Create: `src/lib/attribution.ts`
- Test: `tests/unit/attribution.test.ts`

**Interfaces:**
- Produces: `export type Channel = "google" | "facebook" | "instagram" | "linkedin" | "ai_assistant" | "email" | "sms" | "referral" | "direct"`; `export interface Attribution { channel: Channel; campaign: string | null }`; `export function captureAttribution(): void`; `export function getAttribution(): Attribution | null`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/attribution.test.ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { captureAttribution, getAttribution } from "@/lib/attribution";

// This jsdom build has no localStorage (see tests/unit/supabase-auth.test.ts),
// so a Map-backed stand-in plays it — same pattern as analytics.dom.test.ts.
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

function setPage(search: string, referrer: string) {
  window.history.replaceState(null, "", `/${search}`);
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  setPage("", "");
});

describe("captureAttribution / getAttribution", () => {
  it("returns null before anything is captured", () => {
    expect(getAttribution()).toBeNull();
  });

  it("classifies a known utm_source directly", () => {
    setPage("?utm_source=linkedin&utm_campaign=autumn_push", "");
    captureAttribution();
    expect(getAttribution()).toEqual({ channel: "linkedin", campaign: "autumn_push" });
  });

  it("strips anything unsafe out of utm_campaign", () => {
    setPage("?utm_source=linkedin&utm_campaign=<script>alert(1)</script>", "");
    captureAttribution();
    expect(getAttribution()?.campaign).toBe("scriptalert1script");
  });

  it("falls back to the referrer when utm_source is absent or unrecognised", () => {
    setPage("", "https://www.facebook.com/somepage");
    captureAttribution();
    expect(getAttribution()).toEqual({ channel: "facebook", campaign: null });
  });

  it("classifies known AI-assistant referrers", () => {
    for (const referrer of [
      "https://chat.openai.com/",
      "https://chatgpt.com/",
      "https://claude.ai/chat/abc",
      "https://www.perplexity.ai/search/abc",
      "https://gemini.google.com/app",
    ]) {
      setPage("", referrer);
      captureAttribution();
      expect(getAttribution(), referrer).toEqual({ channel: "ai_assistant", campaign: null });
      window.localStorage.clear();
    }
  });

  it("classifies a real Google search referrer as google, not ai_assistant", () => {
    // Gemini's own referrer host contains "google." too — this is the case
    // that would misclassify if the AI-assistant hosts were not checked first.
    setPage("", "https://www.google.com/search?q=pension");
    captureAttribution();
    expect(getAttribution()).toEqual({ channel: "google", campaign: null });
  });

  it("classifies an unrecognised external referrer as referral", () => {
    setPage("", "https://some-other-blog.example.com/post");
    captureAttribution();
    expect(getAttribution()).toEqual({ channel: "referral", campaign: null });
  });

  it("classifies no referrer and no utm_source as direct", () => {
    setPage("", "");
    captureAttribution();
    expect(getAttribution()).toEqual({ channel: "direct", campaign: null });
  });

  it("never overwrites an existing, unexpired first-touch channel", () => {
    setPage("?utm_source=google", "");
    captureAttribution();
    expect(getAttribution()?.channel).toBe("google");

    setPage("?utm_source=linkedin", "");
    captureAttribution();
    expect(getAttribution()?.channel).toBe("google");
  });

  it("captures again once the stored value has expired", () => {
    setPage("?utm_source=google", "");
    captureAttribution();
    const raw = JSON.parse(window.localStorage.getItem("lead_attribution")!);
    // 91 days ago — one day past the 90-day window.
    raw.capturedAt = Date.now() - 91 * 24 * 60 * 60 * 1000;
    window.localStorage.setItem("lead_attribution", JSON.stringify(raw));

    setPage("?utm_source=linkedin", "");
    captureAttribution();
    expect(getAttribution()?.channel).toBe("linkedin");
  });

  it("does not throw and resolves to null when localStorage is blocked", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new Error("blocked"); },
    });
    expect(() => captureAttribution()).not.toThrow();
    expect(getAttribution()).toBeNull();
  });

  it("does not throw on a corrupted stored value", () => {
    window.localStorage.setItem("lead_attribution", "{not json");
    expect(() => captureAttribution()).not.toThrow();
    expect(getAttribution()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/attribution.test.ts`
Expected: FAIL — `Cannot find module '@/lib/attribution'` (the module does not exist yet).

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/attribution.ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/attribution.test.ts`
Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/attribution.ts tests/unit/attribution.test.ts
git commit -m "Add first-touch channel attribution capture

One module reads document.referrer/UTM params and persists a
channel-name-only, PII-free attribution for 90 days, first-touch
only. Everything else reads through getAttribution()."
```

---

## Task 2: Wire `captureAttribution()` into app start

**Files:**
- Modify: `src/App.jsx:2`, `src/App.jsx:104-107`

**Interfaces:**
- Consumes: `captureAttribution` from `@/lib/attribution` (Task 1).

- [ ] **Step 1: Add the import**

In `src/App.jsx`, line 2 currently reads:

```js
import { initClickTracking, initInternalFlag } from '@/lib/analytics';
```

Change to:

```js
import { initClickTracking, initInternalFlag } from '@/lib/analytics';
import { captureAttribution } from '@/lib/attribution';
```

- [ ] **Step 2: Call it alongside the other one-time init**

Lines 104-107 currently read:

```js
  useEffect(() => {
    initInternalFlag();
    initClickTracking();
  }, []);
```

Change to:

```js
  useEffect(() => {
    initInternalFlag();
    initClickTracking();
    captureAttribution();
  }, []);
```

- [ ] **Step 3: Verify the build still compiles**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "Capture attribution once per app start, beside the other init calls"
```

---

## Task 3: `analytics.ts` — auto-attach `lead_source`/`lead_campaign`, de-duplicate `chat_handoff`

**Files:**
- Modify: `src/lib/analytics.ts:13`, `src/lib/analytics.ts:61-76`, `src/lib/analytics.ts:151`
- Modify (tests): `tests/unit/analytics.dom.test.ts`

**Interfaces:**
- Consumes: `getAttribution` from `@/lib/attribution` (Task 1).
- Produces: no new exports — `track()`'s existing signature is unchanged; it now auto-fills two more allowed params internally.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/analytics.dom.test.ts`, inside the existing `describe("track", ...)` block (after the "marks the agency's own browsing as internal" test, i.e. after line 75):

```typescript
  it("attaches lead_source and lead_campaign when an attribution is on record", async () => {
    const { captureAttribution } = await import("@/lib/attribution");
    window.history.replaceState(null, "", "/?utm_source=linkedin&utm_campaign=autumn_push");
    captureAttribution();
    track("click_phone", { location: "hero" });
    expect(w.gtag).toHaveBeenCalledWith("event", "click_phone", {
      location: "hero",
      lead_source: "linkedin",
      lead_campaign: "autumn_push",
    });
    window.history.replaceState(null, "", "/");
  });

  it("omits lead_source/lead_campaign entirely when no attribution is on record", () => {
    track("click_phone", { location: "hero" });
    expect(w.gtag).toHaveBeenCalledWith("event", "click_phone", { location: "hero" });
  });
```

And replace the existing `chat_handoff` catalogue assertion. The current `LEAD_EVENTS` test (around line 109) stays as-is for the "every event is in the catalogue" check; add a new, separate test right after the `describe("leadEvents", ...)` block closes (after line 119):

```typescript
describe("LEAD_EVENTS catalogue", () => {
  it("does not mark chat_handoff a key event — generate_lead already covers the completed hand-off", () => {
    const chatHandoff = LEAD_EVENTS.find((e) => e.name === "chat_handoff");
    expect(chatHandoff?.keyEvent).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/analytics.dom.test.ts`
Expected: FAIL — the two new `track()` tests fail because `lead_source`/`lead_campaign` are not in `ALLOWED_PARAMS` yet and nothing calls `getAttribution()`; the catalogue test fails because `chat_handoff`'s `keyEvent` is still `true`.

- [ ] **Step 3: Implement**

In `src/lib/analytics.ts`, add the import at the top (after the existing module comment block, before `const INTERNAL_KEY`):

```typescript
import { getAttribution } from "./attribution";
```

Line 13 currently reads:

```typescript
const ALLOWED_PARAMS = ["location", "cta", "method", "channel"] as const;
```

Change to:

```typescript
const ALLOWED_PARAMS = ["location", "cta", "method", "channel", "lead_source", "lead_campaign"] as const;
```

Lines 61-76 currently read:

```typescript
/** Send one event to GA4. Never throws; does nothing when the tag is absent. */
export function track(eventName: string, params: Record<string, unknown> = {}): void {
  try {
    const gtag = gtagOf();
    if (!gtag) return;
    const payload: Record<string, string> = {};
    for (const key of ALLOWED_PARAMS) {
      const value = params[key];
      if (typeof value === "string" && value) payload[key] = value;
    }
    if (isInternalBrowser()) payload.traffic_type = "internal";
    gtag("event", eventName, payload);
  } catch {
    /* tracking must never break the site */
  }
}
```

Change to:

```typescript
/** Send one event to GA4. Never throws; does nothing when the tag is absent. */
export function track(eventName: string, params: Record<string, unknown> = {}): void {
  try {
    const gtag = gtagOf();
    if (!gtag) return;
    const payload: Record<string, string> = {};
    for (const key of ALLOWED_PARAMS) {
      const value = params[key];
      if (typeof value === "string" && value) payload[key] = value;
    }
    // Attached to every event, not just lead events, so any event in GA4 can
    // be sliced by channel — and so no call site has to remember to pass it.
    const attribution = getAttribution();
    if (attribution) {
      payload.lead_source = attribution.channel;
      if (attribution.campaign) payload.lead_campaign = attribution.campaign;
    }
    if (isInternalBrowser()) payload.traffic_type = "internal";
    gtag("event", eventName, payload);
  } catch {
    /* tracking must never break the site */
  }
}
```

Line 151 (the `chat_handoff` row in `LEAD_EVENTS`) currently reads:

```typescript
  { name: "chat_handoff", meaning: "בקשה לעבור לדורית", when: "לחיצה על \"מעבר לדורית\" בצ׳אט", keyEvent: true },
```

Change to:

```typescript
  { name: "chat_handoff", meaning: "בקשה לעבור לדורית", when: "לחיצה על \"מעבר לדורית\" בצ׳אט — ה-key event הוא generate_lead, ברגע שההעברה אכן הושלמה", keyEvent: false },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/analytics.dom.test.ts`
Expected: PASS — all tests, including the two new ones and the catalogue test.

- [ ] **Step 5: Run the full unit suite to confirm no existing assertion broke**

Run: `npx vitest run`
Expected: PASS — every existing exact-match `toHaveBeenCalledWith` assertion for a `track()` call is unaffected, because `getAttribution()` resolves to `null` in every test that never calls `captureAttribution()` first (the default `beforeEach` in `analytics.dom.test.ts` installs a fresh, empty `memoryStorage()`), so `lead_source`/`lead_campaign` are simply absent from the payload exactly as before.

- [ ] **Step 6: Commit**

```bash
git add src/lib/analytics.ts tests/unit/analytics.dom.test.ts
git commit -m "Attach lead_source/lead_campaign to every GA4 event; chat_handoff is no longer a key event

generate_lead (via handoffCompleted, shipped earlier) already covers
the completed hand-off — counting the panel-opening click too was
double-counting one conversion as two."
```

---

## Task 4: Schema — `channel`/`campaign` on the Lead entity and its Supabase mirror

**Files:**
- Modify: `base44/entities/Lead.jsonc`
- Create: `supabase/migrations/20261009000000_lead_channel.sql`

**Interfaces:**
- Produces: `Lead.channel` (string enum, 10 values including `"unknown"`), `Lead.campaign` (string, unconstrained) on both stores. Neither is `required`.

- [ ] **Step 1: Add the properties to the Base44 entity**

In `base44/entities/Lead.jsonc`, the `consent_at` property is currently the last one before the closing `},` of `"properties"` and before `"required"`. Insert two new properties directly after `consent_at` (and before the closing `}` of `"properties"`):

```jsonc
    "consent_at": {
      "type": "string",
      "title": "מועד מתן ההסכמה",
      "description": "חותמת זמן ISO של אישור ההסכמה בממשק."
    },
    "channel": {
      "type": "string",
      "title": "ערוץ שיווקי",
      "description": "מאיזה ערוץ הגיע המבקר בפעם הראשונה — נגזר מ-utm_source או מהפניה, ולא נבחר באופן ידני.",
      "enum": [
        "google",
        "facebook",
        "instagram",
        "linkedin",
        "ai_assistant",
        "email",
        "sms",
        "referral",
        "direct",
        "unknown"
      ]
    },
    "campaign": {
      "type": "string",
      "title": "קמפיין",
      "description": "ערך utm_campaign, אם נמסר — חופשי אך מסונן לפני שמירה."
    }
```

(This is the same file already read in full during research — the only change is these two new keys after `consent_at`, before the entity's closing brace; `"required": ["name", "phone"]` is unaffected.)

- [ ] **Step 2: Write the Supabase migration**

```sql
-- supabase/migrations/20261009000000_lead_channel.sql
--
-- Marketing-channel attribution, as its own field — not a reuse of `source`,
-- which already means "which form" (consultation/quick/claim/escalation/
-- interview). See docs/superpowers/specs/2026-10-09-lead-source-attribution-design.md.

alter table public.leads
  add column channel  text check (channel in (
                         'google','facebook','instagram','linkedin','ai_assistant',
                         'email','sms','referral','direct','unknown'
                       )),
  add column campaign text;
```

- [ ] **Step 3: Verify the entity file is still valid JSONC and the migration is valid SQL**

Run: `node -e "const s=require('fs').readFileSync('base44/entities/Lead.jsonc','utf8'); const c=s.replace(/\/\/.*$/gm,''); JSON.parse(c); console.log('valid')"`
Expected: `valid` (the file has no block comments, only `//` line comments after some keys in this repo's style — if JSON.parse fails, check for a trailing comma introduced by the insertion).

Run: `cat supabase/migrations/20261009000000_lead_channel.sql`
Expected: the file reads back exactly as written above.

- [ ] **Step 4: Commit**

```bash
git add base44/entities/Lead.jsonc supabase/migrations/20261009000000_lead_channel.sql
git commit -m "Add channel/campaign fields to Lead, distinct from the existing source enum

source already means \"which form\" (consultation/quick/claim/
escalation/interview). Reusing it for marketing channel would
silently corrupt that meaning."
```

---

## Task 5: `ports.ts` — thread `channel`/`campaign`/`landingPath` through the submission types

**Files:**
- Modify: `src/services/ports.ts:17-28` (`Lead`), `src/services/ports.ts:38-47` (`ClaimReport`), `src/services/ports.ts:144-155` (`EscalationRequest`)
- Modify: `src/lib/interview-handoff.ts:20-30` (`InterviewSummary`)

**Interfaces:**
- Produces: all four interfaces gain `channel?: string`, `campaign?: string`, `landingPath?: string` — optional, so every existing caller that does not yet supply them keeps compiling unchanged.

- [ ] **Step 1: `Lead`**

`src/services/ports.ts:17-28` currently reads:

```typescript
export interface Lead {
  name: string;
  phone: string;
  email?: string;
  source: LeadSource;
  topic?: string;
  timing?: string;
  message?: string;
  notes?: string;
  /** ISO datetime when the visitor picked a specific date+time; empty otherwise. */
  scheduledAt?: string;
}
```

Change to:

```typescript
export interface Lead {
  name: string;
  phone: string;
  email?: string;
  source: LeadSource;
  topic?: string;
  timing?: string;
  message?: string;
  notes?: string;
  /** ISO datetime when the visitor picked a specific date+time; empty otherwise. */
  scheduledAt?: string;
  /** Marketing channel attribution — see src/lib/attribution.ts. Never PII. */
  channel?: string;
  campaign?: string;
  /** The route the visitor was on when they converted. Informational only — never persisted. */
  landingPath?: string;
}
```

- [ ] **Step 2: `ClaimReport`**

`src/services/ports.ts:38-47` currently reads:

```typescript
export interface ClaimReport {
  name: string;
  phone: string;
  email?: string;
  claimType?: string;
  eventDate?: string;
  policyNumber?: string;
  description?: string;
  documents?: string[];
}
```

Change to:

```typescript
export interface ClaimReport {
  name: string;
  phone: string;
  email?: string;
  claimType?: string;
  eventDate?: string;
  policyNumber?: string;
  description?: string;
  documents?: string[];
  /** Marketing channel attribution — see src/lib/attribution.ts. Never PII. */
  channel?: string;
  campaign?: string;
  landingPath?: string;
}
```

- [ ] **Step 3: `EscalationRequest`**

`src/services/ports.ts:144-155` currently reads:

```typescript
export interface EscalationRequest {
  reason: EscalationReason;
  /** Plain-language summary of what the visitor needs. Never sensitive data. */
  summary: string;
  /** Which on-site agent was talking, for audit. */
  agent?: string;
  name?: string;
  phone?: string;
  email?: string;
  consentVersion?: string;
  consentAt?: string;
}
```

Change to:

```typescript
export interface EscalationRequest {
  reason: EscalationReason;
  /** Plain-language summary of what the visitor needs. Never sensitive data. */
  summary: string;
  /** Which on-site agent was talking, for audit. */
  agent?: string;
  name?: string;
  phone?: string;
  email?: string;
  consentVersion?: string;
  consentAt?: string;
  /** Marketing channel attribution — see src/lib/attribution.ts. Never PII. */
  channel?: string;
  campaign?: string;
  landingPath?: string;
}
```

- [ ] **Step 4: `InterviewSummary`**

`src/lib/interview-handoff.ts:20-30` currently reads:

```typescript
export interface InterviewSummary {
  name: string;
  phone: string;
  email?: string;
  track?: string;
  meetingTopic?: string;
  timing?: string;
  notes?: string;
  /** ISO-ish wall-clock the agent agreed, or empty when none was. */
  scheduledAt?: string;
  summary?: string;
  profile?: Record<string, string>;
}
```

Change to:

```typescript
export interface InterviewSummary {
  name: string;
  phone: string;
  email?: string;
  track?: string;
  meetingTopic?: string;
  timing?: string;
  notes?: string;
  /** ISO-ish wall-clock the agent agreed, or empty when none was. */
  scheduledAt?: string;
  summary?: string;
  profile?: Record<string, string>;
  /**
   * Marketing channel attribution — see src/lib/attribution.ts. Never parsed
   * out of the agent's fenced block: the model has no way to know this, so
   * `readHandoff` below never sets these. `AgentChat.tsx` merges them in from
   * `getAttribution()` at the point it calls `submitInterview`.
   */
  channel?: string;
  campaign?: string;
  landingPath?: string;
}
```

Do **not** touch `readHandoff`'s own parsing logic (the `str(d.name)` etc. block) — it must continue to read only `name`/`phone`/`email`/`track`/`meetingTopic`/`timing`/`notes`/`scheduledAt`/`summary`/`profile` out of the model's JSON, exactly as today. This is what Review Focus item 5 (below, Task 11's test) checks.

- [ ] **Step 5: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors — every field added is optional, so no existing call site needs to change yet.

- [ ] **Step 6: Commit**

```bash
git add src/services/ports.ts src/lib/interview-handoff.ts
git commit -m "Add optional channel/campaign/landingPath to the four lead-submission payload types"
```

---

## Task 6: Backend — `submitLead`

**Files:**
- Modify: `base44/functions/submitLead/entry.ts`

**Interfaces:**
- Consumes: request body gains optional `channel`, `campaign`, `landingPath`.
- Produces: `CHANNEL_TAXONOMY` (array of 10 strings, same shape as `NOTIFY_EMAILS`/`CALENDAR_ATTENDEES` — duplicated by hand into `submitClaim` and `escalateToHuman` in Tasks 7–8), `function validChannel(value)`, `function validCampaign(value)`, `function validLandingPath(value)`, `function channelLine({channel, campaign, landingPath})`.

- [ ] **Step 1: Add the taxonomy and three validators, plus the shared line-builder**

Insert directly after the existing `upstreamReasons` function (`base44/functions/submitLead/entry.ts:252-258`, right before `async function sendMail`):

```javascript
// הערוצים השיווקיים הסגורים — ראו src/lib/attribution.ts בצד הלקוח, שאותו
// מילון בדיוק (ללא 'unknown', שאינו ערך שהלקוח אי פעם שולח).
//
// משוכפלת בכל פונקציה בכוונה — אין מודול משותף ב-Base44. משוכפל זה בסדר,
// מפוצל זה לא. tests/contract/agents.contract.test.ts נכשל כששתי העותקים
// מתפצלים.
const CHANNEL_TAXONOMY = [
  'google', 'facebook', 'instagram', 'linkedin', 'ai_assistant',
  'email', 'sms', 'referral', 'direct', 'unknown',
];

/** ערך סגור בלבד — ולעולם לא נאמן מהלקוח, גם אם הוא כבר סינן בצד שלו. */
function validChannel(value) {
  return typeof value === 'string' && CHANNEL_TAXONOMY.includes(value) ? value : null;
}

/** נקי מתווים לא בטוחים, מוגבל באורך — בדיוק כמו הסינון בצד הלקוח, לא במקומו. */
function validCampaign(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  return cleaned || null;
}

/** נתיב יחסי בלבד — בלי query string ובלי סכימה. */
function validLandingPath(value) {
  if (typeof value !== 'string') return null;
  return /^\/[a-zA-Z0-9/_-]{0,80}$/.test(value) ? value : null;
}

/** שורת "הגיע/ה דרך", משותפת בין גרסת ה-HTML לגרסת הטקסט של אותו מייל. */
function channelLine({ channel, campaign, landingPath }) {
  if (!channel || channel === 'unknown') return '';
  let line = channel;
  if (campaign) line += ` / ${campaign}`;
  if (landingPath) line += ` (נחיתה: ${landingPath})`;
  return line;
}
```

- [ ] **Step 2: Destructure the three new fields and validate them**

`base44/functions/submitLead/entry.ts:1245` currently reads:

```javascript
    const { name, phone, email, source, topic, timing, message, notes, scheduledAt, summary, profile, track, stage, meetingTopic, consent_version, consent_at } = body || {};
```

Change to:

```javascript
    const { name, phone, email, source, topic, timing, message, notes, scheduledAt, summary, profile, track, stage, meetingTopic, consent_version, consent_at, channel, campaign, landingPath } = body || {};
    const safeChannel = validChannel(channel) || 'unknown';
    const safeCampaign = validCampaign(campaign);
    const safeLandingPath = validLandingPath(landingPath);
```

(Insert these three `const` lines directly after the destructuring line, before the existing `if (!name || !phone) {` check.)

- [ ] **Step 3: Persist on the Lead write (both the create branch and the Supabase mirror)**

`base44/functions/submitLead/entry.ts:1331-1346` (the `base44.entities.Lead.create` call) currently reads:

```javascript
      const lead = await base44.entities.Lead.create({
        name,
        phone,
        email: email || '',
        source: source || 'quick',
        topic: effectiveTopic || '',
        timing: timing || '',
        message: leadMessage,
        status: partial ? 'partial' : 'new',
        // איזה נוסח הסכמה הוצג, ומתי. חובת היידוע לפי חוק הגנת הפרטיות
        // (תיקון 13) היא ראייתית: בלי זה אי אפשר לקשור רשומה לנוסח שהמבקר
        // ראה בפועל. ריק כשהפנייה הגיעה ממסלול שלא הציג שער הסכמה — נרשם רק
        // מה שבאמת הוצג, ולעולם לא הסכמה שלא נתבקשה.
        consent_version: consent_version || '',
        consent_at: consent_at || '',
      });
```

Change to:

```javascript
      const lead = await base44.entities.Lead.create({
        name,
        phone,
        email: email || '',
        source: source || 'quick',
        topic: effectiveTopic || '',
        timing: timing || '',
        message: leadMessage,
        status: partial ? 'partial' : 'new',
        // איזה נוסח הסכמה הוצג, ומתי. חובת היידוע לפי חוק הגנת הפרטיות
        // (תיקון 13) היא ראייתית: בלי זה אי אפשר לקשור רשומה לנוסח שהמבקר
        // ראה בפועל. ריק כשהפנייה הגיעה ממסלול שלא הציג שער הסכמה — נרשם רק
        // מה שבאמת הוצג, ולעולם לא הסכמה שלא נתבקשה.
        consent_version: consent_version || '',
        consent_at: consent_at || '',
        channel: safeChannel,
        campaign: safeCampaign || '',
      });
```

`base44/functions/submitLead/entry.ts:1361-1386` (the `mirrorLeadToSupabase` call) currently ends with:

```javascript
      summary: safeSummary || null,
      profile: safeProfile.length ? safeProfile : null,
      track_label: trackLabel || null,
    });
```

Change to:

```javascript
      summary: safeSummary || null,
      profile: safeProfile.length ? safeProfile : null,
      track_label: trackLabel || null,
      channel: safeChannel,
      campaign: safeCampaign,
    });
```

- [ ] **Step 4: Add the email line — both the text footer and the HTML block**

`base44/functions/submitLead/entry.ts:565-576` (`buildOpsFooter`) currently reads:

```javascript
function buildOpsFooter(source, { leadId, topic, calendar, sheet, doc, warnings }) {
  return [
    `── מצב תפעולי ──`,
    `מקור: ${source || 'quick'}`,
    `נושא: ${topic || '—'}`,
    `מזהה רשומה: ${leadId || '—'}`,
    `יומן: ${calendar}`,
    `גיליון: ${sheet}`,
    `מסמך: ${doc}`,
    `תקלות: ${warnings.length ? warnings.join(', ') : 'אין'}`,
  ].join('\n');
}
```

Change to:

```javascript
function buildOpsFooter(source, { leadId, topic, calendar, sheet, doc, warnings, channel, campaign, landingPath }) {
  const channelText = channelLine({ channel, campaign, landingPath });
  return [
    `── מצב תפעולי ──`,
    `מקור: ${source || 'quick'}`,
    ...(channelText ? [`הגיע/ה דרך: ${channelText}`] : []),
    `נושא: ${topic || '—'}`,
    `מזהה רשומה: ${leadId || '—'}`,
    `יומן: ${calendar}`,
    `גיליון: ${sheet}`,
    `מסמך: ${doc}`,
    `תקלות: ${warnings.length ? warnings.join(', ') : 'אין'}`,
  ].join('\n');
}
```

`base44/functions/submitLead/entry.ts:1000-1008` (the `opsBlock` inside `buildAgentHtml`) currently reads:

```javascript
  const opsBlock = ops
    ? block('מצב תפעולי', [
        detailRow('מקור', ops.source || 'quick'),
        detailRow('מזהה רשומה', ops.leadId),
        detailRow('יומן', ops.calendar),
        detailRow('גיליון', statusOf(ops.sheet), { link: linkIn(ops.sheet) }),
        detailRow('מסמך', statusOf(ops.doc), { link: linkIn(ops.doc) }),
        detailRow('תקלות', ops.warnings.length ? ops.warnings.join(', ') : 'אין', { last: true }),
      ].join(''), { tone: ops.warnings.length ? 'alert' : 'panel' })
    : '';
```

Change to:

```javascript
  const opsChannelText = ops ? channelLine(ops) : '';
  const opsBlock = ops
    ? block('מצב תפעולי', [
        detailRow('מקור', ops.source || 'quick'),
        ...(opsChannelText ? [detailRow('הגיע/ה דרך', opsChannelText)] : []),
        detailRow('מזהה רשומה', ops.leadId),
        detailRow('יומן', ops.calendar),
        detailRow('גיליון', statusOf(ops.sheet), { link: linkIn(ops.sheet) }),
        detailRow('מסמך', statusOf(ops.doc), { link: linkIn(ops.doc) }),
        detailRow('תקלות', ops.warnings.length ? ops.warnings.join(', ') : 'אין', { last: true }),
      ].join(''), { tone: ops.warnings.length ? 'alert' : 'panel' })
    : '';
```

- [ ] **Step 5: Pass the three values into both builder calls**

`base44/functions/submitLead/entry.ts:1662-1663` currently reads:

```javascript
    const opsHtml = buildAgentHtml(source, data, { source, leadId, topic, calendar, sheet, doc, warnings });
    const opsText = `${agentBody}\n\n${buildOpsFooter(source, { leadId, topic, calendar, sheet, doc, warnings })}`;
```

Change to:

```javascript
    const opsOps = { source, leadId, topic, calendar, sheet, doc, warnings, channel: safeChannel, campaign: safeCampaign, landingPath: safeLandingPath };
    const opsHtml = buildAgentHtml(source, data, opsOps);
    const opsText = `${agentBody}\n\n${buildOpsFooter(source, opsOps)}`;
```

- [ ] **Step 6: Run the existing integration tests to confirm nothing broke**

Run: `npx vitest run tests/integration/submit-lead.integration.test.ts`
Expected: PASS — every existing test (none of which supplies `channel`) now exercises the new code path with `channel` absent, which resolves to `safeChannel = 'unknown'` and `channelLine` returning `''`, so the `הגיע/ה דרך` line is simply never added — the existing "adds the operational appendix only to the operations copy" test and friends are unaffected.

- [ ] **Step 7: Commit**

```bash
git add base44/functions/submitLead/entry.ts
git commit -m "submitLead: validate and surface channel/campaign/landingPath

Server-side taxonomy/sanitiser, never the client's own — a POST can
bypass the UI entirely. Adds one line to both the HTML and text
operations email, and persists channel/campaign on the Lead write
and its Supabase mirror."
```

---

## Task 7: Backend — `submitClaim`

**Files:**
- Modify: `base44/functions/submitClaim/entry.ts`

**Interfaces:**
- Consumes: request body gains optional `channel`, `campaign`, `landingPath`.
- Produces: the same `CHANNEL_TAXONOMY`/`validChannel`/`validCampaign`/`validLandingPath`/`channelLine` quartet as Task 6, byte-for-byte identical (Task 9's contract test enforces this).

- [ ] **Step 1: Add the same taxonomy, validators, and line-builder**

Insert directly after the existing `upstreamReasons` function (`base44/functions/submitClaim/entry.ts:90-96`, right before `async function sendMail`) — identical to Task 6 Step 1:

```javascript
// הערוצים השיווקיים הסגורים — ראו src/lib/attribution.ts בצד הלקוח, שאותו
// מילון בדיוק (ללא 'unknown', שאינו ערך שהלקוח אי פעם שולח).
//
// משוכפלת בכל פונקציה בכוונה — אין מודול משותף ב-Base44. משוכפל זה בסדר,
// מפוצל זה לא. tests/contract/agents.contract.test.ts נכשל כששתי העותקים
// מתפצלים.
const CHANNEL_TAXONOMY = [
  'google', 'facebook', 'instagram', 'linkedin', 'ai_assistant',
  'email', 'sms', 'referral', 'direct', 'unknown',
];

/** ערך סגור בלבד — ולעולם לא נאמן מהלקוח, גם אם הוא כבר סינן בצד שלו. */
function validChannel(value) {
  return typeof value === 'string' && CHANNEL_TAXONOMY.includes(value) ? value : null;
}

/** נקי מתווים לא בטוחים, מוגבל באורך — בדיוק כמו הסינון בצד הלקוח, לא במקומו. */
function validCampaign(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
  return cleaned || null;
}

/** נתיב יחסי בלבד — בלי query string ובלי סכימה. */
function validLandingPath(value) {
  if (typeof value !== 'string') return null;
  return /^\/[a-zA-Z0-9/_-]{0,80}$/.test(value) ? value : null;
}

/** שורת "הגיע/ה דרך", משותפת בין גרסת ה-HTML לגרסת הטקסט של אותו מייל. */
function channelLine({ channel, campaign, landingPath }) {
  if (!channel || channel === 'unknown') return '';
  let line = channel;
  if (campaign) line += ` / ${campaign}`;
  if (landingPath) line += ` (נחיתה: ${landingPath})`;
  return line;
}
```

- [ ] **Step 2: Destructure and validate**

`base44/functions/submitClaim/entry.ts:348` currently reads:

```javascript
    const { name, phone, email, claimType, eventDate, policyNumber, description, documents } = body || {};
```

Change to:

```javascript
    const { name, phone, email, claimType, eventDate, policyNumber, description, documents, channel, campaign, landingPath } = body || {};
    const safeChannel = validChannel(channel) || 'unknown';
    const safeCampaign = validCampaign(campaign);
    const safeLandingPath = validLandingPath(landingPath);
```

- [ ] **Step 3: Add the line to `agentBody`**

`base44/functions/submitClaim/entry.ts:360-374` currently reads:

```javascript
    const agentBody = [
      `דיווח אירוע ביטוחי חדש — ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`,
      ``,
      `שם: ${name}`,
      `טלפון: ${phone}`,
      `אימייל: ${email || '—'}`,
      `נשלח מ: ${deviceLabel(req.headers.get('user-agent'))}`,
      `סוג אירוע: ${claimType || '—'}`,
      `תאריך אירוע: ${eventDate || '—'}`,
      `מספר פוליסה: ${policyNumber || '—'}`,
      ``,
      `תיאור האירוע:`,
      description || '—',
      ...docLines,
    ].join('\n');
```

Change to:

```javascript
    const claimChannelText = channelLine({ channel: safeChannel, campaign: safeCampaign, landingPath: safeLandingPath });
    const agentBody = [
      `דיווח אירוע ביטוחי חדש — ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`,
      ``,
      `שם: ${name}`,
      `טלפון: ${phone}`,
      `אימייל: ${email || '—'}`,
      `נשלח מ: ${deviceLabel(req.headers.get('user-agent'))}`,
      ...(claimChannelText ? [`הגיע/ה דרך: ${claimChannelText}`] : []),
      `סוג אירוע: ${claimType || '—'}`,
      `תאריך אירוע: ${eventDate || '—'}`,
      `מספר פוליסה: ${policyNumber || '—'}`,
      ``,
      `תיאור האירוע:`,
      description || '—',
      ...docLines,
    ].join('\n');
```

- [ ] **Step 4: Persist on the Lead write and the Supabase mirror**

`base44/functions/submitClaim/entry.ts:392-401` currently reads:

```javascript
      const lead = await base44.entities.Lead.create({
        name,
        phone,
        email: email || '',
        source: 'claim',
        topic: claimType || '',
        timing: eventDate || '',
        message: messageBody,
        status: 'new',
      });
```

Change to:

```javascript
      const lead = await base44.entities.Lead.create({
        name,
        phone,
        email: email || '',
        source: 'claim',
        topic: claimType || '',
        timing: eventDate || '',
        message: messageBody,
        status: 'new',
        channel: safeChannel,
        campaign: safeCampaign || '',
      });
```

`base44/functions/submitClaim/entry.ts:415-424` currently reads:

```javascript
    await mirrorLeadToSupabase(rid, leadId, {
      name,
      phone,
      email: email || '',
      source: 'claim',
      topic: claimType || '',
      timing: eventDate || '',
      message: messageBody,
      status: 'new',
    });
```

Change to:

```javascript
    await mirrorLeadToSupabase(rid, leadId, {
      name,
      phone,
      email: email || '',
      source: 'claim',
      topic: claimType || '',
      timing: eventDate || '',
      message: messageBody,
      status: 'new',
      channel: safeChannel,
      campaign: safeCampaign,
    });
```

- [ ] **Step 5: Run the existing integration tests to confirm nothing broke**

Run: `npx vitest run tests/contract/agents.contract.test.ts -t "submitClaim"`
Expected: PASS (no `submit-claim.integration.test.ts` exists yet — Task 12 adds it).

- [ ] **Step 6: Commit**

```bash
git add base44/functions/submitClaim/entry.ts
git commit -m "submitClaim: validate and surface channel/campaign/landingPath

A claim report is a lead like any other — same taxonomy, same
validators, same line in the notification, identical to submitLead's
copy by convention."
```

---

## Task 8: Backend — `escalateToHuman`

**Files:**
- Modify: `base44/functions/escalateToHuman/entry.ts`

**Interfaces:**
- Consumes: request body gains optional `channel`, `campaign`, `landingPath`.
- Produces: the same `CHANNEL_TAXONOMY`/`validChannel`/`validCampaign`/`validLandingPath`/`channelLine` quartet, byte-for-byte identical to Tasks 6–7.

- [ ] **Step 1: Add the same taxonomy, validators, and line-builder**

Insert directly after the existing `upstreamReasons` function in `base44/functions/escalateToHuman/entry.ts` (same position/content as Task 6 Step 1 and Task 7 Step 1 — find `function upstreamReasons` in this file and insert immediately after its closing `}`, before the next function).

- [ ] **Step 2: Destructure and validate**

`base44/functions/escalateToHuman/entry.ts:489` currently reads:

```javascript
    const { reason, summary, name, phone, email, agent, topic, consentVersion, consentAt } = body || {};
```

Change to:

```javascript
    const { reason, summary, name, phone, email, agent, topic, consentVersion, consentAt, channel, campaign, landingPath } = body || {};
    const safeChannel = validChannel(channel) || 'unknown';
    const safeCampaign = validCampaign(campaign);
    const safeLandingPath = validLandingPath(landingPath);
```

- [ ] **Step 3: Persist on the Lead write and the Supabase mirror**

`base44/functions/escalateToHuman/entry.ts:508-521` currently reads:

```javascript
        const lead = await base44.entities.Lead.create({
          name,
          phone,
          email: email || '',
          source: 'escalation',
          topic: topic || REASONS[safeReason],
          timing: '',
          message: `[הועבר לטיפול אנושי — ${REASONS[safeReason]}]\n\n${safeSummary}`,
          status: 'escalated',
          escalation_reason: safeReason,
          handled_by_agent: agent || '',
          consent_version: consentVersion || '',
          consent_at: consentAt || '',
        });
```

Change to:

```javascript
        const lead = await base44.entities.Lead.create({
          name,
          phone,
          email: email || '',
          source: 'escalation',
          topic: topic || REASONS[safeReason],
          timing: '',
          message: `[הועבר לטיפול אנושי — ${REASONS[safeReason]}]\n\n${safeSummary}`,
          status: 'escalated',
          escalation_reason: safeReason,
          handled_by_agent: agent || '',
          consent_version: consentVersion || '',
          consent_at: consentAt || '',
          channel: safeChannel,
          campaign: safeCampaign || '',
        });
```

`base44/functions/escalateToHuman/entry.ts:534-547` currently reads:

```javascript
    await mirrorLeadToSupabase(rid, leadId, {
      name,
      phone,
      email: email || '',
      source: 'escalation',
      topic: topic || REASONS[safeReason],
      timing: '',
      message: `[הועבר לטיפול אנושי — ${REASONS[safeReason]}]\n\n${safeSummary}`,
      status: 'escalated',
      escalation_reason: safeReason,
      handled_by_agent: agent || '',
      consent_version: consentVersion || '',
      consent_at: consentAt || null,
    });
```

Change to:

```javascript
    await mirrorLeadToSupabase(rid, leadId, {
      name,
      phone,
      email: email || '',
      source: 'escalation',
      topic: topic || REASONS[safeReason],
      timing: '',
      message: `[הועבר לטיפול אנושי — ${REASONS[safeReason]}]\n\n${safeSummary}`,
      status: 'escalated',
      escalation_reason: safeReason,
      handled_by_agent: agent || '',
      consent_version: consentVersion || '',
      consent_at: consentAt || null,
      channel: safeChannel,
      campaign: safeCampaign,
    });
```

- [ ] **Step 4: Add the line to both the text and HTML notifications**

`base44/functions/escalateToHuman/entry.ts:266-287` (`buildNotification`) currently reads:

```javascript
function buildNotification(reason, data) {
  const flag = URGENT.has(reason) ? '🔴 דחוף' : '🟠';
  return [
    `${flag} פנייה שהועברה מהסוכן האוטומטי לטיפול אנושי`,
    `התקבל: ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`,
    ``,
    `סיבת ההעברה: ${REASONS[reason] || reason}`,
    `סוכן: ${data.agent || '—'}`,
    ``,
    `שם: ${data.name || 'לא נמסר'}`,
    `טלפון: ${data.phone || 'לא נמסר'}`,
    `אימייל: ${data.email || '—'}`,
    `נשלח מ: ${data.device || 'לא ידוע'}`,
    ``,
    `תקציר השיחה (לאחר השמטת פרטים רגישים):`,
    data.summary || '—',
    ``,
    data.name && data.phone
      ? 'הפנייה נשמרה במאגר בסטטוס "escalated".'
      : 'המבקר לא מסר שם וטלפון — אין רשומה במאגר, זו ההודעה היחידה על הפנייה.',
  ].join('\n');
}
```

Change the `סוכן:` line to add a channel line directly after it:

```javascript
function buildNotification(reason, data) {
  const flag = URGENT.has(reason) ? '🔴 דחוף' : '🟠';
  const escalationChannelText = channelLine(data);
  return [
    `${flag} פנייה שהועברה מהסוכן האוטומטי לטיפול אנושי`,
    `התקבל: ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`,
    ``,
    `סיבת ההעברה: ${REASONS[reason] || reason}`,
    `סוכן: ${data.agent || '—'}`,
    ...(escalationChannelText ? [`הגיע/ה דרך: ${escalationChannelText}`] : []),
    ``,
    `שם: ${data.name || 'לא נמסר'}`,
    `טלפון: ${data.phone || 'לא נמסר'}`,
    `אימייל: ${data.email || '—'}`,
    `נשלח מ: ${data.device || 'לא ידוע'}`,
    ``,
    `תקציר השיחה (לאחר השמטת פרטים רגישים):`,
    data.summary || '—',
    ``,
    data.name && data.phone
      ? 'הפנייה נשמרה במאגר בסטטוס "escalated".'
      : 'המבקר לא מסר שם וטלפון — אין רשומה במאגר, זו ההודעה היחידה על הפנייה.',
  ].join('\n');
}
```

`base44/functions/escalateToHuman/entry.ts:379-383` (the `why` block inside `buildEscalationHtml`) currently reads:

```javascript
  const why = block('ההעברה', [
    detailRow('סיבה', REASONS[reason] || reason),
    detailRow('דחיפות', urgent ? 'דחוף — לטפל היום' : 'רגילה'),
    detailRow('סוכן', data.agent || '—', { last: true }),
  ].join(''), { tone: urgent ? 'alert' : 'panel' });
```

Change to:

```javascript
  const whyChannelText = channelLine(data);
  const why = block('ההעברה', [
    detailRow('סיבה', REASONS[reason] || reason),
    detailRow('דחיפות', urgent ? 'דחוף — לטפל היום' : 'רגילה'),
    detailRow('סוכן', data.agent || '—', { last: !whyChannelText }),
    ...(whyChannelText ? [detailRow('הגיע/ה דרך', whyChannelText, { last: true })] : []),
  ].join(''), { tone: urgent ? 'alert' : 'panel' });
```

- [ ] **Step 5: Pass the three values into both builder calls**

`base44/functions/escalateToHuman/entry.ts:549-554` currently reads:

```javascript
    const notification = buildNotification(safeReason, { name, phone, email, agent, summary: safeSummary, device: deviceLabel(req.headers.get('user-agent')) });
    const subject = `${URGENT.has(safeReason) ? '🔴 ' : ''}העברה לטיפול אנושי — ${REASONS[safeReason]}${name ? ` · ${name}` : ''}`;
    const escalationHtml = buildEscalationHtml(safeReason, {
      name, phone, email, agent, summary: safeSummary, contactable,
      device: deviceLabel(req.headers.get('user-agent')),
    });
```

Change to:

```javascript
    const escalationAttribution = { channel: safeChannel, campaign: safeCampaign, landingPath: safeLandingPath };
    const notification = buildNotification(safeReason, { name, phone, email, agent, summary: safeSummary, device: deviceLabel(req.headers.get('user-agent')), ...escalationAttribution });
    const subject = `${URGENT.has(safeReason) ? '🔴 ' : ''}העברה לטיפול אנושי — ${REASONS[safeReason]}${name ? ` · ${name}` : ''}`;
    const escalationHtml = buildEscalationHtml(safeReason, {
      name, phone, email, agent, summary: safeSummary, contactable,
      device: deviceLabel(req.headers.get('user-agent')),
      ...escalationAttribution,
    });
```

- [ ] **Step 6: Run the existing integration tests to confirm nothing broke**

Run: `npx vitest run tests/integration/escalate-to-human.integration.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add base44/functions/escalateToHuman/entry.ts
git commit -m "escalateToHuman: validate and surface channel/campaign/landingPath

Same taxonomy, validators and email-line convention as submitLead
and submitClaim."
```

---

## Task 9: Contract test — guard the duplicated `CHANNEL_TAXONOMY` against drift

**Files:**
- Modify: `tests/contract/agents.contract.test.ts`

**Interfaces:**
- Consumes: `submitLead`, `escalate`, `claim` (already-read file contents, bound near the top of the `describe("who receives a lead, ...")` block at lines 641-645), `REPO_ROOT`, `read`, `join` (already imported).

- [ ] **Step 1: Write the test**

Add immediately after the existing `it("keeps the operations mailbox list identical in every function that mails", ...)` test (`tests/contract/agents.contract.test.ts:785-801`), inside the same `describe` block:

```typescript
  it("keeps the channel taxonomy identical in every function that mails", () => {
    const claim = read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"));
    const listOf = (src: string, name: string) => {
      const i = src.indexOf("const CHANNEL_TAXONOMY = [");
      expect(i, `${name} declares no CHANNEL_TAXONOMY`).toBeGreaterThan(-1);
      return src.slice(i, src.indexOf("];", i)).replace(/\s+/g, " ").trim();
    };
    const lists = [
      listOf(submitLead, "submitLead"),
      listOf(escalate, "escalateToHuman"),
      listOf(claim, "submitClaim"),
    ];
    expect(lists[1], "escalateToHuman drifted from submitLead").toBe(lists[0]);
    expect(lists[2], "submitClaim drifted from submitLead").toBe(lists[0]);
    // And it agrees with the client-side taxonomy, minus the server-only
    // "unknown" catch-all the client never produces.
    const clientSide = read(join(REPO_ROOT, "src/lib/attribution.ts"));
    for (const channel of [
      "google", "facebook", "instagram", "linkedin", "ai_assistant",
      "email", "sms", "referral", "direct",
    ]) {
      expect(clientSide, `src/lib/attribution.ts is missing "${channel}"`).toContain(`"${channel}"`);
      expect(lists[0], `submitLead's CHANNEL_TAXONOMY is missing '${channel}'`).toContain(`'${channel}'`);
    }
    expect(lists[0], "submitLead's CHANNEL_TAXONOMY is missing the server-only 'unknown'").toContain("'unknown'");
  });
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/contract/agents.contract.test.ts -t "channel taxonomy"`
Expected: PASS, assuming Tasks 6–8 inserted byte-identical `CHANNEL_TAXONOMY` declarations (if this fails, diff the three declarations — whitespace inside the array is normalised by `replace(/\s+/g, " ")` but the values and their order must match exactly).

- [ ] **Step 3: Commit**

```bash
git add tests/contract/agents.contract.test.ts
git commit -m "Guard the duplicated CHANNEL_TAXONOMY constant against drift, same pattern as NOTIFY_EMAILS"
```

---

## Task 10: Adapters — thread attribution into the Base44 function calls

**Files:**
- Modify: `src/services/base44/Base44LeadService.ts`
- Modify: `src/services/base44/Base44SupportService.ts`

**Interfaces:**
- Consumes: `Lead`, `ClaimReport`, `InterviewSummary`, `EscalationRequest` (all gained `channel?`/`campaign?`/`landingPath?` in Task 5).
- Produces: the Base44 function-invocation payloads for `submitLead` (both the `submitLead` and `submitInterview` methods), `submitClaim`, and `escalateToHuman` now forward these three fields.

- [ ] **Step 1: `Base44LeadService.submitLead`**

Currently:

```typescript
  async submitLead(lead: Lead): Promise<SubmissionReceipt> {
    const receipt = await invokeFunction<SubmissionReceipt>(this.client, "submitLead", {
      name: lead.name,
      phone: lead.phone,
      email: lead.email ?? "",
      source: lead.source,
      topic: lead.topic ?? "",
      timing: lead.timing ?? "",
      message: lead.message ?? "",
      notes: lead.notes ?? "",
      scheduledAt: lead.scheduledAt ?? "",
    });

    return receipt ?? { ok: true };
  }
```

Change to:

```typescript
  async submitLead(lead: Lead): Promise<SubmissionReceipt> {
    const receipt = await invokeFunction<SubmissionReceipt>(this.client, "submitLead", {
      name: lead.name,
      phone: lead.phone,
      email: lead.email ?? "",
      source: lead.source,
      topic: lead.topic ?? "",
      timing: lead.timing ?? "",
      message: lead.message ?? "",
      notes: lead.notes ?? "",
      scheduledAt: lead.scheduledAt ?? "",
      channel: lead.channel ?? "",
      campaign: lead.campaign ?? "",
      landingPath: lead.landingPath ?? "",
    });

    return receipt ?? { ok: true };
  }
```

- [ ] **Step 2: `Base44LeadService.submitInterview`**

Currently:

```typescript
  async submitInterview(summary: InterviewSummary): Promise<SubmissionReceipt> {
    const receipt = await invokeFunction<SubmissionReceipt>(this.client, "submitLead", {
      source: "interview",
      stage: "complete",
      name: summary.name,
      phone: summary.phone,
      email: summary.email ?? "",
      track: summary.track ?? "",
      meetingTopic: summary.meetingTopic ?? "",
      timing: summary.timing ?? "",
      notes: summary.notes ?? "",
      scheduledAt: summary.scheduledAt ?? "",
      summary: summary.summary ?? "",
      profile: summary.profile ?? {},
    });

    return receipt ?? { ok: true };
  }
```

Change to:

```typescript
  async submitInterview(summary: InterviewSummary): Promise<SubmissionReceipt> {
    const receipt = await invokeFunction<SubmissionReceipt>(this.client, "submitLead", {
      source: "interview",
      stage: "complete",
      name: summary.name,
      phone: summary.phone,
      email: summary.email ?? "",
      track: summary.track ?? "",
      meetingTopic: summary.meetingTopic ?? "",
      timing: summary.timing ?? "",
      notes: summary.notes ?? "",
      scheduledAt: summary.scheduledAt ?? "",
      summary: summary.summary ?? "",
      profile: summary.profile ?? {},
      channel: summary.channel ?? "",
      campaign: summary.campaign ?? "",
      landingPath: summary.landingPath ?? "",
    });

    return receipt ?? { ok: true };
  }
```

- [ ] **Step 3: `Base44LeadService.submitClaim`**

Currently:

```typescript
  async submitClaim(report: ClaimReport): Promise<SubmissionReceipt> {
    const receipt = await invokeFunction<SubmissionReceipt>(this.client, "submitClaim", {
      name: report.name,
      phone: report.phone,
      email: report.email ?? "",
      claimType: report.claimType ?? "",
      eventDate: report.eventDate ?? "",
      policyNumber: report.policyNumber ?? "",
      description: report.description ?? "",
      documents: report.documents ?? [],
    });

    return receipt ?? { ok: true };
  }
```

Change to:

```typescript
  async submitClaim(report: ClaimReport): Promise<SubmissionReceipt> {
    const receipt = await invokeFunction<SubmissionReceipt>(this.client, "submitClaim", {
      name: report.name,
      phone: report.phone,
      email: report.email ?? "",
      claimType: report.claimType ?? "",
      eventDate: report.eventDate ?? "",
      policyNumber: report.policyNumber ?? "",
      description: report.description ?? "",
      documents: report.documents ?? [],
      channel: report.channel ?? "",
      campaign: report.campaign ?? "",
      landingPath: report.landingPath ?? "",
    });

    return receipt ?? { ok: true };
  }
```

- [ ] **Step 4: `Base44SupportService.escalate`**

Currently:

```typescript
  async escalate(request: EscalationRequest): Promise<EscalationReceipt> {
    try {
      const receipt = await invokeFunction<EscalationReceipt>(this.client, "escalateToHuman", {
        reason: request.reason,
        summary: request.summary,
        agent: request.agent ?? "",
        name: request.name ?? "",
        phone: request.phone ?? "",
        email: request.email ?? "",
        topic: "",
        consentVersion: request.consentVersion ?? "",
        consentAt: request.consentAt ?? "",
      });
```

Change to:

```typescript
  async escalate(request: EscalationRequest): Promise<EscalationReceipt> {
    try {
      const receipt = await invokeFunction<EscalationReceipt>(this.client, "escalateToHuman", {
        reason: request.reason,
        summary: request.summary,
        agent: request.agent ?? "",
        name: request.name ?? "",
        phone: request.phone ?? "",
        email: request.email ?? "",
        topic: "",
        consentVersion: request.consentVersion ?? "",
        consentAt: request.consentAt ?? "",
        channel: request.channel ?? "",
        campaign: request.campaign ?? "",
        landingPath: request.landingPath ?? "",
      });
```

- [ ] **Step 5: Verify it compiles**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/services/base44/Base44LeadService.ts src/services/base44/Base44SupportService.ts
git commit -m "Thread channel/campaign/landingPath through the four Base44 adapters"
```

---

## Task 11: UI call sites — attach attribution at the moment of submission

**Files:**
- Modify: `src/components/dorit/forms/QuickContact.tsx`
- Modify: `src/components/dorit/forms/ClaimForm.tsx`
- Modify: `src/components/dorit/chat/AgentChat.tsx`
- Test: `tests/component/sanity.test.tsx` (QuickContact), `tests/component/agent-handoff-analytics.test.tsx` (AgentChat hand-off + interview)

**Interfaces:**
- Consumes: `getAttribution` from `@/lib/attribution` (Task 1).

- [ ] **Step 1: `QuickContact.tsx`**

The `submitLead` call currently reads:

```typescript
    const ok = await submit(() =>
      services.leads.submitLead({
        name: form.name,
        phone: form.phone,
        email: form.email,
        source: "quick",
        message: form.message,
      })
    );
```

Add the import at the top of the file (alongside the other `@/lib/*` imports):

```typescript
import { getAttribution } from "@/lib/attribution";
```

Change the call to:

```typescript
    const ok = await submit(() => {
      const attribution = getAttribution();
      return services.leads.submitLead({
        name: form.name,
        phone: form.phone,
        email: form.email,
        source: "quick",
        message: form.message,
        channel: attribution?.channel,
        campaign: attribution?.campaign ?? undefined,
        landingPath: window.location.pathname,
      });
    });
```

- [ ] **Step 2: `ClaimForm.tsx`**

The `submit` function currently reads (from Task 3's file, unchanged by that task):

```typescript
  const submit = async () => {
    if (!valid) return;
    await submitReport(() =>
      services.leads.submitClaim({
        name,
        phone,
        email,
        claimType,
        eventDate,
        policyNumber,
        description,
        documents: docs.map((d) => d.url),
      })
    );
  };
```

Add the import at the top of the file:

```typescript
import { getAttribution } from "@/lib/attribution";
```

Change the call to:

```typescript
  const submit = async () => {
    if (!valid) return;
    const ok = await submitReport(() => {
      const attribution = getAttribution();
      return services.leads.submitClaim({
        name,
        phone,
        email,
        claimType,
        eventDate,
        policyNumber,
        description,
        documents: docs.map((d) => d.url),
        channel: attribution?.channel,
        campaign: attribution?.campaign ?? undefined,
        landingPath: window.location.pathname,
      });
    });
    if (ok) leadEvents.claimSubmitted();
  };
```

(`leadEvents.claimSubmitted` is added in Task 12 below — if executing tasks out of order, this line will not compile until that task lands; the plan's stated order avoids that.)

- [ ] **Step 3: `AgentChat.tsx` — the interview close**

Add the import at the top of the file, alongside the existing `@/lib/*` imports (near `import { readHandoff } from "@/lib/interview-handoff";`):

```typescript
import { getAttribution } from "@/lib/attribution";
```

The interview-close call (`src/components/dorit/chat/AgentChat.tsx:233`) currently reads:

```typescript
        const receipt = await services.leads.submitInterview(summary);
```

Change to:

```typescript
        const attribution = getAttribution();
        const receipt = await services.leads.submitInterview({
          ...summary,
          channel: attribution?.channel,
          campaign: attribution?.campaign ?? undefined,
          landingPath: window.location.pathname,
        });
```

- [ ] **Step 4: `AgentChat.tsx` — the hand-off submit**

The `escalate` call (`src/components/dorit/chat/AgentChat.tsx:334-342`) currently reads:

```typescript
      const receipt = await services.support.escalate({
        reason,
        summary: `בקשה מהאתר למעבר לטיפול אנושי (${descriptor.conversationName}).\n\n${transcript}`,
        agent: descriptor.agent,
        name,
        phone,
        consentVersion: CONSENT_VERSION,
        consentAt: consentAt ?? "",
      });
```

Change to:

```typescript
      const handoffAttribution = getAttribution();
      const receipt = await services.support.escalate({
        reason,
        summary: `בקשה מהאתר למעבר לטיפול אנושי (${descriptor.conversationName}).\n\n${transcript}`,
        agent: descriptor.agent,
        name,
        phone,
        consentVersion: CONSENT_VERSION,
        consentAt: consentAt ?? "",
        channel: handoffAttribution?.channel,
        campaign: handoffAttribution?.campaign ?? undefined,
        landingPath: window.location.pathname,
      });
```

- [ ] **Step 5: Write the test pinning Review Focus item 5 — the model cannot inject attribution**

Add to `tests/component/agent-handoff-analytics.test.tsx`, as a new `describe` block (this file already mocks `@/services` and imports `AgentChat`/`AGENTS` — reuse that setup, do not duplicate the mock):

```typescript
describe("the interview's attribution never comes from the model", () => {
  it("ignores channel/campaign if the agent's fenced block happens to include them", async () => {
    const { readHandoff } = await import("@/lib/interview-handoff");
    const { summary } = readHandoff(
      "תודה.\n\n```lead\n" +
        JSON.stringify({ name: "רונית", phone: "0500000000", channel: "google", campaign: "hack" }) +
        "\n```"
    );
    expect(summary).not.toBeNull();
    expect(summary).not.toHaveProperty("channel");
    expect(summary).not.toHaveProperty("campaign");
  });
});
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/component/sanity.test.tsx tests/component/agent-handoff-analytics.test.tsx tests/component/interview-close.test.tsx`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors (the `leadEvents.claimSubmitted()` reference in `ClaimForm.tsx` will fail to compile until Task 12 — run this check again after Task 12, not as a gate here).

- [ ] **Step 7: Commit**

```bash
git add src/components/dorit/forms/QuickContact.tsx src/components/dorit/forms/ClaimForm.tsx src/components/dorit/chat/AgentChat.tsx tests/component/agent-handoff-analytics.test.tsx
git commit -m "Attach channel/campaign/landingPath at the moment each of the four forms submits

The interview's two fields come from AgentChat's own merge of
getAttribution() — never parsed out of the agent's fenced block,
which cannot know a visitor's attribution. Pinned by a test."
```

---

## Task 12: `ClaimForm` fires `generate_lead`, and gets the same autocomplete fix as `QuickContact`

**Files:**
- Modify: `src/lib/analytics.ts:122-133` (`leadEvents`)
- Modify: `src/components/dorit/forms/ClaimForm.tsx`
- Test: `tests/unit/analytics.dom.test.ts`, `tests/component/sanity.test.tsx`

**Interfaces:**
- Produces: `leadEvents.claimSubmitted(): void` (`track("generate_lead", { method: "claim" })`).

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/analytics.dom.test.ts`, inside `describe("leadEvents", ...)`, after the "counts a submitted form as a lead" test:

```typescript
  it("counts a submitted claim as a lead", () => {
    leadEvents.claimSubmitted();
    expect(w.gtag).toHaveBeenCalledWith("event", "generate_lead", { method: "claim" });
  });
```

And add, inside `describe("LEAD_EVENTS catalogue", ...)` (created in Task 3):

```typescript
  it("includes claim as a generate_lead method, same catalogue entry as the others", () => {
    leadEvents.claimSubmitted();
    const names = new Set(LEAD_EVENTS.map((e) => e.name));
    expect(names.has("generate_lead")).toBe(true);
  });
```

Add to `tests/component/sanity.test.tsx`, a new `describe("<ClaimForm />", ...)` block (model it on the existing `describe("<QuickContact />", ...)` block in the same file — import `ClaimForm` from `@/components/dorit/forms/ClaimForm`, `base44Mock` is already set up in this file for `submitLead`-style assertions):

```typescript
describe("<ClaimForm />", () => {
  it("reports a lead to GA4 only after a successful submission", async () => {
    const gtag = vi.fn();
    (window as any).gtag = gtag;
    const user = userEvent.setup();
    try {
      render(<ClaimForm />);
      await user.type(screen.getByLabelText(/שם מלא/), "רונית אבני");
      await user.type(screen.getByLabelText(/טלפון/), "0521234567");
      await user.click(screen.getByRole("button", { name: /שליחת דיווח/ }));
      await screen.findByText("הדיווח התקבל");
      expect(gtag).toHaveBeenCalledWith("event", "generate_lead", { method: "claim" });
    } finally {
      delete (window as any).gtag;
    }
  });

  it("carries autocomplete and inputMode on the phone and email fields", () => {
    render(<ClaimForm />);
    expect(screen.getByLabelText(/טלפון/)).toHaveAttribute("autoComplete", "tel");
    expect(screen.getByLabelText(/טלפון/)).toHaveAttribute("inputMode", "tel");
    expect(screen.getByLabelText(/אימייל/)).toHaveAttribute("autoComplete", "email");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/analytics.dom.test.ts tests/component/sanity.test.tsx -t "claim"`
Expected: FAIL — `leadEvents.claimSubmitted` does not exist; the `ClaimForm` tests fail on the missing GA4 call and the missing attributes.

- [ ] **Step 3: Add `leadEvents.claimSubmitted`**

`src/lib/analytics.ts:122-133` currently reads:

```typescript
export const leadEvents = {
  /** The short contact form, once the lead is saved — not on the click. */
  formSubmitted: () => track("generate_lead", { method: "contact_form" }),
  /** The interview's summary, once the page has submitted it and it saved. */
  interviewCompleted: () => track("generate_lead", { method: "ai_interview" }),
  chatStarted: (method: ChatMethod) => track("chat_start", { method }),
  /** Opening the hand-off panel — a request, not yet a lead. See `handoffCompleted`. */
  chatHandoff: (method: ChatMethod) => track("chat_handoff", { method }),
  /** The hand-off form, once `escalateToHuman` has actually reached דורית. */
  handoffCompleted: (method: ChatMethod) => track("generate_lead", { method }),
  preferredChannel: (channel: "whatsapp" | "phone") => track("preferred_channel_click", { channel }),
};
```

Change to:

```typescript
export const leadEvents = {
  /** The short contact form, once the lead is saved — not on the click. */
  formSubmitted: () => track("generate_lead", { method: "contact_form" }),
  /** A claim report, once it is saved — ClaimForm fired no GA4 event at all before this. */
  claimSubmitted: () => track("generate_lead", { method: "claim" }),
  /** The interview's summary, once the page has submitted it and it saved. */
  interviewCompleted: () => track("generate_lead", { method: "ai_interview" }),
  chatStarted: (method: ChatMethod) => track("chat_start", { method }),
  /** Opening the hand-off panel — a request, not yet a lead. See `handoffCompleted`. */
  chatHandoff: (method: ChatMethod) => track("chat_handoff", { method }),
  /** The hand-off form, once `escalateToHuman` has actually reached דורית. */
  handoffCompleted: (method: ChatMethod) => track("generate_lead", { method }),
  preferredChannel: (channel: "whatsapp" | "phone") => track("preferred_channel_click", { channel }),
};
```

- [ ] **Step 4: Wire it into `ClaimForm.tsx` and add the import**

`ClaimForm.tsx`'s top imports currently read (after Task 11's addition):

```typescript
import React, { useState } from "react";
import { Upload, X, FileText, Loader2, Check, AlertTriangle } from "lucide-react";
import { services } from "@/services";
import { useSubmission } from "@/hooks/useSubmission";
import { CtaButton } from "@/components/dorit/primitives/Cta";
import { Field, inputClass } from "@/components/dorit/primitives/Field";
import { getAttribution } from "@/lib/attribution";
```

Add `leadEvents`:

```typescript
import React, { useState } from "react";
import { Upload, X, FileText, Loader2, Check, AlertTriangle } from "lucide-react";
import { services } from "@/services";
import { useSubmission } from "@/hooks/useSubmission";
import { leadEvents } from "@/lib/analytics";
import { getAttribution } from "@/lib/attribution";
import { CtaButton } from "@/components/dorit/primitives/Cta";
import { Field, inputClass } from "@/components/dorit/primitives/Field";
```

(The `submit` function's `if (ok) leadEvents.claimSubmitted();` line was already written in Task 11 Step 2 — this step only adds the now-resolvable import.)

- [ ] **Step 5: Add `autoComplete`/`inputMode` to the phone and email fields**

`ClaimForm.tsx`'s phone/email fields currently read:

```typescript
          <Field label="טלפון *">
            <input value={phone} onChange={set("phone")} className={inputClass()} dir="ltr" />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="אימייל (לא חובה)">
            <input value={email} onChange={set("email")} className={inputClass()} dir="ltr" />
          </Field>
```

Change to:

```typescript
          <Field label="טלפון *">
            <input
              value={phone}
              onChange={set("phone")}
              className={inputClass()}
              dir="ltr"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="אימייל (לא חובה)">
            <input
              value={email}
              onChange={set("email")}
              className={inputClass()}
              dir="ltr"
              type="email"
              autoComplete="email"
            />
          </Field>
```

Also add `autoComplete="name"` to the name field just above it:

```typescript
          <Field label="שם מלא *">
            <input value={name} onChange={set("name")} className={inputClass()} />
          </Field>
```

Change to:

```typescript
          <Field label="שם מלא *">
            <input value={name} onChange={set("name")} className={inputClass()} autoComplete="name" />
          </Field>
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/analytics.dom.test.ts tests/component/sanity.test.tsx`
Expected: PASS.

Run: `npm run typecheck`
Expected: no errors — this resolves the `leadEvents.claimSubmitted` reference left dangling by Task 11.

- [ ] **Step 7: Commit**

```bash
git add src/lib/analytics.ts src/components/dorit/forms/ClaimForm.tsx tests/unit/analytics.dom.test.ts tests/component/sanity.test.tsx
git commit -m "ClaimForm: fire generate_lead on success, and the same autocomplete fix as QuickContact

Confirmed by grep before this change: ClaimForm called
submitClaim but never touched src/lib/analytics.ts at all — a
claim report generated no GA4 event whatsoever."
```

---

## Task 13: Integration tests — the email line and the Lead write, end to end

**Files:**
- Modify: `tests/integration/submit-lead.integration.test.ts`
- Create: `tests/integration/submit-claim.integration.test.ts`
- Modify: `tests/integration/escalate-to-human.integration.test.ts`

**Interfaces:**
- Consumes: `invokeFunction` from `../helpers/base44-function` (already covers `submitLead`/`escalateToHuman`; confirm it also runs `submitClaim` unmodified — the harness compiles any `base44/functions/<name>/entry.ts` matching its `SDK_IMPORT`/default-export conventions, which `submitClaim` already satisfies).

- [ ] **Step 1: `submitLead` — add channel/campaign assertions**

Add to `tests/integration/submit-lead.integration.test.ts`, inside `describe("submitLead — the enquiry actually lands", ...)`, after the "reports the calendar and sheet outcome in that appendix" test:

```typescript
  it("adds a הגיע/ה דרך line when a known channel is supplied, and persists it on the Lead", async () => {
    const r = await invokeFunction("submitLead", {
      ...consultation,
      channel: "linkedin",
      campaign: "autumn_push",
    });
    expect(r.mailTo(OPS).text).toContain("הגיע/ה דרך: linkedin / autumn_push");
    expect(r.mailTo(OPS).html).toContain("הגיע/ה דרך");
    expect(r.leads[0]).toMatchObject({ channel: "linkedin", campaign: "autumn_push" });
  });

  it("omits the line and stores 'unknown' for an unrecognised channel, never echoing it into the email", async () => {
    const r = await invokeFunction("submitLead", { ...consultation, channel: "<script>evil</script>" });
    expect(r.mailTo(OPS).text).not.toContain("הגיע/ה דרך");
    expect(r.mailTo(OPS).text).not.toContain("script");
    expect(r.leads[0].channel).toBe("unknown");
  });

  it("re-sanitises campaign server-side rather than trusting the client's own stripping", async () => {
    const r = await invokeFunction("submitLead", {
      ...consultation,
      channel: "google",
      campaign: "<script>alert(1)</script>",
    });
    expect(r.mailTo(OPS).text).not.toContain("<script>");
    expect(r.leads[0].campaign).toBe("scriptalert1script");
  });

  it("omits the line entirely when no channel was supplied at all", async () => {
    const r = await invokeFunction("submitLead", consultation);
    expect(r.mailTo(OPS).text).not.toContain("הגיע/ה דרך");
    expect(r.leads[0].channel).toBe("unknown");
  });
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/integration/submit-lead.integration.test.ts`
Expected: PASS.

- [ ] **Step 3: New `submit-claim.integration.test.ts`**

```typescript
// tests/integration/submit-claim.integration.test.ts
import { describe, expect, it } from "vitest";
import { invokeFunction } from "../helpers/base44-function";

/**
 * `submitClaim`, executed — the same "run it and look at what came out"
 * approach as submit-lead.integration.test.ts, scoped to what this plan
 * actually changed: channel/campaign validation and the email line.
 */

const AGENCY = "dorit@govari-fin.co.il";
const OPS = "amielnoy@gmail.com";

const claim = {
  name: "משה לוי",
  phone: "0509876543",
  email: "moshe@example.com",
  claimType: "ביטוח חיים / מקרה מוות",
  eventDate: "2026-09-01",
  description: "תביעה בעקבות אירוע רפואי.",
};

describe("submitClaim — channel attribution", () => {
  it("stores the claim as a lead with the supplied channel", async () => {
    const r = await invokeFunction("submitClaim", { ...claim, channel: "facebook" });
    expect(r.status).toBe(200);
    expect(r.leads[0]).toMatchObject({ source: "claim", channel: "facebook" });
  });

  it("adds a הגיע/ה דרך line to both the operations and agency copies — submitClaim sends them the same agentBody, unlike submitLead's richer ops-only footer", async () => {
    const r = await invokeFunction("submitClaim", { ...claim, channel: "instagram", campaign: "q4" });
    expect(r.mailTo(OPS).body).toContain("הגיע/ה דרך: instagram / q4");
    expect(r.mailTo(AGENCY).body).toContain("הגיע/ה דרך: instagram / q4");
  });

  it("stores 'unknown' and adds no line for an unrecognised channel", async () => {
    const r = await invokeFunction("submitClaim", { ...claim, channel: "not_a_real_channel" });
    expect(r.leads[0].channel).toBe("unknown");
    expect(r.mailTo(OPS).body).not.toContain("הגיע/ה דרך");
  });

  it("works with no channel supplied at all", async () => {
    const r = await invokeFunction("submitClaim", claim);
    expect(r.status).toBe(200);
    expect(r.leads[0].channel).toBe("unknown");
  });
});
```

- [ ] **Step 4: Run it**

Run: `npx vitest run tests/integration/submit-claim.integration.test.ts`
Expected: PASS. `OPS` (`amielnoy@gmail.com`) is a `CORE_EMAILS` address, so its `sendMail` call reaches the harness's `Core.SendEmail` stub as `{ to, subject, body: plain }` (no `html`/`text` keys) — confirmed in `tests/helpers/base44-function.ts:189-193` and `217`. `AGENCY` goes through the mailer-fetch stub instead (`tests/helpers/base44-function.ts:238`), which records `body: payload.text` — and `submitClaim`'s own `sendMail` calls pass the identical `agentBody` as `body:` for both recipients, so `.body` is populated and identical in content for both `mailTo(OPS)` and `mailTo(AGENCY)`.

- [ ] **Step 5: `escalateToHuman` — add channel assertions**

Add to `tests/integration/escalate-to-human.integration.test.ts`, as a new `describe` block:

```typescript
describe("escalateToHuman — channel attribution", () => {
  it("adds a הגיע/ה דרך line and persists the channel when contactable", async () => {
    const r = await invokeFunction("escalateToHuman", {
      reason: "user_request",
      summary: "בקשה לדבר עם דורית.",
      agent: "needs_interview",
      name: "דנה כהן",
      phone: "0541112222",
      channel: "ai_assistant",
    });
    expect(r.mailTo("dorit@govari-fin.co.il").text).toContain("הגיע/ה דרך: ai_assistant");
    expect(r.leads[0]).toMatchObject({ channel: "ai_assistant" });
  });

  it("stores 'unknown' for an unrecognised channel and adds no line", async () => {
    const r = await invokeFunction("escalateToHuman", {
      reason: "user_request",
      summary: "בקשה לדבר עם דורית.",
      agent: "needs_interview",
      name: "דנה כהן",
      phone: "0541112222",
      channel: "bogus",
    });
    expect(r.leads[0].channel).toBe("unknown");
    expect(r.mailTo("dorit@govari-fin.co.il").text).not.toContain("הגיע/ה דרך");
  });
});
```

(Confirmed against the file's existing fixture (`reason: "product_recommendation"`, same field names) and `REASONS` in `base44/functions/escalateToHuman/entry.ts:170-180` — `user_request` ("המבקר ביקש לדבר עם אדם") is a valid key. `.mailTo(AGENCY).text` matches the file's own existing convention at `tests/integration/escalate-to-human.integration.test.ts:140` (`.body`, the mailer-stub's alias for the same `payload.text` value).)

- [ ] **Step 6: Run it**

Run: `npx vitest run tests/integration/escalate-to-human.integration.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/integration/submit-lead.integration.test.ts tests/integration/submit-claim.integration.test.ts tests/integration/escalate-to-human.integration.test.ts
git commit -m "Integration-test the channel line and the Lead write for all three backend functions"
```

---

## Task 14: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors (pre-existing warnings unrelated to this change, if any, are not this plan's to fix).

- [ ] **Step 3: Full Vitest suite**

Run: `npx vitest run`
Expected: every test file passes, including all new ones from Tasks 1–13.

- [ ] **Step 4: Production build**

Run: `npx vite build`
Expected: builds successfully. Clean up afterward: `rm -rf dist`.

- [ ] **Step 5: Relevant e2e (not exhaustive — this plan touches no page layout, so a full e2e run is not required, but the forms touched are worth a direct check)**

Run: `npx playwright test e2e/ui/forms.spec.ts e2e/ui/agent-compliance.spec.ts --project=android-chrome --project=web-chromium`
Expected: PASS — these exercise `QuickContact` and the interview/hand-off flows this plan modified.

- [ ] **Step 6: Final review of the diff against the spec**

Read back `docs/superpowers/specs/2026-10-09-lead-source-attribution-design.md`'s Scope section and confirm every "In" item has a corresponding committed change; confirm nothing in "Out" was touched (no GA4 admin-console changes, no privacy-policy text, no last-touch logic, no outbound-link UTM tagging).

- [ ] **Step 7: Push the branch**

```bash
git push -u origin lead-source-attribution
```

(Opening the PR, if wanted, is a separate step the operator takes explicitly — not assumed here.)
