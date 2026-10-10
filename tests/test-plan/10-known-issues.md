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
| A-34 | **`llms.txt` published a phone number and an email that do not reach her** — `052-707-7776` and `doritg@fsfp-fin.co.il`, while every other surface had moved to `050-831-1776` and `dorit@govari-fin.co.il`. It is a static file in `public/`, so the type-checker and every suite were blind to it; the only symptom would have been an AI assistant handing a prospect a dead number. Resolves the `llms.txt` half of B-4. | Rewritten against `src/config/agencyProfile.ts`, and `CTR-AI-001..010` now fail if any address or number in the file is not the canonical one. |
| A-35 | **Dorit was not receiving any of the leads.** `Core.SendEmail` on Base44 delivers only to registered users of the app, and the app has exactly one — `amielnoy@gmail.com`. So the operations copy arrived every time while `dorit@govari-fin.co.il` failed, reported as a bare `secondary_email_failed` in an appendix only the operations team reads. `amielnoy@outlook.com` had never worked either, and the visitor's confirmation cannot work at all, because a visitor is never a registered user. | Warnings now carry the delivery error itself (`deliveryWarning`), since the app keeps no logs and the mail is the only diagnostic. The interview stopped promising the visitor a confirmation it cannot send. **Registering the recipients remains an account action** — see B-6. |
| A-36 | **The interview would have written a blank row to the event sheet.** `appendEventRow` took `topic` — which the interview agent stopped sending once the meeting topic was derived from the schema — and `summary`, which it never sends at all, because the profile travels in `profile`. So the sheet would have recorded a name and a phone number with the interview itself missing. Nothing caught it: `SHEET_ID` was a hardcoded empty string, so the function returned before touching the network and **every test took that branch**. The column order was pinned; what landed in a row was pinned by nothing. | Row writes the derived topic, the track, and the profile text. `SHEET_ID`/`SHEET_TAB` moved to the environment so the path can actually be exercised, and `INT-LEAD-079..084` now run it. |
| A-37 | **The handover notification arrived as one running paragraph.** `escalateToHuman` sent plain text only, so mail clients folded the reason, the name, the phone and the conversation summary into a single line. It is the message Dorit opens on a phone to decide whether to call somebody back now, which is precisely what it prevented. Same defect as A-14, fixed for enquiries and left here because this function had no HTML path at all. | Four titled blocks in the site's palette, phone as a `tel:` link, urgent reasons framed in red, and a plain statement when nothing was stored. Text still travels alongside. `INT-ESC-020..028`, plus a contract test pinning the now-triplicated palette helpers byte-identical. |
| A-38 | **An address cannot be added to the Base44 mail path by adding it to a list.** `Core.SendEmail` delivers only to registered *app users*, and registration is not something that can be arranged from outside: `User.create` returns an id and the row does not exist, and a dashboard collaborator invite grants Builder access without creating an app user. Two attempts to register `amielnoy@outlook.com` looked successful and changed nothing. | `sendMail()` routes by transport capability rather than by role: `CORE_EMAILS` holds the one address the platform can actually reach, and everyone else — the agency, the second operations mailbox, the visitor — goes through the mailer. Contract tests pin the list identical across the three functions and fail if the agency ever lands on the Core path. |
| A-39 | **Four merges have been resolved by keeping both sides.** Each produced something that either does not parse or parses as the wrong thing: two `"instructions"` keys in the agent prompt (JSON keeps the last, so the file visibly contained a scheduling step the parser never saw — it would have published the wrong agent); two `const AGENT_ONLY` declarations, which stopped a whole contract file loading; two `sendMail` bodies with a doc comment's opening `/**` stripped, failing esbuild and taking 121 integration cases down at once; and an unbalanced brace in a test file. | Each resolved by hand to the newer side after checking the older contributed nothing. The pattern is a conflict inside a long comment or a helper, resolved by concatenation — worth disabling whatever resolves them automatically, since a green-looking merge here has twice produced code that would have shipped. |
| A-40 | **Every route served byte-identical HTML to a crawler that does not run JavaScript**, all of it declaring the home page as canonical. Confirmed against live production, not a local build: `/`, `/faq` and `/claims` returned the same MD5. Google renders JavaScript and recovered; GPTBot, ClaudeBot, PerplexityBot and CCBot do not, so to an AI assistant the entire site was one page and `/faq` — 23 questions and answers, the richest content here — did not exist. This was [B-0](#b-0--routes-are-invisible-to-crawlers-that-do-not-run-javascript), the top open SEO item. | `scripts/prerender.mjs` runs the real app in a real browser at build time and writes each public route's rendered DOM to `dist/<route>.html`. Nothing declares what a route's title should be — it renders and asks — so there is no second copy to drift. `e2e/seo/prerender.spec.ts` asserts on the **served HTML** with `request`, never `page`: nothing there may pass because a browser repaired it afterwards. |
| A-41 | **The prerender step was wired into the build that CI does not run.** `playwright.config.ts` builds before serving, so the local suite passed; CI's e2e shards run `SKIP_BUILD=1` against the `dist` artifact the `build` job uploads, and that job was still running plain `npm run build`. The first CI run failed on seven of eight routes — the suite was right and the artifact was a step behind. Separately, `vercel.json` called `build:prerender` on a build image with no browser, so Vercel would have hit the graceful skip and shipped the client-rendered bundle without saying anything worth noticing. | The `build` job installs Chromium and runs `build:prerender`; `vercel.json` installs it in its `buildCommand`. The graceful skip stays for hosts that genuinely cannot prerender, but `PRERENDER_REQUIRED=1` in the `build` job turns it into an error in the job that could have installed the browser, instead of nine opaque failures three jobs later. The Base44-builder guard step deliberately stays on plain `npm run build`. |
| A-42 | **Every chat on the site answered every visitor with a generic error, for ten days.** `POST /api/apps/<id>/agents/conversations` returned `401 User must be authenticated to create a conversation`, because `allow_anonymous_access` was `false` on all three agents. Nobody set it: the field did not exist in `base44/agents/*.jsonc` until `7bce20c` "Update base44 packages", a `base44-builder[bot]` regeneration that wrote the server default into all three at once. `AgentChat.tsx` reports every failure as one line — “לא הצלחתי לשלוח את ההודעה כרגע” — which is also what a network blip says, so a total outage was indistinguishable from a bad moment. Found by reproducing the call against live production. | `allow_anonymous_access: true` in all three agents, pinned by “is reachable by a signed-out visitor” in `agents.contract.test.ts` so the next regeneration fails CI instead of the site. |
| A-43 | **Every prerendered page shipped a `<script>` for a file that does not exist on the production host.** `<Analytics />` from `@vercel/analytics` appends `/_vercel/insights/script.js` on mount, and `scripts/prerender.mjs` captures the live DOM — so the runtime-injected tag was serialised into all eight route files. Nothing under `/_vercel/` is a build artifact; the path is synthesised by Vercel's edge, and production is Base44, where it falls through to the SPA shell and the browser refuses to execute an HTML document as a script. Found by `API-HTP` “every same-origin file referenced by index.html actually exists”. | `dropVercelBeacon` in `scripts/prerender.mjs`, alongside `restoreAsyncFont`, which undoes the same class of capture artefact. The client bundle still injects the tag at runtime, so nothing is lost on Vercel. |
| A-44 | **The chat's failure handling made a bad moment and a dead backend look identical, and lost the visitor's words either way.** Three defects in one path, found reviewing A-42. `Base44AgentService.send` incremented the turn counter *before* the awaits, so a failed send spent a turn: during the outage, a visitor who retried enough times was told “השיחה הגיעה לאורכה המרבי” — a second, differently wrong diagnosis, and the one message that stops someone trying again. `AgentChat.send` cleared the input before the await and never restored it, and the visitor's own message reaches the transcript only by way of the server echoing it, so on failure it was nowhere at all. And the handoff notice was rendered only inside the pre-consent branch while `say()`-ing itself into `messages`, which every server push replaces wholesale — so post-consent, the common case, the promise that “a person who asked for a person gets one even when the backend is down” did not hold. | Counter moved past the awaits; `setInput(text)` in the catch; the notice rendered once, from panel state, outside both branches, and no longer duplicated into the transcript. Covered by `UNIT-AGT-001..004`, `E2E-AGT-009..010` and two structural cases in `agents.contract.test.ts`. |
| A-45 | **The adapter showed the visitor whatever the runtime sent, including what it had marked hidden.** `ports.ts` declared `role: "user" | "assistant"` and `content: string`; the SDK declares `role: "user" | "assistant" | "system"`, `content?: string | Record<string, any>` and `hidden?: boolean`, and `subscribe` passed `data.messages` through unfiltered. So a `system` message rendered in an assistant bubble as though the agent had said it; an object `content` reached `<ReactMarkdown>` as a React child, which throws, and with no error boundary anywhere in `src/` that is a white page; and a message the platform marked hidden was displayed — on a chat whose tool payloads carry a visitor's name, phone and life circumstances. | `visibleMessages` in `Base44AgentService`, and the client interface narrowed to what the SDK actually promises, including the `undefined` from `getConversation` that used to be handed straight to `addMessage`. Covered by `UNIT-AGT-004..009`. |
| A-46 | **Boilerplate `.jsx` pages silently replaced the real TypeScript ones, and blocked the publish that would have revived the chats.** `0255b1b` (`base44-builder[bot]`, “chore: add boilerplate auth templates”) added five `.jsx` pages. Four imported `@/api/base44Client` directly and failed the dependency-inversion contract, which turned `main` red — and the Base44 publish job is gated on green, so it was skipped and production carried on serving the release with the dead chats (A-42). The deeper half is what the red *hid*: Vite resolves `.jsx` before `.tsx`, so `src/pages/Login.jsx` became the login page while `src/pages/Login.tsx` — TypeScript, routed through `@/services` — stopped being imported by anything and kept looking authoritative. The same shadowing turned out to be true of `AuthLayout` and `GoogleIcon`, whose pre-TypeScript `.jsx` copies were never deleted when `0e943ca` added the `.tsx`: both TS versions had been dead code ever since, and nothing had ever said so. The three unrouted pages also brought self-serve registration and password reset to a system whose `AuthPort` states the opposite — “accounts into a system holding customer enquiries are provisioned, not self-served”. | All seven `.jsx` files deleted; `Login.tsx` is the login page again. The `ALLOWED_DIRECT_SDK` carve-out removed rather than emptied — it still named `Login.tsx`, which no longer imports the SDK, and three `.tsx` files that never existed, so it was a standing permission for anyone who created those paths. New case “no .jsx shadows a .tsx of the same name”, which is what found `AuthLayout` and `GoogleIcon`. |
| A-47 | **Meetings booked from the consultation form landed in Dorit's own calendar three hours late.** Two backend functions held the same event-building code — `createConsultationEvent` posting to Google, `createOutlookEvent` posting to Graph — and the lead adapter invoked both side by side. `2747c6b` (“fix(interview): let the agreed meeting time reach the calendar”) fixed the timezone handling in one of them: `wallClock` keeps the agreed hour as a wall-clock string, because `new Date(x).toISOString()` pins a `Z` on it and the offset then overrides the `timeZone` field, so a 10:00 request is filed at 13:00. The Outlook copy never got that fix — it still ran `new Date(scheduledAt).toISOString()` — and Outlook is the calendar Dorit actually keeps, `govari-fin.co.il` being Microsoft 365. Both events were created, both looked right in their own diary, and the two disagreed by three hours with nothing saying so. Found while making the function support Outlook. | The two functions collapsed into one: `createConsultationEvent` builds the event once and writes it to every calendar in `CALENDAR_PROVIDERS` (`outlook,google` by default), through a provider table holding the four things that differ — connector, endpoint, timezone-name dialect, and link field. `createOutlookEvent` deleted, the adapter reduced to one call, and `consultation-function.contract.test.ts` now fails if a second calendar call reappears beside the first. The writer then moved: `submitLead` books every configured calendar itself, in the request that saved the lead, and `createConsultationEvent` came off the interview agent's tools and prompt. It had been booking the meeting a second time — invisible while the two functions wrote to different calendars, and a visible duplicate in Dorit's own diary the moment both learned Outlook. It also put a guarantee in a prompt, which this repo settles the other way: the consent gate and the handoff button live in the shell precisely because a prompt is advisory, and a meeting that exists only if the model remembers a second tool call is that mistake with a diary instead of a checkbox. |
| A-48 | **A failed send said which copy was lost and never why.** `dorit-mailer` answers a refusal with the upstream reason in its body — `{ok:false, failed:["http_403"]}`, Resend's own status — and all three mailing functions threw on the HTTP status before reading it. So an interview whose summary never reached דורית reported `secondary_email_failed (mailer_http_502)`: enough to know the copy was lost, nothing about the cause. דורית is not a registered Base44 user, so her copy has no second transport, while the team's copies fall back to `core` and arrive — every visible indicator said the mail worked. A 200 carrying a partial refusal was reported as a clean send for the same reason. | `upstreamReasons` in all three functions, reading the body before judging the status and appending the reason: `mailer_http_502:http_403`. A closed vocabulary — `http_<status>`, `no_message_id`, `network_error` — so the rule the old comment protected still holds: no provider prose, no credentials. A partial refusal now logs `mail.partial`. Covered by two integration cases, one of which puts an API key in the reason string and asserts it never reaches a warning. |
| A-49 | **The probe written to detect the outage reported it for a day after it was fixed.** `API-LIV-005..007` POST to `/agents/conversations` as a signed-out visitor, and the first version sent no headers at all. Base44 identifies a signed-out person by `x-base44-anonymous-id` — the SDK sends it on every browser call — and without it the backend sees no visitor and answers **401 with the same status and the same message** as a genuinely closed agent. So the probe could not tell “a visitor was refused” from “nobody asked”, and once A-42 was actually fixed it went on failing, holding the Base44 publish behind a red smoke job and sending the investigation after an app visibility setting, an unpressed Publish button and a draft-versus-production theory, none of which were wrong in ways that mattered. Settled by driving production in a signed-out browser: the chat opened a conversation, exchanged messages and showed no error, while `curl` on the same endpoint returned 401. | The probe sends `x-base44-anonymous-id` and `x-app-id`, as the SDK does. The flag it exists to guard is checked independently of the header, so A-42 would still be caught. The lesson is in the comment beside it: a detector whose failure is indistinguishable from the fault it detects is worse than none, because it outlives the fix. |
| A-50 | **The Builder put the boilerplate `.jsx` pages back, and red CI was the only thing that noticed.** `c2da51d` (`base44-builder[bot]`, “chore: add boilerplate auth templates”) re-created all seven files deleted in A-46 — the third harmful push from that bot in one day, after `8ebe464` and `0255b1b`. Lint failed on the raw hex in `GoogleIcon.jsx`, banned since `6d3ffc4`, and the “no .jsx shadows a .tsx” case failed on three pairs. Both guards worked; what they cannot do is stop it recurring, and between the push and the CI run `src/pages/Login.jsx` is once again the login page. | Files deleted again, and the class neutralised: `vite.config.js` now pins `resolve.extensions` with `.ts`/`.tsx` ahead of `.js`/`.jsx`, so a collision resolves to the TypeScript file rather than the boilerplate. The duplicate still fails CI so it gets cleaned up — it just no longer swaps a page while nobody is looking. Pinned by “resolves TypeScript ahead of JavaScript”. |
| A-51 | **The Builder puts the boilerplate back after every deletion.** `59c63bd`, same bot and same commit message as `c2da51d` (A-50) and `0255b1b` (A-46) — the fourth harmful push from it in a day. Both guards fired again: the hex ban on `GoogleIcon.jsx`, which lacks the documented `eslint-disable` its `.tsx` twin carries for Google's brand palette, and “no .jsx shadows a .tsx” on three pairs. The site itself was unaffected this time — `resolve.extensions` from A-50 meant the TypeScript pages still loaded — so the cost was a red `main` and a blocked publish rather than a swapped login page. | Deleted again. Nothing in this repository can stop the bot re-creating them, and each recurrence is the same seven paths, so the remaining fix is not here: Base44 re-scaffolds auth templates into a project that already has them in TypeScript, and that is a question for their support. Until it is answered this entry is the record that the cleanup is routine and expected, not a fresh problem to diagnose each time. **It is a loop, not a recurrence.** Four commits on 2026-09-29 — `0255b1b` 08:04, `c2da51d` 10:33, `59c63bd` 13:34, `16140d3` 14:08 — and the last three are byte-identical, verified by hashing the blob ids of the files each one adds. `16140d3` landed immediately after the PR that deleted them, which is what turns this from “it happens again” into “deleting is what causes it”: delete → GitHub sync → the Builder finds no `.jsx` auth pages → re-scaffolds. Reported to Base44 support with the commit list; the app is `public_without_login`, and their first suggestion is that switching visibility sends a chat message that adds these pages, which would fit if that message re-fires on every sync. |
| A-52 | **We were deleting files the platform owns.** Base44 support, 2026-09-30: “Base44 apps use login, register, forgot-password and reset-password pages built as .jsx files, and that is the supported authentication path. When the platform starts your app's environment and doesn't find those files, it adds them back automatically… there is no setting to stop the platform from restoring the standard files… your lint checks will need to ignore them.” So A-46, A-50 and A-51 were all the same mistake on our side: treating a platform-managed file as repository litter. Five deletions, five restorations, and the fifth left `main` red for two days with the publish gated behind it. | Stopped deleting them. `eslint.config.js` ignores the seven paths and `frontend-payloads.contract.test.ts` exempts them from the direct-SDK rule and from the shadow rule, through one list, `PLATFORM_AUTH_PAGES`, with a case that fails when the two copies drift. In exchange the suite now asserts what actually keeps them harmless, which nothing did before: that `resolve.extensions` still puts `.tsx` ahead of `.jsx`, and that a `.tsx` of ours exists behind each one — because if the platform's copy is the only file at that name, it is not a shadow, it is the page. |
| A-53 | **The only environment that records agent activity was the one not being archived.** A function called over HTTP logs to `prod`; a function called by an agent logs to `preview`. So every interview, every `submitLead` the model triggers and every calendar write behind a completed conversation exists only in the draft's logs — and the nightly archive ran `LOG_ENV=prod` only. It cost two investigations in one day. A visitor reported a failed interview on Android; production logs showed nothing, and the conclusion drawn was that the function had never been called and the failure lay between the agent and the tool. That conclusion was unsound: the run was in `preview` the whole time. By the time anyone looked there it had aged out — Base44 keeps roughly a day of draft logs — so the cause is now unknowable. | A second archive step with `LOG_ENV: preview` and `LOG_DIR: logs/preview`, `continue-on-error` like its sibling, riding the same upload. Two contract cases pin it. The lesson is the one worth keeping: when logs show nothing, confirm you are reading the environment the work ran in before concluding the work did not happen. |
| A-54 | **The one person the meeting is for was not in it.** `CALENDAR_ATTENDEES` invited the two operations mailboxes and not Dorit, on a stated premise: she had authorised the `outlook` connector, so the event was created in her calendar and she was the organiser — inviting the organiser is meaningless. The premise was never checked and was false. The invitation Graph sent for the 2026-10-02 09:02 interview came **from `amielnoy@outlook.com`**, which is the account that actually authorised the connector, so the event was created in *his* diary. Dorit was neither organiser nor attendee, in either calendar: for eleven days the site booked meetings that appeared in nobody's diary but the operations team's, while every log said `calendar.created` twice and `warnings: 0`. Nothing could have caught it — the function asserts the write succeeded, never whose calendar it landed in. | `dorit@govari-fin.co.il` added to `CALENDAR_ATTENDEES` in both calendar writers, so Graph sends her an invitation regardless of who owns the connector. The contract case that required `CALENDAR_ATTENDEES` to equal `NOTIFY_EMAILS` forbade exactly this fix, so it now states what it was always protecting: every attendee receives the enquiry by mail, through `NOTIFY_EMAILS` or `SECONDARY_EMAIL`, and nobody who receives it is missing from the diary. The lesson: a comment asserting who owns an external account is a claim about a system outside the repository, and no test in the repository can keep it true. |
| A-55 | **The route to a human reached her with no way to reach back.** "מעבר לדורית" called `escalate` on the press, with a reason, a transcript and empty strings for name, phone and email — the panel holds none of those at that moment, because they live in the conversation with the agent, if they were given at all. On 2026-10-02 a visitor on Android pressed it three times mid-interview and Dorit received three notifications reading `שם: לא נמסר · טלפון: לא נמסר`. Someone wanted to speak to her and she could do nothing about it, three times over; `handingOff` reset in `finally`, so each press bought another empty mail. | The button opens a two-field form — name and phone — and escalates only once a number is present; `handoffSent` makes a second press a no-op. A visitor who will not leave a number still gets the direct channels through "רק הפרטים של דורית", which notifies nobody: the promise was always that a person who asks for a person gets one, and that is kept by showing the number, not by raising an alert she cannot act on. |
| A-56 | **The submission succeeded and the visitor was told it had failed.** Everything after `Lead.create` is best-effort, and all of it ran in a queue: two calendars, the sheet, the summary document, then three mails, each awaiting the one before. None of them wait on each other; the sum is simply the latency the visitor experiences. It grew — 7,765 ms on 02-10, **9,989 ms on 04-10** — and at that point the agent, which does not wait that long for a tool result, told the visitor on his phone `לא הצלחתי לשמור ולשלוח את המידע כרגע` and handed him Dorit's number. The log for that same request reads `request.end … warnings: 0`: lead saved, both diaries written, sheet appended, document created, all three mails sent. The only thing that failed was the only thing anyone could see. The reorder in #79, which moved Dorit's mail behind the sheet and document so it could carry their links, lengthened this path — correct in itself, and it pushed a queue that was already too long past the edge. | The sheet and the document start before the calendar instead of behind it, both diaries are written with one `Promise.all`, and the three operations copies go out together; each mailbox keeps its own `try`, so one bounce still cannot take the others. The one ordering kept is the one that earns it — Dorit's mail waits for the links it carries. A contract case pins the shape, because the next person to add an `await` here will not be able to see what it costs. |
| A-57 | **The phone was running last week's app, and no publish could reach it.** Production serves `index.html` with **no `Cache-Control`, no `ETag` and no `Last-Modified`** — nothing a browser can revalidate against — while every hashed bundle beside it carries `max-age=604800` and old hashes stay served. A device that opened the site once keeps that HTML, the HTML names last week's bundle, and the bundle is still there. Nothing about it looks broken. It surfaced as "interviews from a desktop mail Dorit, interviews from Android do not": the phone was on a build whose closing step called `createConsultationEvent`, which books a calendar entry and **sends no mail**. `prod` logs show that call rejected for missing contact fields at 17:31 and 18:00 with no `submitLead` anywhere near it, while the desktop runs logged `submitLead … warnings: 0`. Nothing in the current source can call `createConsultationEvent` at all — `requestConsultationEvent` has had no caller since `274347c`, which is what proved the client was old. | `public/_headers` and a `vercel.json` rule ask for `no-cache` on every document while the hashed assets stay immutable — the actual fix, if Base44's hosting honours it. Because it may not, `src/lib/freshness.ts` compares the module script this document loaded against the one the server names now, on load and on every return to the foreground, and leaves via a URL the cache has never seen; `reload()` would be answered by the same stale entry. A device already holding stale HTML is running code that predates the check and needs one manual reload — code cannot rescue a client that never downloads it. |
| A-58 | **The interview announced a failure it had never attempted.** An interview on a phone ended with `לא הצלחתי לשמור את המידע כעת במערכת. זה לא עליך — זו בעיה טכנית מצידי`, and `submitLead` **had not been called at all** — no `request.start` in either environment, so nothing was saved and nobody was mailed. Run in a private window, which rules out the stale client of A-57; an anonymous HTTP probe reaches `submitLead` normally and gets its own 400, which rules out permissions. Two instructions produced it together: the failure branch said *if submitLead failed, say you could not save and hand off*, without asking whether the call had been made; and the cap read *call submitLead at most twice in a conversation*, which mid-conversation reads like a budget that may already be spent. A long interview — 2–3 minutes on a phone, many short turns — is where a model takes that reading. The desktop runs succeeded because they were shorter, not because they were on a desktop. | The failure branch now fires **only on an error actually returned**, and says in so many words that claiming a failure without a failed call is a false report that leaves the enquiry lost. The cap says the final save is never optional and that there is no quota to exhaust, however long the conversation ran. Three contract cases pin both. Note this is a prompt change: `npx base44 agents push --yes` is a separate release step that CI does not perform — see A-42. |
| A-59 | **An agent does not execute its tools in an anonymous conversation — and every visitor is anonymous.** Proven by a controlled experiment: the same scripted interview, one minute apart, same deployed build. Signed in, `submitLead` fires twice (`stage=partial` 21:32:31, `stage=complete` 21:32:55) and the calendar, sheet, document and all three mails land with `warnings: 0`. Anonymous, driven over HTTPS with `x-base44-anonymous-id`, **no tool call is ever made** — no `request.start` in either environment, no entity row — and the agent closes by telling the visitor `לצערי לא הצלחתי לשמור את הפרטים במערכת כעת`. The anonymous run used no browser at all, so device, cache, connection lifetime and instructions are all excluded; the same function called **directly** by an anonymous caller answers normally, so it is the agent's invocation and nothing else. Of 40 leads, not one came from a visitor rather than from us while signed in. It cost three days and five wrong diagnoses — latency (A-56), a stale bundle (A-57), the prompt (A-58), the device, the WhatsApp webview — because the only instrument available shows what did *not* happen. The right move was available on day one and not taken: run the same interview twice, change one thing. | The page submits the close instead of the agent. The agent ends with a fenced ```lead``` block, `AgentChat` strips it from the transcript, validates it and calls `submitLead` through `submitInterview` — the same backend function, the same validation, reached by the caller that is permitted to reach it, exactly as the quick-contact form has always done. A malformed or rejected payload shows the visitor Dorit's direct channels rather than failing silently. **This is a workaround for a platform defect and is meant to be removed**; the support report is in the session scratchpad. |
| A-60 | **The one link that had to dial did not.** react-markdown 9 empties any `href` outside its own allow-list — http, https, mailto and a few more — without saying so. The handoff notice is markdown and offers three ways to reach Dorit: the WhatsApp link is https and the mail link is mailto, so both survived, and the phone number rendered as a link with `href=""`. On a phone, dialling is the entire promise of that control — *a person who asks for a person gets one* — and it silently was not kept. Found by a component test asserting the href rather than the text, which is the only reason it was ever visible. | `urlTransform` that passes `tel:` through and defers everything else to the library's own transform. A security case pins that the allow-list is widened by exactly one scheme: the text being rendered is model output, so this is a surface, and widening it widens what a reply can talk a visitor into opening. |
| A-61 | **The agent socket was answered with the website.** On Vercel, `/ws-user-apps/*` — how the chat receives its transcript — fell through to the SPA catch-all, so socket.io asked for an engine.io handshake and was handed `<!doctype html>` with a `200`. The subscription could never connect, and the chat reported that it could not send. The HTTP half was fine throughout: conversation creation and `addMessage` both succeed through the `/api/*` rewrite, which is what made it look like a backend problem. | A rewrite for `/ws-user-apps/:path*` to Base44, ordered before the catch-all. A contract case pins both the destination and the ordering, since a rule after the catch-all never matches and would look correct in review. |
| A-62 | **`main` went red on all four e2e projects after the contact channels became rows.** #98 replaced three markdown links with `ContactChannels`, whose rows are named by their title *and* label — the WhatsApp row reads "וואטסאפ הודעה מיידית". `E2E-AGT-005` and `E2E-AGT-010` still asked for a link named exactly `"וואטסאפ"` and found none. The phone assertion survived only because it already matched by pattern. | Both locate the row by `/^וואטסאפ/` (#101). Anchored, so the section's "עדיף לי בוואטסאפ" alternative still cannot satisfy it — the reason `exact` was there. |
| A-63 | **Every time a function wrote for a person was three hours early.** The Base44 functions run in UTC, and `toLocaleString("he-IL")` takes its format from the locale and its zone from the runtime: an interview summary sent at 08:57 in Tel Aviv was stamped `6.10.2026, 5:57:36`. Five calls — the `submitLead` text and mail headers, both `escalateToHuman` "התקבל:" lines, the `submitClaim` header. The Sheets column had been fixed alone, earlier. | All five name `timeZone: 'Asia/Jerusalem'` (#102). `function-clock.contract.test.ts` scans every `base44/functions/*/entry.ts` and fails on a date formatted without it (`CTR-CLK-001/002`). |
| A-64 | **Nobody could find the support chat — Dorit included.** It sits at the bottom of `/faq`, and the only links to `/faq` were two in the footer. Writing the test for a way in found a second defect: the hash scroll in `ScrollToTop` fired once after 50 ms, and `/faq` is lazy, so on Chromium and Android the section did not exist yet and the visitor was left at the top of the page. | "שאלות ותשובות" back in the header (bar and drawer); a support button in the desktop dock and the phone's sticky bar, through `SupportLink`, which also scrolls on a repeat press; `ScrollToTop` retries until the target mounts, up to 3 s (#104). `E2E-SUP-001..003`, `CMP-BAR-002`, `CMP-FLA-003`. |
| A-65 | **None of the five repo articles had ever reached the site.** `seed-blog.mjs` wanted a Base44 admin email and password nobody kept, so the blog recommender, asked about management fees, found nothing while `horadat-dmei-nihul.md` covered exactly that. Reading the script also found a re-run would write `published: false` over every matched post — correcting an article would have taken down one Dorit had published. | Base44 is written through `base44 exec --privileged --data-env prod`, as the CLI's signed-in owner; each post is mirrored to Supabase `blog_posts` on `base44_id`; updates never touch `published` (#103). `UNIT-SEED-001..007`. All five seeded and published 2026-10-06; both stores verified to agree. |
| A-66 | **The site described a company that does not exist.** The footer carried `ח.פ. 51XXXXXX`, a placeholder, on every page; the power of attorney left `ח.פ [ מספר חברה ]` and `כתובת [ כתובת מלאה ]` for a client to sign under; and the name read "סוכנות ביטוח בע״מ" in 25 places. Dorit is an individual agent: there is no company number, and "בע״מ" was a false statement about who the visitor deals with. | Placeholders removed (#105, #108). The name is "דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח" everywhere — footer, legal pages, JSON-LD, `llms.txt`, `LICENCE.entity`, every article's disclosure, all four agents, the mails, the POA — and visitor-facing "הסוכנות" names her instead (#106). `CONSENT_VERSION` → `2026-10-agents-v4`, because every notice interpolates the name. Published articles re-seeded. |
| A-67 | **Every interview the page closed, and every handoff that reached Dorit, told the visitor it had failed.** `@base44/sdk` builds its functions client with `interceptResponses: false`, so `functions.invoke` resolves to the whole axios response; the adapters cast that to a receipt and read `.ok` and `.contact` off the wrapper, where they never are. A 07:14 interview on 2026-10-06 updated the lead, mailed Dorit, wrote both calendars, the sheet and the doc with `warnings: 0` — and showed "לא הצלחתי לשמור את הפרטים". Every fake in the suite returned a bare body, which is why nothing noticed. The same family as A-56 and A-58: success and the apology coexisting. | `invokeFunction()` in `src/services/base44/invoke.ts` returns the body and passes a bare one through; the lead, claim and support adapters use it (#107). `UNIT-RCP-001..004` feed the adapters the shape the SDK really returns. |
| A-68 | **The Allure report carried 38 "Global Errors" on runs where nothing had failed**, every one reading `skip modifier failed: Error: Test is skipped: mobile projects only`. Four describe blocks opened with `test.skip(({ isMobile }) => …)`; Playwright runs that as a hook, and allure-playwright 3.11 turns any hook step carrying an error into a global error without telling a skip from a failure. Noise in that tab hides the day it holds something real. | The blocks are tagged `@mobile-only` / `@desktop-only` and each project drops the other kind's with `grepInvert`, so nothing is skipped by a hook (#111). Before: 19 globals files on web-chromium alone; after: none. `e2e-selection.contract.test.ts` fails on a callback skip in any spec and on a project that loses its filter. |
| A-69 | **`revoke … from public` does not close a function on Supabase.** Supabase's default privileges grant EXECUTE to `anon` and `authenticated` by name, so the personal area's first migration left `enquiries_for` — the function that reads anyone's enquiries by email — callable by any signed-in user. Found before release, by running `supabase/tests/account_check.sql` against a real local Supabase: "authenticated called enquiries_for". | The migration revokes `from public, anon, authenticated` on all three functions (#113), and `personal-area.contract.test.ts` fails in CI if either name is dropped — proved by deleting it and watching CTR-ACC-002 fail. Verified on production after `db push`: anonymous calls are refused with `42501`. |
| A-70 | **The personal area's justification was false, and briefly written into the privacy policy.** The design matched enquiries to users by email on the grounds that "the confirmation mail already sent these details" — but for an interview that mail carries only the main topic (and the POA link), never the summary, answers or meeting time, and a partial interview gets no mail. Found by the whole-branch review before merge. | The operator kept the feature and re-accepted the real risk: a typo that lands on another person's real, verified address exposes the enquiry to that person. The privacy policy, COMPLIANCE.md §6, README and spec now say so (#113); the wording awaits Dorit's and her compliance adviser's approval. |
| A-71 | **The Base44 account adapter dropped the `rid` on every error, and its test used an error shape the SDK never produces.** Functions reject with a raw AxiosError — the body is at `response.data` — not a `Base44Error` with `.data`, so `err.data.rid` was always undefined and the page's error line had no reference number. The same family as A-67: a fake shaped like the code's assumption. | `failureOf()` in `src/services/base44/invoke.ts` reads status and body from either shape; the tests reject with the real AxiosError shape (#113). |
| A-72 | **The marketing copy contradicted the disclosure.** The disclosure says Dorit holds an agent licence, is tied to institutional bodies and does *marketing*, not objective advice — while the page said "גישה בלתי-תלויה… לא משייכות מסחרית", "אני לא סוכנת", "אני לא מוכרת פוליסות" and sold "ייעוץ פיננסי וביטוחי אישי". The success cases promised "100% הגנה", showed unlabelled projections ("פי 2 בתחזית", "₪420K בהערכה"), per-case five stars and an unsourced "5.0 · שביעות רצון מלאה". The title, description and share image also differed between the tab, Google, og/twitter, JSON-LD and `llms.txt`. | Copy reworded to state the tie and "שיווק פנסיוני ולא ייעוץ פנסיוני אובייקטיבי"; "ייעוץ" removed as a name for the service from the share text, WhatsApp prefill, calendar invite, `/claims` and the privacy policy's purposes; the success cases lost the 100% claim, the ratings and the stars, and gained "הערכה המבוססת על הנחות…" and "תוצאות עבר אינן מבטיחות…"; one title and description everywhere, and Dorit's photograph as `og:image` (#110). Two e2e assertions that tracked the old text were updated. **Still open:** Dorit's approval of the wording; the visitor confirmation emails keep the old slogan "התכנון שלי — הרווח שלך" (`submitLead`, `submitClaim`); `COMPLIANCE.md` §7. |
| A-73 | **An admin's status change and delete never reached Supabase.** `/admin/leads` wrote to the Base44 `Lead` entity from the browser, and Supabase received a lead only once, at creation. So every status in `public.leads` stayed "new", and a lead Dorit deleted — including on a visitor's own privacy deletion request — stayed in `public.leads`. The personal area reads Supabase through `enquiries_for`, so a visitor kept seeing an enquiry that had been deleted. A production dry run found 4 such rows. | New function `adminLead` (admin role required) takes `status` and `delete`, writes the Supabase copy first and Base44 second, and answers `502` with a `rid` if Supabase refuses, leaving Base44 untouched so the admin's retry completes it. `Base44LeadAdminService` calls it through `invokeFunction`. `scripts/reconcile-leads.mjs` (dry run by default) lists the rows already out of step; `INT-ADL-001..030`, `UNIT-ADM-004/005/010/011`, `UNIT-REC-001..008`. |
| A-74 | **The fonts came from Google, so every visitor's IP address went to Google and CI tested a different face from the one visitors saw.** `index.html` and `public/poa.html` loaded Cormorant Garamond, Frank Ruhl Libre, Lora, Noto Serif Hebrew and Heebo from Google Fonts — a request the privacy policy does not mention. The e2e fixture blocked Google Fonts to stay hermetic, so Linux WebKit in CI rendered the Hebrew in a wide fallback: the sticky-bar check at 1.3x (E2E-MOB-009b), which passes in the real font, failed on main's ios-safari shard and skipped the Base44 publish. | Self-hosted: `scripts/self-host-fonts.mjs` copies the Hebrew and Latin woff2 subsets from the @fontsource packages into `public/fonts` with their OFL licences, and writes `src/fonts.css` and `public/fonts/poa.css`. The two Hebrew body/heading faces are preloaded. `fonts.contract.test.ts` (CTR-FNT) forbids any Google Fonts reference in what ships and checks every face, preload and licence; SEO-MOB-007 checks the served HTML; E2E-MOB-009b runs at 1.3x again. |
| A-75 | **The testimonials' add and delete controls showed for any signed-in visitor.** `Testimonials.tsx` gated them on `isAuthenticated`, written when only Dorit signed in. Since the personal area, ordinary visitors sign in too, and saw "הוספת המלצה" and a delete button on every quote. The writes were refused server-side (admin-only), but the controls were Dorit's to see. | Gated on `user.role === "admin"`, like the header's admin links. An admin still sees the empty section so the first testimonial can be added; anyone else sees no section when there are none. CMP-TST-003..005. |
| A-76 | **Every Vercel deploy talked to a placeholder app.** The CI workflow sets `VITE_BASE44_APP_ID=e2e-sanity-app` globally so the e2e bundle never reaches the real app, and the "Build for Vercel" step inherited it — a process variable outranks what `vercel pull` writes. The Vercel bundle therefore posted every form, sign-in and agent call to `/api/apps/e2e-sanity-app/...` and got 404 "App not found"; the quick contact form showed "לא הצלחנו לשלוח את ההודעה". The Base44-hosted site was unaffected, and the production smoke test only checks that host, so CI stayed green. Found from a screenshot of the failing form. | The step unsets the variable before `vercel build`, so the project's own value (pulled) is used, and refuses to deploy if `.vercel/output` still contains `e2e-sanity-app`. Two deploy-gate contract cases pin both. Must be live before the custom domain points at Vercel. |

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

### B-0 · ~~Routes are invisible to crawlers that do not run JavaScript~~ — closed

**Fixed — see A-40.** Kept here because the reasoning is the reasoning behind
the build step, and because the two host questions below were the thing that
had to be answered before it could be built.

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

**Done.** Both host questions were answered by measurement rather than
assumption:

- **The file layout.** `dist/<route>/index.html` is served only at `/faq/`, with
  the trailing slash — `/faq` falls through to the SPA fallback. Eight
  prerendered files that nothing would ever request. `dist/<route>.html` answers
  `/faq`, `/faq/` and `/faq.html` alike, so that is what the script writes.
- **The SPA fallback.** `vercel.json` now rewrites unmatched paths to
  `/app.html`, an untouched copy of the shell, rather than to the prerendered
  home page — otherwise a crawler fetching `/blog/some-post` would be served the
  home page's *content* under that URL.

Base44 hosting is untouched by this: it runs `npm run build`, which does not
prerender, and it does not read `vercel.json`. The step is opt-in per host by
build command, and a host without a Chromium binary ships the plain SPA with a
warning rather than failing the deploy.

### B-1 · Colour contrast below WCAG AA

Half of this is fixed; the description of the other half was wrong.

**The accent was never the problem.** This entry used to blame the brand accent
`#7D6B5D` at ~4.4:1. That hex is a stale comment in `src/index.css` and does not
match its own token: `--accent: 26 14% 39%` renders `#716256`, which measures
**5.5:1** on the parchment and clears AA. It has never appeared in an axe
failure. The comment is the thing that is wrong, not the colour.

**The bronze ramp was the problem, and is fixed** (2026-09-22). Every monetary
figure on the site was set in a bronze drawn for fills — `--highlight-muted` at
**2.07:1**, `--highlight-strong` at **2.73:1**, the Claims step numerals at
~1.6:1. A fourth rung, `--highlight-ink` (`27 38% 30%`, 7.5:1), now carries
bronze used as type. Measured before and after with `E2E_ENFORCE_CONTRAST=1`:
**14 bronze nodes → 0**.

**What is still open: the greys.** 51 nodes across the seven swept pages, every
one an opacity composite of `--foreground` or `--muted-foreground`
(`text-foreground/50`, `text-muted-foreground/60` and friends) rather than a
token in its own right:

| ratio | colour | on | size |
| --- | --- | --- | --- |
| 1.60 | `#c8c2bc` | `#f7f4f0` | 9 px |
| 2.19 | `#ada69f` | `#f7f4f0` | 14 px / 20 px |
| 2.45 | `#a8a19a` | `#fcfaf8` | 10 px |
| 2.89 | `#99928a` | `#faf8f4` | 12 px |
| 3.27–3.98 | five more greys | mixed | 12–18 px |

Because each is `<token>/<alpha>` at a call site rather than a palette entry,
there is no single value to darken — the fix is either raising the alphas or
giving these a named token of their own, which is still a palette decision. So
the suite **reports** contrast on every run and enforces it only on request:

```bash
E2E_ENFORCE_CONTRAST=1 npx playwright test e2e/a11y
```

Flip the `CONTRAST_RULE` handling in `e2e/a11y/axe.spec.ts` to unconditional
once the palette is settled.

### B-2 · ~~Per-route metadata is applied by JavaScript, not served in the HTML~~ — closed

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

**Closed by A-40**, via option 1. The runtime layer stays and still governs
blog posts and any route added without a prerender entry; the eight static
routes now ship their own head in the HTML itself, so a link to `/faq` pasted
into a chat app previews as `/faq`.

### B-3 · ~~`npm run typecheck` has 93 inherited errors, now held on a ratchet~~ — closed

All 93 were one boundary problem: typed pages importing untyped shadcn
primitives (`button`, `input`, `label`, `input-otp`, `image`, the accordion),
plus the `React.ComponentType<{ size?: number }>` icon typing that lucide's
`forwardRef` components do not satisfy. Each consumed primitive now has a
sibling `.d.ts` (see `src/components/ui/README-types.md`), icon fields are
typed `LucideIcon`, and `AuthLayout`/`GoogleIcon` are `.tsx`. Two of the
"inherited, not bugs" errors — `ClaimForm.tsx|TS2304` — were in fact calls to
setters that did not exist (a failed upload threw a `ReferenceError`); fixed
and covered by `tests/component/sanity.test.tsx`.

`npm run typecheck` is the blocking step; `scripts/typecheck-gate.mjs` and
`tests/typecheck-baseline.json` are deleted. `npm run typecheck:gate` remains
as an alias so older notes and scripts keep working.

### B-4 · ~~Structured-data email disagrees with the rest of the site~~ — closed

`index.html`'s JSON-LD, `src/config/contact.ts`, the footer and the escalation
fallback all publish `dorit@govari-fin.co.il` and `+972508311776`. The last
holdout was `public/llms.txt`, which still carried the old pair; see A-34.

`tests/contract/ai-surface.contract.test.ts` now derives the expected values
from `src/config/agencyProfile.ts` (the source `contact.ts` re-exports from)
and fails on any address or number in `llms.txt` that is not the canonical
one, which is the assertion this entry asked for.

### B-5 · Transport security headers are not asserted by default

The SPA cannot set CSP, HSTS, `X-Content-Type-Options` or `Referrer-Policy` —
those come from the Base44/CDN edge, and the local `vite preview` sets none of
them. `SEC-HDR-002` reports which are missing on every run; `SEC-HDR-001`
enforces them only against a real deployment:

```bash
E2E_ENFORCE_SECURITY_HEADERS=1 PLAYWRIGHT_BASE_URL=https://<site> npx playwright test e2e/security
```

### B-9 · Display labels are set at 11px on mobile

Fourteen eyebrow labels and stat captions (`INSURANCE ARCHITECT`, `שנות ניסיון`,
`LIFE & VITALITY` …) render at 11px uppercase with heavy letter-spacing. Google's
mobile-usability report flags "text too small to read" around 12px, and 11px
uppercase Hebrew with 0.35em tracking is genuinely hard to read on a phone.

Sentence-length body copy is enforced at ≥12px (`SEO-MOB-004`); the labels are
reported rather than enforced (`SEO-MOB-005`), because moving the type scale is a
design decision in the same class as the contrast finding in B-1, not an SEO fix.
Raising them to 12px would close it.

### B-7 · ~~`src/lib/utils.js` touches `window` at module scope~~ — closed

`isIframe` is now `typeof window !== "undefined" && window.self !== window.top`,
so the module loads in node; `tests/unit/utils.node.test.ts` imports it and
calls `cn()` without jsdom. `tests/unit/utils.dom.test.ts` is left as it was.

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

### B-10 · The Resend sending domain has no DNS records, so no mail can leave

`dorit-mailer` sends through Resend from an address on `mail.govari-fin.co.il`.
That subdomain does not exist. Checked 2026-09-27 against the public resolvers:

| Record | Expected | Found |
|---|---|---|
| `mail.govari-fin.co.il` (any) | the sending subdomain | **NXDOMAIN** |
| `send.mail.govari-fin.co.il` MX | `feedback-smtp.<region>.amazonses.com` | none |
| `send.mail.govari-fin.co.il` TXT | `v=spf1 include:amazonses.com ~all` | none |
| `resend._domainkey.mail.govari-fin.co.il` TXT | the DKIM public key | none |
| `_dmarc.govari-fin.co.il` TXT | a DMARC policy | none |

The apex is configured and unrelated: `govari-fin.co.il` is Microsoft 365
(`MX → govarifin-co-il01e.mail.protection.outlook.com`, SPF
`include:spf.protection.outlook.com -all`). That `-all` is why the sender
cannot simply be moved to the apex — it instructs receivers to reject anything
Microsoft did not send, which includes everything Resend would.

Until the subdomain is created and Resend marks it verified, every send is
refused at the API with an unverified-domain error. The functions treat that as
a delivery warning and keep the enquiry, so **nothing is lost and nothing
arrives** — the same shape as A-35, one provider along, and the reason B-6's
second option is not yet closed.

Closing it is a DNS action on `govari-fin.co.il` (nameservers `ns1-3.dtnt.info`),
not a code change: add the sending domain in Resend, publish the MX, SPF and
DKIM records it prints, and wait for verification. A DMARC record on the apex
is worth adding in the same pass — there is none today, on a domain that sends
invoices and client mail through Microsoft 365.

## C. Deliberate deviations in the suite

| Deviation | Reason |
|---|---|
| `A11Y-STR-005` skipped on WebKit | Safari only tabs to links when the OS "Press Tab to highlight each item" preference is on — a browser preference, not an app defect |
| Live-backend API cases skipped unless `E2E_LIVE_API_URL` is set | So CI can never write to production data |
| Third-party requests (GA, Google Fonts, `media.base44.com`) intercepted | Hermetic, offline-capable, deterministic runs |
| `framer-motion` stubbed in component tests | jsdom has no layout engine; the animation library is not the system under test |
| e2e runs against `vite preview`, not `vite dev` | The production bundle is what ships; this also proves the build boots |

### B-11 · Nothing rate-limits the agent endpoints, and the pointer to the discussion goes nowhere

`Base44AgentService` caps message length and turns per conversation, and its own
comment concedes these are "not a substitute for server-side rate limiting — see
docs". There are no such docs: `rate limit`, `rate-limit` and `rateLimit` have
no hits anywhere in the repo outside that comment, so the trade-off has never
been recorded, let alone accepted. That is what makes this a finding rather than
a documented decision.

The caps are also weaker than they read. `private turns = new Map()` is
module-instance memory in one browser tab: a reload resets it, and a request
made outside the browser never sees it at all.

What this does **not** change is reachability. `submitLead` and
`createConsultationEvent` were already invoked anonymously from the browser by
`Base44LeadService` and `QuickContact`, `Lead`'s RLS already allows `create`,
and `API-LIV-004` asserts the consultation function answers anonymous callers by
design. Re-opening the agents (A-42) added no endpoint that `curl` could not
already reach; the agent is a slower, more expensive path to the same writes.

What *is* newly live is anonymous model inference on a public endpoint, and the
6-hour interview dedup is keyed on the phone number, so varying it defeats the
one limit that exists. The exposure worth pricing is `createConsultationEvent`,
which writes to a real person's calendar.

Closing it: a `RateLimit` row keyed on a hashed IP and hour, checked in
`submitLead` and `createConsultationEvent` — roughly twenty lines per function,
hand-duplicated per the convention in `AGENTS.md` and pinned by
`agents.contract.test.ts` like every other duplicated helper. If only one gets a
limit, it is the calendar one. Until then this entry is the record that the
exposure is known.
