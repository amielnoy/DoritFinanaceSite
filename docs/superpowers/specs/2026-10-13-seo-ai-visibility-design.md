# SEO and AI visibility for govari-fin.co.il — design

**Status:** draft for review (2026-10-13)
**Source:** the user's six-PR brief, corrected against the code (survey of 2026-10-13, below).
**Goal:** articles and pages that Google, Bing and AI assistants (ChatGPT, Claude, Perplexity, Gemini) can read in full without running JavaScript, on one host — `https://govari-fin.co.il` — with the structured data, sitemaps and machine-readable summaries that make Dorit citable, plus the off-site steps only a person can take.

## Decisions taken with the user

- **Rebuild on publish:** the `publish-blog` workflow triggers a production deploy as its last step; a nightly production deploy picks up edits made from the admin screen. No new secrets.
- **Old host:** flip the default in code — every source file names `https://govari-fin.co.il`, so every build (Base44's included) carries the new canonical. No 301 is possible from Base44.

## Corrections to the brief (what the code says)

| Brief | Code, 2026-10-13 |
|---|---|
| 16 articles in `content/blog` | 20 files, all `published: false` in the files; **22 articles are live** in Supabase `blog_posts` (the 20 plus two older ones). The live set is decided in Base44 and mirrored to Supabase, not by the files. |
| `api/og/blog.ts` ignores `published` | It refuses drafts since #157. It still reads **Base44** and fills only the `<head>`. |
| Classify AI referrals as channel `ai` | An `ai_assistant` channel already exists (chatgpt.com, chat.openai.com, claude.ai, perplexity.ai, gemini.google.com). We extend its hosts; a new `ai` value would need a DB CHECK migration and four copies changed for no gain. |
| The build replaces the base44 host | Only `index.html`, `sitemap.xml`, `robots.txt`, `llms.txt` — and only when `VITE_SITE_URL` is set, which Base44's build never sets. Sources default to the old host. |
| Content-admin path sets the slug | Blog writes go **Base44-first** through the Base44 function `contentAdmin`, which mirrors to Supabase by `base44_id`. Base44's `BlogPost` has no slug; the slug lives only in the Supabase mirror. |
| Trigger a Vercel deploy hook | There are no deploy hooks; Vercel's own Git deploys are off; production deploys only from CI (`push` to `main`, or `workflow_dispatch` with `deploy: true`). |
| Pre-build articles reusing `renderSeoHtml` | `prerender.mjs` already renders through the real app in Playwright, so adding article routes gives full HTML with the app's own SEO (`blogSeo.ts`) — no second renderer. |
| "How to find forgotten money" draft | Duplicates the live `kesef-shenishkach`. Replaced by **"קרן השתלמות: מתי היא נזילה ומה עושים איתה"** (overridable at review). |

## Global constraints

- Follow AGENTS.md: contract tests for every cross-file rule; "duplicated is fine, drifted is not" for Base44 copies; Edge code imports `_shared/`; platform auth pages stay; lead writes Supabase-first (blog writes stay Base44-first — not changed here).
- One PR per section, in order; `npm run lint`, `npm run typecheck`, `npm run test:vitest` green after each; `tests/test-plan/` updated with each test change.
- No deploys by hand, no `seed:blog --apply`, no production data writes. Migrations are applied to production by hand only on the user's explicit request after merge.
- The identity line "דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח", the licence L-00107009 and the contact details come from `src/config/agencyProfile.ts` or are contract-checked against it.
- The enforced CSP (#161) stays green: no new inline scripts without their hash; `check-csp-hashes.mjs` runs on every production build.
- New content promises no returns and keeps the pension-marketing disclosure wording.

## PR 1 — Articles as full HTML

**Data.** Migration `blog_posts.slug text`: added nullable, backfilled for all 22 live rows by title → slug (the 20 file names; `bituach-briut-digitali` and `pensia-beidan-ha-ai` for the two older articles), then `not null` and `unique`, with a CHECK `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`. Rows that are drafts with no match get a slug from `base44_id` (`post-<id>`), so the constraint holds for every row.

**Writes.** The admin article form gains a required slug field (Latin kebab-case, validated client-side with the same pattern, prefilled for existing articles). `FunctionContentAdminService` sends it; `contentAdmin` (Base44) passes `slug` into the Supabase mirror upsert only. `seed-blog.mjs` sets `slug` from the file name. `slug` joins `ARTICLE_COLUMNS` and the `Article` port.

**Reads and URLs.** `/blog/:key` resolves a slug first, then a `base44_id`, then a Supabase uuid. Every link builder (ArticleCard, FeaturedRow, Blog.tsx JSON-LD, blogSeo.ts, the blog recommender) emits `/blog/<slug>`. On an old-form URL the app replaces history with the slug URL.

**Old URLs, server side.** `vercel.json` routes `/blog/:id([0-9a-f]{24})` (Base44 ids) to `api/og/blog` for every user agent; it reads Supabase by `base44_id` and answers `301 → /blog/<slug>` for a published article, `404 + noindex` otherwise. The bot-only rewrite stays for slug URLs not yet pre-built, now reading Supabase by slug and filling the `<head>` as today.

**Pre-building.** `prerender.mjs` reads published slugs from Supabase (publishable key; RLS returns only published rows) and adds `/blog/<slug>` to its routes, writing `dist/blog/<slug>.html`. Vercel serves the file before any rewrite. The duplicate-title guard covers articles too. If Supabase is unreachable at build time the build fails in CI (`PRERENDER_REQUIRED=1`), not silently.

**Rebuilds.** `publish-blog.yml` ends with `gh workflow run ci.yml --ref main -f deploy=true` (`permissions: actions: write`; GitHub's token may dispatch). `ci.yml` gains a nightly schedule whose run deploys production. README documents both.

**Tests.** Migration check (backfill complete, constraint, unique); unit: key resolution, link builders, slug validation; contract: every link builder uses `slug`, vercel.json routes 24-hex ids to the function, publish workflow dispatches a deploy; og handler: 301 / 404 / head fallback from Supabase; e2e: a pre-built article served without JS contains its body text, canonical and JSON-LD.

## PR 2 — Sitemap, llms.txt, robots, IndexNow

A post-prerender build step `scripts/build-seo-files.mjs` writes into `dist/`:
- `sitemap.xml`: the 8 static routes (no `lastmod` — no honest value exists) and every article (`lastmod` = `updated_at`); `/blog` gets the newest article's date.
- `llms.txt`: today's header, contact, disclosure and limitations **verbatim** from `public/llms.txt` (kept as the template), an "מאמרים" section (title, URL, the article's `excerpt` as the one-sentence summary), and the crawler note rewritten to say articles are served as full HTML.
- `llms-full.txt`: the FAQ text and every published article's body as plain text, each under its title and URL.
- `robots.txt`: `Sitemap: https://govari-fin.co.il/sitemap.xml`; the `llms-full.txt` mention.
- IndexNow key file `public/<key>.txt` (not a secret). A post-deploy CI step submits to `api.indexnow.org` the articles whose `updated_at` is within 48 h plus every static route on a deploy that changed its page source; failure logs `::warning::` and never fails the deploy.
- `index.html` emits `<meta name="google-site-verification">` and `<meta name="msvalidate.01">` from `VITE_GOOGLE_SITE_VERIFICATION` / `VITE_BING_SITE_VERIFICATION` only when set (via the site-url plugin's HTML transform, not inline script — CSP-neutral).

**Tests.** Unit for the generator (sitemap shape, lastmod, verbatim llms header, articles section, llms-full); contract: llms.txt still passes every existing ai-surface check, IndexNow step cannot fail the deploy, meta tags absent when unset.

## PR 3 — Structured data and on-page signals

- Home JSON-LD (`index.html`) becomes one `@graph`: `FinancialService`+`InsuranceAgency` (`@id …/#agency`) → `founder`/`employee` `Person` (`@id …/#dorit`, `jobTitle`, `hasCredential` L-00107009 issued by `GovernmentOrganization` רשות שוק ההון, `knowsAbout` the five service pillars) → `WebSite` (`publisher` → `#agency`). `sameAs` from a new `SAME_AS` list in `agencyProfile.ts`, empty now; a contract test keeps index.html's `sameAs`, phone, email and licence equal to `agencyProfile`.
- Articles: visible byline (Dorit, linking to `/#about`), "עודכן לאחרונה: <date>" from `updated_at`, and an author box with the licence. `blogSeo.ts` BlogPosting gains `author` → `#dorit` (with credential), `publisher` → `#agency`, `dateModified`, `inLanguage: he-IL`; BreadcrumbList stays.
- Contract over every pre-built HTML file: exactly one `<h1>`, unique `<title>` and description, every `<img>` has non-empty Hebrew `alt` (or `alt=""` with `aria-hidden` for decoration), no `noindex` on any public route.
- `ai_assistant` hosts gain `copilot.microsoft.com`, `www.bing.com/chat` referrals (`bing.com` path `/chat`), `you.com`, `meta.ai`, `chat.deepseek.com`, `grok.com`, `poe.com` — in `src/lib/attribution.ts` and kept identical where the contract requires; GA4 allow-list unchanged.

## PR 4 — Old host

- `DEFAULT_SITE_URL` (site-url plugin) and `SITE_URL`'s fallback (`seo.ts`) become `https://govari-fin.co.il`; `index.html`, `public/sitemap.xml`, `public/robots.txt`, `public/llms.txt` name it. `safe-arch-plan.base44.app` stays only where it is a backend address (`/api`, `/ws-user-apps` rewrites, `VITE_BASE44_SERVER_URL`, CSP `connect-src`/`img-src`).
- The canonical-host contracts are inverted: no public file or page metadata may name the Base44 host; the backend references must.
- README: why there is no 301, and that the Base44 copy now canonicalises to the new host on its next publish.

## PR 5 — Five Hebrew drafts

`content/blog/<slug>.md`, `published: false`, the existing front matter (`title`, `excerpt`, `tags`, `action_time`, `published`), existing tone: `tofes-161-prisha`, `kibua-zchuyot`, `keren-hishtalmut-nezila`, `dooch-shnati-pensia`, `shivuk-mul-yeutz-pensioni`. Each opens with a 2–3 sentence direct answer, cites official sources (רשות המסים, משרד האוצר / רשות שוק ההון, gov.il) with links, marks every number with its year, promises nothing, keeps the llms.txt disclosure wording, and marks uncertain facts `TODO(דורית): לאשר`. A contract test keeps drafts unpublished and checks the disclosure and the year markers. Nothing is seeded.

## PR 6 — Off-site launch kit

`docs/seo/launch-checklist.md`: Search Console and Bing (verify — the DNS TXT for Google is already live — submit the sitemap, request indexing for key URLs, import into Bing); Google Business Profile (categories, a 750-character Hebrew description, services, a Hebrew WhatsApp review request); one NAP block for d.co.il, b144, Zap and the planners' association, and a check of her entry in the Capital Market Authority register; a Hebrew expert-source pitch for Funder, Bizportal, Calcalist, Ynet; a monthly AI-visibility check (10 Hebrew questions × 4 assistants, with a results table).

## Done means

- `npm run build:prerender` writes a full HTML file for every published article; `curl` without JS shows the body text, the canonical on `https://govari-fin.co.il/blog/<slug>` and the JSON-LD (shown for two articles in PR 1's description).
- `sitemap.xml`, `llms.txt`, `llms-full.txt` list all 22 published articles on the new host.
- All suites green; README, AGENTS.md and `tests/test-plan/` updated where a rule or file changed.
- A closing summary of what needs the user: the slug migration applied to production, the two verification values, Google Business Profile, directories, approving and publishing the drafts.

## Risks

- **Build-time dependency on Supabase**: a Supabase outage fails the production build (by design, with a clear message) instead of shipping pages without articles.
- **Slug rename breaks links**: the admin allows editing a slug; old slug URLs then 404. Mitigation deferred (no redirect table) — the form warns when a published article's slug changes.
- **Enforced CSP**: new pages add no inline scripts; the deploy check catches any that do.
