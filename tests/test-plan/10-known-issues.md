# Known Issues & Deviations

Findings surfaced while building this suite, and the deliberate deviations in
how the suite is gated. Each entry says what it is, where it lives, and what
closing it would take.

---

## A. Defects found and fixed

| # | Finding | Fix |
|---|---|---|
| A-1 | `index.html` linked `/manifest.json`, which did not exist. The SPA fallback answered with `index.html` and a `200`, so nothing ever appeared broken. Found by `API-HTP-010`. | Added `public/manifest.json` with the site's existing name, description, `theme_color` (`#F9F7F2`), RTL/`he` and icon. |
| A-2 | The mobile burger button was a 38 × 38 px tap target (`p-2` around a 22 px icon), under the WCAG 2.5.5 / iOS HIG 44 px minimum. Found by `E2E-MOB-006`. | `FloatingHeader.tsx` → `p-3` (46 px). |
| A-3 | Star ratings used `aria-label` on a bare `<div>`, which is prohibited — screen readers ignored the rating entirely. 5 nodes on the home page. Found by `A11Y-AXE-001` (`aria-prohibited-attr`). | `role="img"` added in `Stars.tsx` and `ReviewsWidget.tsx`. |
| A-4 | The horizontally scrollable proof carousel had no keyboard access. Found by `A11Y-AXE-001` (`scrollable-region-focusable`). | `ProofCarousel.tsx` → `tabIndex={0}`, `role="region"`, `aria-label`, and a visible focus ring. |
| A-5 | **Every route served the same `<title>`, description and `<link rel="canonical">`, the canonical hard-pointing at the home page.** For a client-rendered SPA with one static `<head>` this is the most damaging SEO defect available: it tells search engines that `/blog`, `/claims` and every article *are* the home page, so they are dropped from the index. Found by writing `SEO-MET-007`. | Per-route metadata engine in `src/lib/seo.ts`; every public page now declares its own head. |
| A-6 | `FAQPage` structured data sat in `index.html`, so all thirteen routes claimed an FAQ they did not display — a structured-data policy violation ("content must be visible on the page"). | Moved to `src/lib/structured-data.ts` and injected by the home page alone (`SEO-LD-002`). Organisation-level `FinancialService` and `Person` stay static, where they are valid site-wide. |
| A-7 | The login, registration, password-reset, OAuth-consent, admin and 404 routes were all indexable, inheriting `index, follow` from the static head — thin duplicate pages that dilute ranking and can surface an admin URL in results. | `src/components/SeoRouteGuard.tsx` sends `noindex, nofollow`; `robots.txt` also disallows them (`SEO-IDX-007..012`, `SEO-CRW-001`). |
| A-8 | The sitemap listed only three URLs, omitting `/blog` and `/claims` — two of the site's three content pillars. | Both added, with `changefreq`/`priority` reflecting how often each actually changes (`SEO-CRW-002`). |
| A-9 | The Base44 Vite plugin's analytics beacon (`/api/apps/:id/analytics/track/batch`) was unstubbed, producing console errors that failed console-clean assertions non-deterministically (it reproduced in the container, not on macOS). | Stubbed in `e2e/fixtures/app.ts`. |
| A-10 | **CI e2e-tested a bundle with no app id.** The `Build the way the Base44 Builder does` guard step rebuilt into the same `dist/` with `VITE_BASE44_APP_ID` stripped, and the next step uploaded *that* as the `dist` artifact every e2e shard downloads. Vite inlines the app id at build time, so the whole suite ran against a bundle posting to `/api/apps/undefined/…` and stayed green because `e2e/fixtures/app.ts` stubs `**/api/**`. | Guard build writes to `dist-builder-check`. `workflow.contract.test.ts` now fails if any job that uploads `dist` strips the environment into the default outDir. |
| A-11 | **The footer's menu was dead on six of seven routes.** Every `#section` it names lives on the home page, and the footer renders everywhere; a bare `#about` on `/blog` matched no element and did nothing — silently. The same defect had been fixed in the header and left here. | `useSectionNav` extracted from `FloatingHeader` and used by both, plus the `/claims` CTA. `E2E-NAV-012..015` pin it, including two general checks that catch the next one. |
| A-12 | **The Vercel production deploy was not gated on the tests.** `needs:` orders jobs, it does not gate them, and `deploy-vercel`'s `if:` required only `build` — so a red run on `main` still reached the step that passes `--prod`. Harmless while Vercel was staging; a red-push-to-customers hole once the domain moves. | A red run now deploys as a *preview* with a warning; only `--prod` waits for green. `deploy-gate.contract.test.ts` reads the step that picks the flag instead of the `needs:` line it used to grep. |
| A-13 | **A host move left `index.html` on the old origin.** `HOST_BEARING_ASSETS` omitted the document crawlers are actually served, so `VITE_SITE_URL` moved the sitemap while the canonical tag, `og:url` and two static JSON-LD blocks kept naming the old host. `applySeo` repairs the first two in-browser only, and never touches the JSON-LD. | `index.html` added to the rewrite, with `ASSET_SOURCES` for the one entry that is not under `public/`. |
| A-14 | **The staff notification email arrived as one running paragraph.** It was sent as `body` plain text, and Gmail collapsed the newlines — eight fields with no line breaks, which is the mail the agent opens on a phone to decide whether to call someone back. Separately, `submitClaim`'s customer confirmation had drifted from `submitLead`'s: no `dir="rtl"` (so the details table rendered its columns reversed), no `text-align`, a different panel colour, and no escaping at all on a name arriving from a public form. | Notification rebuilt as HTML in the site's palette with the plain text as its twin; one `buildClientHtml` duplicated byte-identically across both functions, enforced by `agents.contract.test.ts`. |
| A-15 | **"97% שיעור תביעות שאושרו" was published in three places** — the hero, the About stats grid and the `/claims` meta description. A licensed agent quoting a performance figure is a regulated claim, and nothing in the repo substantiated it. The meta-description copy was not visible on the page at all, so it reached search results and link previews unnoticed. | Removed from all three; the About grid resized from four columns to three so the strip has no empty cell. |
| A-16 | **A locally built bundle could not reach a backend.** Base44's hosting injects `VITE_BASE44_APP_ID`; nothing supplied it to a build from a clone, so `appId` inlined to `undefined` and every form reported the generic send failure. `vite preview` also serves no `/api` at all. | `scripts/vite-base44-backend-plugin.mjs` falls back to the linked app in `base44/.app.jsonc` and adds an opt-in preview proxy. Both inert in CI, which keeps the Builder-parity build honest. |
| A-17 | **A finished ראיון היכרות reached nobody.** The interview agent ended by writing the approved profile straight to `Lead.create`, which stores a row and sends nothing — so the summary waited in the database until somebody happened to open the leads screen, while every other enquiry on the site arrived as mail the same minute. Every other agent already ended through `submitLead`; this one never had. | Rewired to `submitLead` under a new `source='interview'`, so the interview rides the path every form uses. `CTR-AGT-*` now fails if the agent is wired to the `Lead` entity instead, and `INT-LEAD-031..038` execute the send. |
| A-18 | **The interview mail called itself two different things.** `headingFor()` was source-aware and rendered "סיכום ראיון היכרות", but the kicker above it was a string literal reading "פנייה מהאתר" — so the letter opened by calling an interview an enquiry, one line above calling it an interview. Introduced with A-17 and found by reading the mail that actually arrived, not by a test. | `eyebrowFor()` beside `headingFor()`. `INT-LEAD-041` pins the kicker and fails if it is ever hardcoded back. |
| A-19 | **The interview summary carried a redundant `[ראיון היכרות]` tag.** It printed as a bare line under a block already titled "פרופיל המבקר", and duplicated `source='interview'` — which the record carries structurally and the admin screen already labels. It was a leftover from the `Lead.create` prompt, where the source was `'consultation'` and the tag was the only thing marking an interview. | Dropped from the prompt; the source field is the marker. |
| A-20 | **The interview collected whatever the model chose to remember.** It ended in a paragraph the model composed, which read well and compared to nothing — what got recorded changed from conversation to conversation. | A fixed schema: seven tracks in `INTERVIEW_TRACKS`, selected from the visitor's goal, with the function whitelisting keys so a field the model invents is dropped before it reaches Dorit or the record. `CTR-AGT-*` pins code and prompt in agreement; `INT-LEAD-039..060` execute every track. |
| A-21 | **`submitClaim` had no integration coverage at all**, and was the third place the operations mailbox list had to be threaded through. A recipient change there is exactly what a source-matching test waves through: the constant is renamed, the loop is added, every string assertion still passes, and nobody notices until a claim is reported and one inbox stays empty. | `tests/integration/submit-claim.integration.test.ts` — `INT-CLAIM-001..013`. Removed from STD-12 §6. |
| A-22 | **An abandoned interview left nothing behind.** Contact details were the last thing asked, after every track question, so a visitor who answered four and closed the tab was invisible — and for a chat interview that is likely the common case. Dorit never learned they existed. | Name and phone moved ahead of the track questions; the agent saves a `partial` record as soon as it has them, silently. The closing call updates that row rather than creating a second. `INT-LEAD-065..072`. |
| A-23 | **Nothing tested whether the model obeys the prompt.** Every layer downstream of the agent was executed by a test — whitelist, redaction, rendering, recipients — while the part most likely to be wrong was covered only by asserting that a clause is *present* in the prompt file. | `tests/eval/` — opt-in evals that drive the deployed agent over the real conversation API. See [13-std-eval](13-std-eval.md), including why no scenario completes an interview. |
| A-24 | **"Didn't ask" and "asked, they don't know" collapsed to the same thing.** Empty fields are dropped, so a gap in the interview and a fact about the visitor were indistinguishable to whoever read the summary. | The prompt separates them explicitly, and the mail carries a completeness line — "5 מתוך 7 שדות נענו · 2 מהם לא ידועים למבקר". `INT-LEAD-073..075`. |
| A-25 | **The agent picked a track with no confirmation.** It announced a direction but the visitor could not correct it, and a mis-route costs them the entire four-question set. | One confirming question before committing. `EVAL-INT-003`. |
| A-26 | **`topic` and `profile.concern` were the same fact, supplied twice** — and after the schema change `topic` was not rendered in the staff mail at all, so one of the two copies was invisible. Two copies of a fact invite them to disagree. | Derived from the concern in the function; the agent no longer sends `topic`. `INT-LEAD-076..078`. |
| A-27 | **Nothing stopped a visitor creating three leads** by running the interview three times — "call it once" was a prompt instruction with no enforcement. | Same upsert as A-22: an interview open on that phone within six hours is updated, not duplicated. |
| A-28 | **The home page offered five ways to do one thing.** An interview chat, a booking chat, a three-step wizard, a detailed form and a short form — each asking for a name and a phone number — while the header, hero, sticky bar and footer each pointed at a different one. A visitor who wanted to talk to דורית had to decide, repeatedly, which door was the real one. | One `#start` section: the interview agent at full width, WhatsApp and phone beside it, the short form as a secondary card. Every CTA reads "לשיחה קצרה עם דורית" and points at `#start`. The wizard and detailed form are deleted. |
| A-29 | **The booking agent asked for a name the interview had already taken.** Two chats, back to back, for one errand. | `booking_assistant` merged into `needs_interview`, which now runs the scheduling step and calls `createConsultationEvent` itself. `CTR-AGT-*` fails if the prompt loses it. |
| A-30 | **Every agent rendered the same "ד" avatar** — saying the one thing the header must not, that these are דורית. | Per-agent `icon` in the descriptor: a speech bubble for the interview, a book for the reading recommender. |
| A-31 | **The home page declared FAQPage markup for questions it never displayed.** `HOME_FAQ_LD` carried six pension questions that only `/faq` renders; the home page showed a list of tips. Google requires the answer to be visible on the URL claiming it — the same defect as A-6, one section along — and `/faq` declared only `CollectionPage`, so the site had FAQ markup on the page without the answers and none on the page with them. | Markup moved to `/faq` and generated from the array the page maps over, so it cannot drift from what is rendered. `SEO-LD-*` asserts the home page claims none. |
| A-32 | **Embedding the chat dropped the published fence.** `AgentChat`'s guardrails panel rendered in the heading column, which the full-width layout does not draw — so "כללי הגדר" silently disappeared from the page while the prompt still claimed it. Caught by `E2E-AGT-002`. | Rendered by `StartConversation` instead, from the same descriptor. |
| A-33 | **`/faq` unmounted the answers its own markup declared.** The page rendered one category and dropped the rest, so most of the questions the `FAQPage` block described were not in the HTML at all. Google's guidance is that content hidden behind an accordion qualifies *because it is present*; unmounted content is absent. | Every category rendered, inactive ones hidden with `hidden`. `SEO-LD-*` reads the declared `mainEntity` and asserts every question **and answer** appears in `page.content()` — the property, not the mechanism. Nothing a visitor sees changed. |
| A-34 | **`llms.txt` published a phone number and an email that do not reach her** — `052-707-7776` and `doritg@fsfp-fin.co.il`, while every other surface had moved to `050-831-1776` and `dorit@govari-fin.co.il`. It is a static file in `public/`, so the type-checker and every suite were blind to it; the only symptom would have been an AI assistant handing a prospect a dead number. Resolves the `llms.txt` half of B-4. | Rewritten against `src/config/contact.js`, and `CTR-AI-001..010` now fail if any address or number in the file is not the canonical one. |
| A-35 | **Dorit was not receiving any of the leads.** `Core.SendEmail` on Base44 delivers only to registered users of the app, and the app has exactly one — `amielnoy@gmail.com`. So the operations copy arrived every time while `dorit@govari-fin.co.il` failed, reported as a bare `secondary_email_failed` in an appendix only the operations team reads. `amielnoy@outlook.com` had never worked either, and the visitor's confirmation cannot work at all, because a visitor is never a registered user. | Warnings now carry the delivery error itself (`deliveryWarning`), since the app keeps no logs and the mail is the only diagnostic. The interview stopped promising the visitor a confirmation it cannot send. **Registering the recipients remains an account action** — see B-6. |
| A-36 | **The interview would have written a blank row to the event sheet.** `appendEventRow` took `topic` — which the interview agent stopped sending once the meeting topic was derived from the schema — and `summary`, which it never sends at all, because the profile travels in `profile`. So the sheet would have recorded a name and a phone number with the interview itself missing. Nothing caught it: `SHEET_ID` was a hardcoded empty string, so the function returned before touching the network and **every test took that branch**. The column order was pinned; what landed in a row was pinned by nothing. | Row writes the derived topic, the track, and the profile text. `SHEET_ID`/`SHEET_TAB` moved to the environment so the path can actually be exercised, and `INT-LEAD-079..084` now run it. |
| A-37 | **The handover notification arrived as one running paragraph.** `escalateToHuman` sent plain text only, so mail clients folded the reason, the name, the phone and the conversation summary into a single line. It is the message Dorit opens on a phone to decide whether to call somebody back now, which is precisely what it prevented. Same defect as A-14, fixed for enquiries and left here because this function had no HTML path at all. | Four titled blocks in the site's palette, phone as a `tel:` link, urgent reasons framed in red, and a plain statement when nothing was stored. Text still travels alongside. `INT-ESC-020..028`, plus a contract test pinning the now-triplicated palette helpers byte-identical. |
| A-38 | **An address cannot be added to the Base44 mail path by adding it to a list.** `Core.SendEmail` delivers only to registered *app users*, and registration is not something that can be arranged from outside: `User.create` returns an id and the row does not exist, and a dashboard collaborator invite grants Builder access without creating an app user. Two attempts to register `amielnoy@outlook.com` looked successful and changed nothing. | `sendMail()` routes by transport capability rather than by role: `CORE_EMAILS` holds the one address the platform can actually reach, and everyone else — the agency, the second operations mailbox, the visitor — goes through the mailer. Contract tests pin the list identical across the three functions and fail if the agency ever lands on the Core path. |
| A-39 | **Four merges have been resolved by keeping both sides.** Each produced something that either does not parse or parses as the wrong thing: two `"instructions"` keys in the agent prompt (JSON keeps the last, so the file visibly contained a scheduling step the parser never saw — it would have published the wrong agent); two `const AGENT_ONLY` declarations, which stopped a whole contract file loading; two `sendMail` bodies with a doc comment's opening `/**` stripped, failing esbuild and taking 121 integration cases down at once; and an unbalanced brace in a test file. | Each resolved by hand to the newer side after checking the older contributed nothing. The pattern is a conflict inside a long comment or a helper, resolved by concatenation — worth disabling whatever resolves them automatically, since a green-looking merge here has twice produced code that would have shipped. |

## B. Open findings — decisions for the owner

### B-6 · Two mail recipients are still unregistered, and one of them is the agency

`Core.SendEmail` delivers only to registered users. `dorit@govari-fin.co.il` and
`amielnoy@outlook.com` are not registered, so every send to them fails.

Until they are registered, the site collects leads that only one mailbox ever
sees. Registering a person creates an account for them in the app, which is an
account action rather than a code change, so it is left here.

Two ways to close it:

1. **Register both addresses as users of the Base44 app** (the dashboard's user
   management). Dorit needs an account regardless — the `/admin/leads` screen is
   role-gated, and she is the person the leads are for.
2. **Move transactional mail to an external provider** with a verified sending
   domain, via a Marketplace integration. This is the only route that also makes
   the visitor's confirmation possible, since a visitor will never be a
   registered user.

The second is the real fix if confirmations are wanted; the first is enough to
stop losing leads today.

### B-0 · Routes are invisible to crawlers that do not run JavaScript

**This outranks every other SEO item in the file.**

The app is client-rendered and `useSeo` writes each page's title, description,
canonical and JSON-LD at runtime. The server returns the same `index.html` for
every path, so a crawler that does not execute JavaScript sees the **home
page's** metadata on `/faq`, `/blog`, `/tools`, `/claims` and `/perspective`.
Verified directly: serving `dist/` and requesting `/faq` returns the home
`<title>`.

Google renders JavaScript and recovers. GPTBot, ClaudeBot, PerplexityBot and
CCBot largely do not — so to an AI assistant this site is one page, and
`public/llms.txt` is the only thing it can read in full. That file is now
accurate and complete, which is mitigation rather than a fix.

The fix is prerendering the eight public routes at build time. Playwright is
already a dev dependency, so a post-build step could render each route and write
`dist/<route>/index.html` without adding anything to the tree — but whether a
real file is served ahead of the SPA rewrite differs between Vercel
(`vercel.json` rewrites) and Base44 hosting, and that needs checking on both
before it is worth building.

**Not done**, because it changes what the hosts serve and wants verification on
each of them first.

### B-1 · Colour contrast below WCAG AA

The brand accent `#7D6B5D` on the parchment background `#F9F7F2` measures about
**4.4:1**, just under the 4.5:1 AA floor for body-size text. axe flags 41 nodes
on the home page, 5–7 on `/blog` and `/claims`, and 2 in the footer on every
page (the muted grey copyright line).

Most failures are 11 px uppercase eyebrow text, which needs the full 4.5:1.
Options: darken `--accent` from `26 14% 39%` to roughly `26 14% 34%`, or raise
those specific labels to `--foreground` at reduced opacity. Both are palette
decisions, so the suite **reports** contrast on every run and enforces it only
on request:

```bash
E2E_ENFORCE_CONTRAST=1 npx playwright test e2e/a11y
```

Flip the `CONTRAST_RULE` handling in `e2e/a11y/axe.spec.ts` to unconditional
once the palette is settled.

### B-2 · Per-route metadata is applied by JavaScript, not served in the HTML

`src/lib/seo.ts` sets each route's title, description, canonical and structured
data at runtime. Google executes JavaScript before indexing, so it sees the
correct per-route head — and the SEO suite asserts exactly that.

What it does **not** fix: a crawler that does not render JavaScript (Bing's
lighter passes, most social-preview scrapers, `curl`) still receives the static
head from `index.html`, whose canonical points at the home page. So a link to
`/blog/some-post` pasted into a chat app may preview as the home page.

Closing it properly needs pre-rendering or SSR, which the Base44 SPA build does
not do today. The two options, in increasing order of effort:

1. A build step that pre-renders the five static routes to real HTML files
   (`vite-plugin-prerender` or a small Playwright-based script) — covers
   everything except individual blog posts.
2. Moving the app to an SSR-capable host.

Until then the runtime layer is the right trade: it fixes the case that governs
search ranking, and it is fully tested.

### B-3 · `npm run typecheck` has 93 inherited errors, now held on a ratchet

`tsc` fails on the current `main`, unchanged by this work (verified by running
it on a clean tree). The distribution is the whole story: **all 93 errors are in
`.tsx` files — none in the `.jsx` files at all.** 95 of the reported lines name
the same signature, `IntrinsicAttributes & RefAttributes<any>`, which is what an
untyped `forwardRef` component looks like from TypeScript's side. A typed page
imports an untyped shadcn primitive (`button`, `input`, `label`, `input-otp`,
`image`, the accordion) and every prop it passes is rejected; the 10 `TS7006`
implicit-`any` parameters are knock-on from the same cause, since an untyped
component supplies no event type to its own handler.

So this is a boundary problem, not a file-count problem. **Porting more
application code to TypeScript fixes none of it** — the fix is to type the ~8
primitives that are actually consumed, or to declare them in one `.d.ts`.

`noEmit` means nothing is broken at runtime, and `npm run build` succeeds
because Vite strips types without checking them.

**Since 2026-09-13 the step blocks.** What it cost while advisory was that a
genuinely new type error landed silently among the 93 and nobody had to fix it.
`npm run typecheck:gate` (`scripts/typecheck-gate.mjs`) allows for exactly the
inherited set, recorded in `tests/typecheck-baseline.json` keyed by file and
error code — never by line, so unrelated edits that shift lines do not trip it.
It fails on a new file/code pair, or on more errors of a known kind in a known
file. Fixing some and running `npm run typecheck:baseline` lowers the bar
permanently; the raw list is still `npm run typecheck`.

### B-4 · ~~Structured-data email disagrees with the rest of the site~~ — closed

`index.html`'s JSON-LD, `src/config/contact.js`, the footer and the escalation
fallback all publish `dorit@govari-fin.co.il` and `+972508311776`. The last
holdout was `public/llms.txt`, which still carried the old pair; see A-34.

`tests/contract/ai-surface.contract.test.ts` now derives the expected values
from `src/config/contact.js` and fails on any address or number in `llms.txt`
that is not the canonical one, which is the assertion this entry asked for.

### B-5 · Transport security headers are not asserted by default

The SPA cannot set CSP, HSTS, `X-Content-Type-Options` or `Referrer-Policy` —
those come from the Base44/CDN edge, and the local `vite preview` sets none of
them. `SEC-HDR-002` reports which are missing on every run; `SEC-HDR-001`
enforces them only against a real deployment:

```bash
E2E_ENFORCE_SECURITY_HEADERS=1 PLAYWRIGHT_BASE_URL=https://<site> npx playwright test e2e/security
```

### B-6 · Display labels are set at 11px on mobile

Fourteen eyebrow labels and stat captions (`INSURANCE ARCHITECT`, `שנות ניסיון`,
`LIFE & VITALITY` …) render at 11px uppercase with heavy letter-spacing. Google's
mobile-usability report flags "text too small to read" around 12px, and 11px
uppercase Hebrew with 0.35em tracking is genuinely hard to read on a phone.

Sentence-length body copy is enforced at ≥12px (`SEO-MOB-004`); the labels are
reported rather than enforced (`SEO-MOB-005`), because moving the type scale is a
design decision in the same class as the contrast finding in B-1, not an SEO fix.
Raising them to 12px would close it.

### B-7 · `src/lib/utils.js` touches `window` at module scope

`export const isIframe = window.self !== window.top` runs on import, so the
module cannot be loaded in any non-browser context. It forces `cn()`'s unit
tests into jsdom (`tests/unit/utils.dom.test.ts`) and would break SSR or any
future prerender step. A one-line guard (`typeof window !== "undefined"`) would
close it; left alone as it is outside the scope of this work.

### B-8 · ~~The support agent must not sit on the published WhatsApp number~~ — closed by decision

`support_agent` was built to answer on WhatsApp as well as on the site. It does
not, and will not on this number.

`+972508311776` is Dorit's own WhatsApp account — her photo, her chats, a person
on the other end — and it is the number the site, the consent notice,
`llms.txt` and the channels `escalateToHuman` returns all publish as the way to
reach a human. An agent sitting on it would answer "I want to speak to someone"
with the bot they are already talking to, on the number advertised as the escape
from it. Separately, the WhatsApp Business Platform requires a number **not**
currently registered on the consumer or Business app, so connecting this one
would have migrated her account and taken normal WhatsApp off her phone.

Resolved by removing the channel rather than the number: the agent answers in
the free chat on `/faq` only, and its prompt now hands over *every* channel
`escalateToHuman` returns, WhatsApp included, because a human answers on all
three. A contract case pins that inversion, and another pins that no agent holds
`upsertContact`.

**What stays built:** the `Contact` entity, `upsertContact` and their seventeen
integration cases. They are dormant, not dead — they exist for a channel that
delivers a phone number with the message, and re-enabling one means adding a
separate number, wiring the tool back to the agent, and deciding how the saving
is disclosed on a channel with no consent screen.

## C. Deliberate deviations in the suite

| Deviation | Reason |
|---|---|
| `A11Y-STR-005` skipped on WebKit | Safari only tabs to links when the OS "Press Tab to highlight each item" preference is on — a browser preference, not an app defect |
| Live-backend API cases skipped unless `E2E_LIVE_API_URL` is set | So CI can never write to production data |
| Third-party requests (GA, Google Fonts, `media.base44.com`) intercepted | Hermetic, offline-capable, deterministic runs |
| `framer-motion` stubbed in component tests | jsdom has no layout engine; the animation library is not the system under test |
| e2e runs against `vite preview`, not `vite dev` | The production bundle is what ships; this also proves the build boots |
