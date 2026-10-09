# Ranking leads by the channel that brought them

**Date:** 2026-10-09 · **Status:** design approved in conversation; spec awaiting review.

## Why

GA4 shows 0 key events today. Not because nothing fires — `click_whatsapp`,
`click_phone`, `click_email`, `cta_click`, `chat_start`, `chat_handoff` and
`generate_lead` all fire on the live site — but because none of them has ever
been marked a key event in GA4's own admin settings, and nothing says which
marketing channel brought the visitor who generated them. A report with every
lead attributed to "(not set)" cannot rank anything.

**Outcome:** every lead-generating event carries the channel that brought that
visitor, so GA4's Explore can build a free-form report — channel as rows, key
events as columns — and read off which channel brings leads, not just visits.
Dorit's notification email and the saved lead record carry the same channel,
so the answer is also legible by hand, not only through GA4.

**Success looks like:**

- A visitor who arrives from a LinkedIn link with `utm_source=linkedin` and
  later submits the quick-contact form: the GA4 `generate_lead` event and
  Dorit's email both say `linkedin`.
- A visitor who arrives with no tag and no referrer, later converts: both say
  `direct`, not blank.
- A second visit, weeks later from a different channel, does not overwrite the
  first-touch channel already on record for that browser.
- `chat_handoff` is no longer counted as a lead in GA4's key-event sense — only
  the hand-off that actually reaches Dorit (`generate_lead`) is.
- A claim report now generates a `generate_lead` event, which it never did.

## Scope

**In:** first-touch channel capture and 90-day storage; `lead_source` /
`lead_campaign` on every GA4 event; a `channel` line in Dorit's notification
email for every lead-generating backend function; a `channel` + `campaign`
field on the saved Lead (Base44 and the Supabase mirror); `chat_handoff`'s
`keyEvent` flag; a `generate_lead` call from `ClaimForm`; autocomplete
attributes on `ClaimForm`'s phone/email fields (same fix already applied to
`QuickContact`, missed there).

**Out:** actually marking key events / adding custom dimensions in GA4's admin
UI — that is a dashboard action for whoever has access, not a code change, and
is covered in the follow-up checklist, not this spec. Tagging the site's own
outbound marketing links (LinkedIn profile, etc.) with `utm_*` — a content
task, not a code one. Rewriting the privacy policy — see Compliance below.
Last-touch attribution, or anything beyond the single first-touch value.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Compliance posture | **Build it; flag the gap, don't resolve it** | COMPLIANCE.md §8 already names GA4/cookies as unaddressed in the privacy policy. This adds one more channel-name-only value to the same unresolved area rather than a new category of exposure. Flagged explicitly in this spec and left for Dorit's compliance adviser — not something this change resolves by writing policy text. Confirmed with the operator, 2026-10-09. |
| Channel taxonomy | **Marketing-relevant, closed set**: `google`, `facebook`, `instagram`, `linkedin`, `ai_assistant`, `email`, `sms`, `referral`, `direct` | Matches what the business can actually act on. A closed set, not raw UTM/referrer strings, keeps the GA4 report and the notification email readable and keeps unvalidated text out of an email body (same discipline as `upstreamReasons`'s closed vocabulary in `submitLead`). |
| Attribution model | **First-touch only** | Answers "what channel originally earned this visitor's attention" — the standard model for ranking marketing spend — and needs one stored value with no overwrite logic, versus two values and reconciliation logic for first+last. |
| New field vs. reusing `source` | **New field, named `channel`** | `Lead.source` (Base44) / `leads.source` (Supabase) is already a closed enum of *which form* (`consultation`/`detailed`/`quick`/`claim`/`escalation`/`interview`) — confirmed by reading both schemas. Reusing it for marketing channel would silently corrupt that existing meaning. |
| Where capture lives | **One module, one choke point** (`src/lib/attribution.ts`) | Every other piece — GA4 events, lead payloads — reads through `getAttribution()`. Nothing else parses `document.referrer` or `location.search` directly, so there is exactly one place classification logic can drift. |

## What exists today

- `src/lib/analytics.ts`: `track(eventName, params)` allowlists `location`,
  `cta`, `method`, `channel` and drops everything else; auto-adds
  `traffic_type: internal` when `?internal=1` marked this browser.
  `initClickTracking()` is one document-level listener firing
  `click_phone`/`click_whatsapp`/`click_email`/`cta_click` for any matching
  link anywhere on the page. `leadEvents` is the explicit-call API
  (`formSubmitted`, `interviewCompleted`, `chatStarted`, `chatHandoff`,
  `handoffCompleted`, `preferredChannel`). `LEAD_EVENTS` is the catalogue the
  admin panel renders; `analytics.dom.test.ts` fails if a sent event is
  missing from it.
- `handoffCompleted` (added 2026-10-08, this session) already fires
  `generate_lead` once `escalateToHuman` actually succeeds. `chat_handoff`
  fires separately, on *opening* the hand-off panel — currently also marked
  `keyEvent: true` in `LEAD_EVENTS`, which double-counts one hand-off as two
  leads once `handoffCompleted` is counted too.
- `base44/entities/Lead.jsonc` / `supabase/migrations/20260921000000_initial_schema.sql`
  (`public.leads`): both define `source` as the closed form-type enum above.
  Neither has a channel/campaign field today.
- `base44/functions/{submitLead,submitClaim,escalateToHuman}/entry.ts`: the
  three functions that write a Lead and email Dorit. Each duplicates its own
  copy of shared constants by convention (no shared module in Base44) —
  `NOTIFY_EMAILS`, `wallClock`, etc. — and `tests/contract/agents.contract.test.ts`
  fails when duplicated copies drift from each other.
- `src/components/dorit/forms/ClaimForm.tsx`: calls `services.leads.submitClaim`
  on success but never calls into `src/lib/analytics.ts` — confirmed by
  grep — so a claim report generates no GA4 event at all today.
- `src/components/dorit/forms/QuickContact.tsx`: already has `autoComplete`
  and `inputMode="tel"` on its fields (fixed 2026-10-08, this session).
  `ClaimForm.tsx`'s phone/email inputs do not.

## Design

### 1. Capture — `src/lib/attribution.ts` (new)

```ts
export type Channel =
  | "google" | "facebook" | "instagram" | "linkedin" | "ai_assistant"
  | "email" | "sms" | "referral" | "direct";

export interface Attribution { channel: Channel; campaign: string | null }

export function captureAttribution(): void   // run once per session
export function getAttribution(): Attribution | null
```

`captureAttribution()`, called once from `App.jsx`'s existing analytics
`useEffect` (beside `initInternalFlag()` / `initClickTracking()`):

1. Reads an existing stored value from `localStorage`. If present and younger
   than 90 days, returns without writing — **first-touch is never
   overwritten**.
2. Otherwise classifies the current visit:
   - `utm_source` maps directly to a channel via a small lookup table
     (`linkedin`→linkedin, `facebook`/`fb`→facebook, `instagram`/`ig`→instagram,
     `google`/`adwords`/`cpc`→google; anything else unrecognised falls through
     to the referrer check below rather than being trusted verbatim).
     `utm_campaign` (if present) becomes `campaign`, capped to a safe length
     and stripped of anything that is not alphanumeric/`-`/`_` before it is
     ever allowed near an email. `utm_medium` is not separately consulted —
     one signal (`utm_source`) is enough and keeps the mapping unambiguous.
   - Otherwise, `document.referrer`'s hostname is checked **specific hosts
     first, broad suffix last** — order matters, because a generic `google.`
     suffix match would otherwise swallow Gemini's own referrer:
     1. Known AI-assistant hosts — `chat.openai.com`, `chatgpt.com`,
        `claude.ai`, `perplexity.ai`, `gemini.google.com` — all map to
        `ai_assistant`, checked before the broad Google match below.
     2. `facebook.com`/`fb.com`, `instagram.com`, `linkedin.com` (and their
        `www.`/regional subdomains) map to their own channel.
     3. Any other `google.`-suffixed host (i.e. actual search) maps to
        `google`.
   - An unrecognised external hostname is `referral`; no referrer at all is
     `direct`.
3. Writes `{channel, campaign, capturedAt}` to `localStorage` under one key.

`getAttribution()` reads that value back. Like every other function in
`analytics.ts`, it never throws — a blocked or absent `localStorage` (private
browsing, an ad blocker) resolves to `null`, the same shape `isInternalBrowser()`
already returns false for under the same conditions.

Nothing outside this module reads `document.referrer` or `location.search` for
attribution purposes. That is the whole point of the module: one place to
audit, one place that can drift.

### 2. GA4 — `analytics.ts`

`ALLOWED_PARAMS` gains `lead_source` and `lead_campaign`. `track()` calls
`getAttribution()` once and, when it resolves, adds `lead_source` (the
channel) and `lead_campaign` (if any) to every outgoing event — not just
`generate_lead` — so any event in GA4 can be sliced by channel, matching the
"attach to every event" requirement, with no change needed at any of
`track()`'s call sites.

`LEAD_EVENTS`'s `chat_handoff` row: `keyEvent` flips from `true` to `false`.
Its "when" text gets a one-line note pointing at `generate_lead` /
`handoffCompleted` as the event that now represents the completed hand-off.

### 3. Lead-submission call sites

`QuickContact`, `ClaimForm`, and `AgentChat` (both the interview's
`submitInterview` close and the hand-off's `escalateToHuman` submit) each call
`getAttribution()` and include `channel` / `campaign` — plus `landingPath`,
read fresh as `window.location.pathname` at submission time, not stored
anywhere — in the payload they already send to their `services.*` method.
`landingPath` is informational only (the route the visitor was on when they
converted, for the email line's "נחיתה: /tools"), never a query string, and
never persisted on the Lead — only `channel`/`campaign` are, per the schema
in §5. `ClaimForm` additionally gains a
`leadEvents.claimSubmitted()` call (`track("generate_lead", { method: "claim" })`,
mirroring `formSubmitted`/`interviewCompleted`) on a successful
`submitClaim`, and `autoComplete="tel"`/`"email"` + `inputMode="tel"` on its
phone/email inputs, matching `QuickContact`.

The `Article`-style service interfaces (`LeadPort` etc. in
`src/services/ports.ts`) gain an optional `channel?: string` / `campaign?: string`
on the relevant submit payloads, threaded through the existing Base44 adapters
to the function call body — no new port, no new adapter.

### 4. Backend — `submitLead`, `submitClaim`, `escalateToHuman`

Each accepts `channel` / `campaign` / `landingPath` on the request body.
`channel` is validated against the same closed taxonomy server-side (an
unrecognised value is treated as absent, never echoed into the email or the
log) — the same "closed vocabulary" discipline `submitLead` already applies to
upstream mailer-failure reasons. `campaign` is re-sanitised server-side
(alphanumeric/`-`/`_` only, length-capped) rather than trusted from the
client — §1's client-side stripping is a UX nicety, not the enforcement
boundary, since this is a POST body a visitor's browser does not have to go
through the page to send. `landingPath` is accepted only if it looks like a
bare site-relative path (matches the known route list, no query string, no
scheme) — never interpolated into the email unchecked. A validated channel
adds one line to the notification email, directly under the existing contact
details:

```
הגיע/ה דרך: linkedin (נחיתה: /tools)
```

— channel, plus campaign in parentheses after it when present, plus landing
path in its own parentheses when present. The `channel`/`campaign` values are
passed through to the Lead write (see below) regardless of whether the email
line renders, so the admin list can filter even when a line was suppressed for
an unrecognised value; `landingPath` is not persisted (§3).

The taxonomy lookup table is duplicated into each function's `entry.ts` by the
existing convention — no shared module in Base44 — and
`tests/contract/agents.contract.test.ts`'s drift guard is extended to also
compare this constant across the three functions, the same way it already
compares `NOTIFY_EMAILS` and the calendar constants.

### 5. Schema

`base44/entities/Lead.jsonc`: two new properties, `channel` (string, enum —
the closed taxonomy plus `"unknown"` as a catch-all for pre-this-change leads
and unrecognised values) and `campaign` (string, no enum — free text but
length-capped and sanitised before it ever reaches here, per §4). Neither is
`required`: not every write path (e.g. an admin editing a lead by hand) will
supply one.

`supabase/migrations/<timestamp>_lead_channel.sql`: adds `channel text check
(channel in (...))` and `campaign text` to `public.leads`, mirroring the
Base44 properties exactly, following the same pattern as the existing
`source`/`escalation_reason` check constraints in the initial schema.

## Error handling

Attribution is best-effort at every layer, and nothing it touches is allowed
to block a lead from saving or a visitor from being notified:

- `captureAttribution()` / `getAttribution()`: never throw; a blocked or
  absent `localStorage` resolves to `null`, same as `isInternalBrowser()`.
- `track()`: a `null` attribution simply omits `lead_source`/`lead_campaign`
  from the event, same as every other optional param today.
- Lead-submission call sites: a `null` attribution sends no `channel` field at
  all, not an empty string — the backend's "treat an unrecognised value as
  absent" rule already covers this without a separate branch.
- Backend functions: a missing or unrecognised `channel` writes `"unknown"`
  (Base44 enum) and omits the email line entirely — never a half-formed line,
  never a rejected submission.

## Testing

- **Unit** (`tests/unit/attribution.test.ts`, new): UTM-present classification,
  each known referrer hostname, an unknown external hostname → `referral`, no
  referrer → `direct`, first-touch-wins-over-a-second-visit, 90-day expiry,
  `localStorage` blocked/absent → `null` and no throw.
- **Unit** (`tests/unit/analytics.dom.test.ts`, extended): `track()` attaches
  `lead_source`/`lead_campaign` when attribution is present, omits both when
  it is not; `chat_handoff`'s `keyEvent` is `false` in `LEAD_EVENTS`.
- **Component**: `ClaimForm` fires `generate_lead` with `method: "claim"` only
  after a successful submit, never on a failed one (same shape as the
  existing QuickContact GA4 test from 2026-10-08) and carries `autoComplete`/
  `inputMode` on phone/email.
- **Contract**: `agents.contract.test.ts`'s drift guard extended to the new
  duplicated taxonomy constant across the three backend functions.
- **Integration**: `submit-lead.integration.test.ts` and a new
  `submit-claim.integration.test.ts` assert the `הגיע/ה דרך` email line for a
  known channel, its absence for an unrecognised one, and the `channel`/
  `campaign` fields on the written Lead.

## Disclosure

No name, phone, email, message, or any other personal field is ever stored by
`attribution.ts` — only a channel name and an optional campaign string, the
same boundary `analytics.ts` already enforces for GA4 (`track`'s allowlist).
This is additive to, not a new category of, the GA4 tracking COMPLIANCE.md §8
already flags as unaddressed in the privacy policy — left for Dorit's
compliance adviser, not resolved by this change.

## Order of work

1. `src/lib/attribution.ts` + its unit tests.
2. `analytics.ts`: allowlist, auto-attach, `chat_handoff` keyEvent flip + its
   test updates.
3. `ClaimForm.tsx`: GA event + autocomplete fix + its test.
4. Schema: `Lead.jsonc` properties + Supabase migration.
5. Backend: the three functions' `channel`/`campaign` handling, email line,
   taxonomy constant + contract-test extension.
6. Frontend call sites: thread `getAttribution()` into the three submission
   payloads.
7. Integration tests for the email line and the Lead write.
8. Full verification pass (typecheck, lint, vitest, relevant e2e, build).

## Open items

- GA4 admin-side configuration (marking key events, adding custom dimensions
  for `lead_source`/`lead_campaign`/`method`/`location`, activating the
  internal-traffic filter) is a dashboard action for whoever has GA4 access —
  not part of this change, listed here so it is not forgotten.
- Tagging the site's own outbound links (LinkedIn profile, etc.) with
  `utm_source`/`utm_campaign` is a content task, not this spec's.
- The privacy-policy/GA4 compliance gap (COMPLIANCE.md §8) stays open; this
  spec does not resolve it.
