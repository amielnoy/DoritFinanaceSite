# SEO PR 1 — Articles as full HTML — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every published article is served as a prebuilt HTML page at `https://govari-fin.co.il/blog/<slug>`, with old `/blog/<Base44 id>` links redirected to it, so crawlers that run no JavaScript read the whole article.

**Architecture:** A `slug` column on Supabase `blog_posts` (backfilled for the 22 live articles) becomes the article's address. One helper, `articlePath()`, builds every article link, and `getArticle(key)` resolves a slug, then a Base44 id, then a uuid. `scripts/prerender.mjs` lists the published slugs from Supabase and prebuilds `dist/blog/<slug>.html`. `api/og/blog.ts` (now reading Supabase) answers old Base44-id URLs with a 301 for every user agent. The publish workflow and a nightly CI run rebuild production so the pages stay current.

**Tech Stack:** PostgreSQL / Supabase migrations and `psql` checks, TypeScript + React 18 + React Router + TanStack Query (Vite 8), PostgREST over `fetch`, a Base44 function (Deno, untyped JS in `.ts`), Node 22 `.mjs` build scripts, Playwright (prerender and e2e), Vitest, GitHub Actions, Vercel `vercel.json` rewrites and a Node function.

**Spec:** docs/superpowers/specs/2026-10-13-seo-ai-visibility-design.md (PR 1)

## Global Constraints

- Follow AGENTS.md. Every cross-file rule gets a contract test. For Base44 copies, "duplicated is fine, drifted is not". Platform auth pages stay. Blog writes stay **Base44-first** (not changed here).
- One PR for this section. `npm run lint`, `npm run typecheck` and `npm run test:vitest` must be green, and `tests/test-plan/` is updated with each test change.
- No deploys by hand, no `seed:blog --apply`, no production data writes. **Migrations are applied to production by hand only on the user's explicit request.** This one is applied **before** the PR is merged (Task 11). It is additive, and its fallback trigger keeps today's writers working: `contentAdmin`, `seed-blog.mjs` and `publish-blog.mjs` never send a slug.
- Partial updates to `blog_posts` are a PATCH by `base44_id`, never an upsert. An update should touch only what changed and fail loudly when the row is missing; an upsert silently creates a row that was never meant to exist.
- The identity line "דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח", the licence L-00107009 and the contact details come from `src/config/agencyProfile.ts` or are contract-checked against it. PR 1 adds none of them.
- The enforced CSP (#161) stays green: no new inline scripts. `scripts/check-csp-hashes.mjs` runs on every production build and walks `dist` recursively, so `dist/blog/*.html` is covered. JSON-LD is data, not script.
- New content promises no returns and keeps the pension-marketing disclosure wording. PR 1 adds no content. The e2e fixture article is test data and can never deploy (Task 7).
- Slug rule, exact: `^[a-z0-9]+(-[a-z0-9]+)*$`, and never `^[0-9a-f]{24}$`. A 24-hex address belongs to the old-link redirect.
- The migration file is `supabase/migrations/20261014000000_blog_slug.sql`. It sorts after `20261013010000_no_public_lead_inserts.sql`.
- Two live titles with no file map to fixed slugs: `ביטוח בריאות דיגיטלי: אבחון מרחוק וכיסוי מיידי` → `bituach-briut-digitali`, and `פנסיה בעידן ה-AI: האם הרובוט יודע לתכנן עבורכם טוב יותר?` → `pensia-beidan-ha-ai`.
- Language per file:
  - New app and api code is TypeScript.
  - `scripts/*.mjs` stay plain ESM, which is the established per-file convention.
  - `base44/functions/contentAdmin/entry.ts` stays untyped, which is its convention.
- Files compiled under `api/tsconfig.json` (nodenext) use relative imports with an explicit `.js`. That covers `src/lib/seo.ts`, `src/lib/blogSeo.ts`, `src/lib/articlePath.ts`, `src/services/supabase/SupabaseContentService.ts`, `src/services/supabase/RestTableClient.ts` and `src/services/supabase/SupabaseTableClient.ts`.
- Worktree: `WT=/Users/amielpeled/CommercialProjects/DoritFinanaceSite-seo`. Work on branch `feat/seo-pr1-articles-full-html`, cut from `spec/seo-ai-visibility`.
- In zsh, capture `$?` straight after the command (`cmd; echo "exit=$?"`). `${PIPESTATUS[0]}` is empty here.
- PR 2 will generate `sitemap.xml` and `llms.txt` from `fetchPublishedArticles()` (Task 7). PR 3 adds author and byline fields to `blogSeo.ts`. Keep both seams as written here.

## Review Focus

1. **Production rows the backfill must survive.** The input: one title held by two rows (a published copy and a stale draft), plus a live row whose title no longer matches any file.
   - Only one row per title gets the file's slug: published first, then the older row.
   - Every other row gets `post-<sanitised base44 id>`, or `post-<uuid>` when it has no Base44 id.
   - The UNIQUE and CHECK constraints hold, and a published fallback is named in a NOTICE.
   - Pinned in `supabase/tests/blog_slug_check.sql` (Task 2).
2. **Writes the new constraints can refuse.**
   - A publish toggle sends `{ published }` only. The mirror must PATCH by `base44_id` with just that field, never upsert, so an update touches only what changed. A PATCH that matches no row is a 500, not a success.
   - A write that sends no slug at all (today's production `contentAdmin`, `seed-blog.mjs`) still inserts: the migration's BEFORE INSERT trigger fills `post-<id>`. That includes an upsert's insert, and an existing row keeps its slug. Pinned in `supabase/tests/blog_slug_check.sql` (Task 2).
   - A slug another article already has is refused with 409 **before** Base44 is written, so no orphan row is created.
   - Pinned in `tests/integration/content-admin.integration.test.ts`, INT-CNT-004/006 and INT-CNT-002/007 (Task 5).
   - `scripts/publish-blog.mjs` gets the same PATCH treatment, pinned by UNIT-PUB-001..003 (Task 8).
3. **Hostile or odd URL keys.** `getArticle(key)` builds a PostgREST `or=(…)` filter.
   - A key that is not slug-shaped (`a,b`, `x)`, `slug.eq.y`, `Has-Capitals`, `../etc`, the empty string) is "not found" (status 404) and sends no request.
   - The `id.eq.` clause is added only for a uuid-shaped key, because PostgREST errors with 22P02 on a non-uuid.
   - Pinned in `tests/unit/supabase-content.test.ts`, UNIT-ART-003/007 (Task 3), and in the og handler, UNIT-OG-011 (Task 9).
4. **Old links carrying a query string** (`/blog/<b44 id>?utm_source=whatsapp#x`).
   - The server 301 keeps every query parameter except the rewrite's own `id`.
   - The client's history replace keeps `search` and `hash`.
   - A draft's slug never leaks through a `Location` header.
   - Pinned by UNIT-OG-005/007 (Task 9) and CMP-POST-001 (Task 4).
5. **The build's article source is misconfigured.**
   - A fixture set in a Vercel build, or in a bundle that reads Supabase, is refused, so test articles never ship.
   - Supabase unreachable or unconfigured with `PRERENDER_REQUIRED=1` fails the build.
   - Without that flag, the build warns and prebuilds the static routes only.
   - A slug that could escape `dist/blog/` (`../escape`) is refused.
   - Pinned in `tests/unit/published-articles.test.ts`, UNIT-PUBART-006..009 and -011..019 (Task 7), and the workflow contract CTR-REB-003/004 (Task 10).

---

## File Structure

| File | Create / Modify | Responsibility |
|---|---|---|
| `src/lib/articlePath.ts` | Create | The slug rule, the key shapes, and `articlePath(post)`, the one builder of article links |
| `src/services/ports.ts` | Modify | `Article.slug?` and `ArticleDraft.slug?` |
| `supabase/migrations/20261014000000_blog_slug.sql` | Create | Adds `slug`, a fallback-slug function and BEFORE INSERT trigger, backfills the 22 live articles, then NOT NULL + UNIQUE + two CHECKs |
| `supabase/tests/blog_slug_check.sql` | Create | Re-applies the migration on production-shaped rows and asserts the backfill and the constraints |
| `supabase/tests/rls_check.sql`, `supabase/tests/agency_isolation_check.sql` | Modify | Their seed inserts carry a slug (now NOT NULL) |
| `src/services/supabase/SupabaseTableClient.ts` | Modify | `SupabaseQuery.or()` |
| `src/services/supabase/RestTableClient.ts` | Modify | `or()` over plain fetch; `.js` import |
| `src/services/supabase/SupabaseContentService.ts` | Modify | `slug` in `ARTICLE_COLUMNS`; key resolution slug → base44_id → uuid; 404-shaped not-found; `.js` imports |
| `src/lib/blogSeo.ts`, `src/components/dorit/blog/ArticleCard.tsx`, `src/components/dorit/blog/FeaturedRow.tsx`, `src/pages/Blog.tsx` | Modify | Link through `articlePath()` |
| `src/App.jsx`, `src/pages/BlogPost.tsx`, `src/hooks/useContent.ts` | Modify | `/blog/:key`; replace an old-form address with the slug |
| `base44/functions/contentAdmin/entry.ts` | Modify | Validate the slug, refuse a taken one, write it to the mirror only, PATCH on update |
| `src/pages/BlogAdmin.tsx` | Modify | Required slug field, validation, rename warning |
| `scripts/published-articles.mjs` | Create | Published-article list from Supabase (reused by PR 2), the build's article plan, fixture answers, duplicate titles |
| `scripts/prerender.mjs` | Modify | Prebuild `/blog/<slug>`; fixture mode; duplicate-title guard names the duplicates |
| `e2e/fixtures/prerender-articles.json` | Create | The one hermetic article the e2e build prebuilds |
| `playwright.config.ts`, `scripts/run-tests.sh` | Modify | Point the e2e build at the fixture |
| `e2e/seo/prerender.spec.ts` | Modify | A prebuilt article carries its body, canonical and BlogPosting without JS |
| `scripts/seed-blog.mjs`, `scripts/publish-blog.mjs`, `scripts/backfill-from-base44.mjs` | Modify | Slug from file name; PATCH to publish; fallback slug on import |
| `api/og/blog.ts` | Modify | Read Supabase; 301 old keys to the slug; head for not-yet-built slugs; 404 otherwise |
| `vercel.json` | Modify | `/blog/:id([0-9a-f]{24})` → the function, for every UA, before the bot rule |
| `.github/workflows/ci.yml` | Modify | Nightly run deploys Supabase functions + Vercel production; `PRERENDER_REQUIRED` on production; fixture in the test build; `/blog` check |
| `.github/workflows/publish-blog.yml` | Modify | Ends by dispatching a production deploy |
| `tests/unit/article-path.test.ts`, `tests/unit/published-articles.test.ts`, `tests/component/blog-post-redirect.test.tsx`, `tests/component/blog-admin-slug.test.tsx`, `tests/contract/article-slug.contract.test.ts` | Create | New tests |
| `tests/unit/supabase-content.test.ts`, `tests/unit/rest-table-client.test.ts`, `tests/helpers/supabase-table-fake.ts`, `tests/unit/blogSeo.test.ts`, `tests/component/blog-page.test.tsx`, `tests/integration/content-admin.integration.test.ts`, `tests/contract/frontend-payloads.contract.test.ts`, `tests/unit/seed-blog.test.ts`, `tests/unit/publish-blog.test.ts`, `tests/unit/base44-repair-scripts.test.ts`, `tests/unit/og-blog-handler.test.ts`, `tests/contract/vercel-functions.contract.test.ts`, `tests/contract/workflow.contract.test.ts` | Modify | Updated and new cases |
| `README.md`, `AGENTS.md`, `tests/test-plan/01,02,03,11,12-*.md` | Modify | Docs and STDs, each in the task that changes the behaviour |

---

### Task 1: The article-address module

**Files:**
- Create: `src/lib/articlePath.ts`
- Modify: `src/services/ports.ts` (`interface Article` ~L91-102, `interface ArticleDraft` ~L248-255)
- Test: `tests/unit/article-path.test.ts`
- Modify: `tests/test-plan/01-std-unit.md` (§2 table, new §4.21, §5 total)

**Interfaces:**
- Consumes: `Article` from `src/services/ports.ts`.
- Produces:
  - `SLUG_PATTERN: RegExp`, `BASE44_ID_PATTERN: RegExp`, `UUID_PATTERN: RegExp`
  - `SLUG_PROBLEMS: { missing: string; format: string; base44Id: string }`, `SLUG_TAKEN: string`
  - `slugProblem(slug: string): string | null`
  - `isValidSlug(slug: unknown): slug is string`
  - `articlePath(post: Pick<Article, "id" | "slug">): string`
  - `Article.slug?: string`, `ArticleDraft.slug?: string`

- [ ] **Step 0: Branch and install**

```bash
cd /Users/amielpeled/CommercialProjects/DoritFinanaceSite-seo && git switch -c feat/seo-pr1-articles-full-html && npm ci; echo "exit=$?"
```
Expected: `exit=0`.

- [ ] **Step 1: Write the failing test** — `tests/unit/article-path.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  BASE44_ID_PATTERN,
  SLUG_PATTERN,
  SLUG_PROBLEMS,
  UUID_PATTERN,
  articlePath,
  isValidSlug,
  slugProblem,
} from "@/lib/articlePath";

/**
 * An article's address. Every link to an article is built by `articlePath`,
 * so these cases are what every card, the blog's JSON-LD, the post's
 * canonical and the server's redirect inherit.
 */
describe("articlePath", () => {
  it("is /blog/<slug> when the article has one", () => {
    expect(articlePath({ id: "64f0a1b2c3d4e5f6a7b8c9d0", slug: "horadat-dmei-nihul" })).toBe(
      "/blog/horadat-dmei-nihul",
    );
  });

  it("falls back to the id where the store has no slug (Base44)", () => {
    expect(articlePath({ id: "64f0a1b2c3d4e5f6a7b8c9d0" })).toBe("/blog/64f0a1b2c3d4e5f6a7b8c9d0");
    expect(articlePath({ id: "post-1", slug: "" })).toBe("/blog/post-1");
  });
});

describe("slugProblem", () => {
  it.each(["horadat-dmei-nihul", "tofes-101", "a", "2026", "pensia-beidan-ha-ai"])("accepts %j", (slug) => {
    expect(slugProblem(slug)).toBeNull();
    expect(isValidSlug(slug)).toBe(true);
  });

  it("asks for a slug when there is none", () => {
    expect(slugProblem("")).toBe(SLUG_PROBLEMS.missing);
  });

  it.each(["Horadat", "dmei nihul", "-a", "a-", "a--b", "דמי-ניהול", "a_b", "a/b", "../x", "a.b"])(
    "refuses %j as not Latin kebab-case",
    (slug) => {
      expect(slugProblem(slug)).toBe(SLUG_PROBLEMS.format);
      expect(isValidSlug(slug)).toBe(false);
    },
  );

  it("refuses a slug shaped like a Base44 id — vercel.json sends those to the old-link redirect", () => {
    expect(slugProblem("64f0a1b2c3d4e5f6a7b8c9d0")).toBe(SLUG_PROBLEMS.base44Id);
    // One character either way is an ordinary slug.
    expect(slugProblem("64f0a1b2c3d4e5f6a7b8c9d")).toBeNull();
    expect(slugProblem("64f0a1b2c3d4e5f6a7b8c9d0e")).toBeNull();
  });

  it("is false for anything that is not a string", () => {
    expect(isValidSlug(undefined)).toBe(false);
    expect(isValidSlug(42)).toBe(false);
  });
});

describe("the key shapes", () => {
  it("tells a Base44 id, a uuid and a slug apart", () => {
    expect(BASE44_ID_PATTERN.test("64f0a1b2c3d4e5f6a7b8c9d0")).toBe(true);
    expect(UUID_PATTERN.test("6f1c0e3a-0000-4000-8000-000000000001")).toBe(true);
    expect(UUID_PATTERN.test("horadat-dmei-nihul")).toBe(false);
    // All three are slug-shaped, which is what lets one filter ask for any of them.
    for (const key of ["64f0a1b2c3d4e5f6a7b8c9d0", "6f1c0e3a-0000-4000-8000-000000000001", "horadat-dmei-nihul"]) {
      expect(SLUG_PATTERN.test(key)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd $WT && npx vitest run tests/unit/article-path.test.ts; echo "exit=$?"`
Expected: FAIL. The output reads `Failed to resolve import "@/lib/articlePath"` and ends with `exit=1`.

- [ ] **Step 3: Write `src/lib/articlePath.ts`**

```ts
// Where an article lives, and what may name it.
//
// Every link to an article is built by `articlePath`: the blog's cards and
// featured row, the blog's JSON-LD, the post's own canonical (blogSeo.ts), the
// admin form's preview and the server's redirect for old links
// (api/og/blog.ts). One builder, so no two of them can disagree about an
// article's address. tests/contract/article-slug.contract.test.ts fails on an
// article link built by hand anywhere in src/ or api/.
//
// Compiled under api/tsconfig.json (nodenext) as well as the app's, through
// blogSeo.ts and api/og/blog.ts, so relative imports carry `.js`.
//
// The slug rule is spelled in four places that cannot import one another:
// here, the CHECK in supabase/migrations/20261014000000_blog_slug.sql,
// base44/functions/contentAdmin/entry.ts and scripts/published-articles.mjs.
// The same contract test fails when they drift.

import type { Article } from "../services/ports.js";

/** Latin kebab-case: lowercase letters and digits, one hyphen between words. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A Base44 record id. `/blog/<one of these>` is an address from before slugs. */
export const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/;

/** A Supabase row id. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What the admin form says about a slug it cannot use. */
export const SLUG_PROBLEMS = {
  missing: "חסרה כתובת למאמר.",
  format:
    "הכתובת יכולה לכלול רק אותיות לטיניות קטנות (a–z), ספרות ומקף בודד בין מילים — בלי רווחים, בלי עברית ובלי מקף בהתחלה או בסוף.",
  base44Id: "כתובת של 24 תווים מ-0–9 ו-a–f שמורה לקישורים הישנים של האתר. בחרו כתובת אחרת.",
} as const;

/** A slug another article already has. The form checks its own list; contentAdmin answers 409 with the same words. */
export const SLUG_TAKEN = "הכתובת כבר בשימוש במאמר אחר.";

/**
 * Why `slug` cannot be an article's address, or null when it can.
 *
 * A slug shaped like a Base44 id is refused even though it is kebab-case:
 * vercel.json sends every `/blog/<24 hex>` to the redirect for old links, so an
 * article with that address could never be reached.
 */
export function slugProblem(slug: string): string | null {
  if (!slug) return SLUG_PROBLEMS.missing;
  if (!SLUG_PATTERN.test(slug)) return SLUG_PROBLEMS.format;
  if (BASE44_ID_PATTERN.test(slug)) return SLUG_PROBLEMS.base44Id;
  return null;
}

export const isValidSlug = (slug: unknown): slug is string =>
  typeof slug === "string" && slugProblem(slug) === null;

/**
 * The article's address: `/blog/<slug>`.
 *
 * Only the Supabase store holds slugs. A build that reads Base44 instead (no
 * Supabase configured) links by id, which is what every address was before.
 */
export function articlePath(post: Pick<Article, "id" | "slug">): string {
  return `/blog/${post.slug || post.id}`;
}
```

- [ ] **Step 4: Add the port fields** in `src/services/ports.ts`

Replace:
```ts
export interface Article {
  id: string;
  title: string;
```
with:
```ts
export interface Article {
  id: string;
  /**
   * The article's address, `/blog/<slug>`, in Latin kebab-case. Only the
   * Supabase store has one (Base44's BlogPost does not), so a build reading
   * Base44 links by `id`. Build links with `articlePath()`, never by hand.
   */
  slug?: string;
  title: string;
```

Replace:
```ts
export interface ArticleDraft {
  title: string;
```
with:
```ts
export interface ArticleDraft {
  title: string;
  /**
   * Required to create an article. Stored in the Supabase mirror only:
   * `contentAdmin` keeps it out of the Base44 write, whose entity has no such field.
   */
  slug?: string;
```

- [ ] **Step 5: Run the test and the typecheck**

Run: `cd $WT && npx vitest run tests/unit/article-path.test.ts; echo "exit=$?"; npm run typecheck; echo "exit=$?"`
Expected: `21 passed`, `exit=0`, then typecheck `exit=0`.

- [ ] **Step 6: Update the STD** — `tests/test-plan/01-std-unit.md`

In the §2 table, after the row ``| `planSeed`, `mirrorRow`, `readExecResult` | `scripts/seed-blog.mjs` |`` add:
```
| `articlePath`, `slugProblem`, `isValidSlug` | `src/lib/articlePath.ts` |
```
Before `## 5. Pass criteria`, add:
```
### 4.21 Article addresses — `tests/unit/article-path.test.ts`

Every link to an article is built by `articlePath`, so these cases are what the
cards, the blog's JSON-LD, the post's canonical and the server redirect inherit.
A slug shaped like a Base44 id is refused because `vercel.json` sends every
`/blog/<24 hex>` to the old-link redirect.

| ID | Title | Expected result |
|---|---|---|
| UNIT-SLUG-001 | "is /blog/<slug> when the article has one" | `/blog/horadat-dmei-nihul` |
| UNIT-SLUG-002 | "falls back to the id where the store has no slug (Base44)" | `/blog/<id>`, also for an empty slug |
| UNIT-SLUG-003 | "accepts %j" (5 slugs) | `null`; `isValidSlug` is true |
| UNIT-SLUG-004 | "asks for a slug when there is none" | `SLUG_PROBLEMS.missing` |
| UNIT-SLUG-005 | "refuses %j as not Latin kebab-case" (10 inputs) | `SLUG_PROBLEMS.format` |
| UNIT-SLUG-006 | "refuses a slug shaped like a Base44 id" | `SLUG_PROBLEMS.base44Id`; 23 or 25 hex characters are ordinary slugs |
| UNIT-SLUG-007 | "is false for anything that is not a string" | `false` |
| UNIT-SLUG-008 | "tells a Base44 id, a uuid and a slug apart" | All three are slug-shaped; only the uuid matches `UUID_PATTERN` |
```
In §5 change `All 341 cases pass.` to `All 362 cases pass.`

- [ ] **Step 7: Commit**

```bash
cd $WT && git add src/lib/articlePath.ts src/services/ports.ts tests/unit/article-path.test.ts tests/test-plan/01-std-unit.md && git commit -m "$(cat <<'EOF'
SEO PR1: articlePath — one builder for article links, one slug rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ
EOF
)"
```

---

### Task 2: `blog_posts.slug` — migration, backfill, checks

**Files:**
- Create: `supabase/migrations/20261014000000_blog_slug.sql`
- Create: `supabase/tests/blog_slug_check.sql`
- Modify: `supabase/tests/rls_check.sql` L25
- Modify: `supabase/tests/agency_isolation_check.sql` L50-54
- Test: `tests/contract/article-slug.contract.test.ts`
- Modify: `tests/test-plan/03-std-contract.md` (new §4.8, §6 total)

**Interfaces:**
- Consumes: `SLUG_PATTERN` and `BASE44_ID_PATTERN` from Task 1. `parseArticle` from `scripts/seed-blog.mjs`.
- Produces:
  - Column `public.blog_posts.slug text not null`.
  - Constraints `blog_posts_slug_key` (unique), `blog_posts_slug_format` (CHECK pattern) and `blog_posts_slug_not_base44_id` (CHECK not 24-hex).
  - `public.blog_posts_fallback_slug(p_base44_id text, p_id uuid) returns text`, immutable. It returns `'post-' || <lowercased base44_id with every non-[a-z0-9] run turned into one hyphen, trimmed>`, or `'post-' || id` when that is empty. The `post-` prefix means it is never a bare 24-hex value.
  - The trigger `blog_posts_fill_slug`, BEFORE INSERT, via `public.blog_posts_fill_slug()` (plpgsql, security invoker, `search_path = ''`). It sets `new.slug` from the fallback only when it is null. Writers that send no slug — today's production `contentAdmin`, `seed-blog.mjs` and `publish-blog.mjs`, plus `backfill-from-base44.mjs` — keep inserting. So the migration can be applied **before** this PR's code is deployed.
  - The migration has no `begin`/`commit` of its own, and every `create` in it is re-runnable (`create or replace`, `drop trigger if exists`). The check re-applies it inside a transaction.

- [ ] **Step 1: Write the failing contract test** — `tests/contract/article-slug.contract.test.ts`

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASE44_ID_PATTERN, SLUG_PATTERN } from "@/lib/articlePath";
// @ts-expect-error — plain .mjs tooling, imported for its front-matter reader.
import { parseArticle } from "../../scripts/seed-blog.mjs";

/**
 * An article's address, as a contract.
 *
 * `blog_posts.slug` is shaped by four things that cannot import one another:
 * the migration's CHECK, the app (`src/lib/articlePath.ts`), the Base44
 * function that writes the mirror (`contentAdmin`) and the build that prebuilds
 * the pages (`scripts/published-articles.mjs`). A copy that drifted would let
 * the form accept a slug the database refuses, or the build write a page the
 * redirect can never reach. Duplicated is fine; drifted is not.
 */

const REPO_ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");
const MIGRATION = "supabase/migrations/20261014000000_blog_slug.sql";

describe("one slug rule, wherever it is spelled", () => {
  it("the migration's CHECKs are articlePath's patterns", () => {
    const sql = read(MIGRATION);
    expect(sql.match(/check \(slug ~ '([^']+)'\)/)?.[1]).toBe(SLUG_PATTERN.source);
    expect(sql.match(/check \(slug !~ '([^']+)'\)/)?.[1]).toBe(BASE44_ID_PATTERN.source);
  });
});

describe("the backfill names the articles that were live", () => {
  const sql = read(MIGRATION);
  // ('<exact title>', '<slug>') — the backfill's VALUES rows.
  const pairs = [...sql.matchAll(/\('((?:[^']|'')+)', '([a-z0-9-]+)'\)/g)].map(
    (m) => [m[1].replace(/''/g, "'"), m[2]] as const,
  );

  it("gives a repo article's slug to that file's exact title", () => {
    // A typo here would not fail the migration: the row would quietly get a
    // `post-<id>` address instead. Checked from the backfill's side, so a draft
    // added under content/blog later (seeded with its own slug) needs no row.
    // A file whose title is edited after this fails here — and would also make
    // seed-blog.mjs create a second post instead of updating the live one.
    const fromFiles = pairs.filter(([, slug]) => existsSync(join(REPO_ROOT, `content/blog/${slug}.md`)));
    expect(fromFiles).toHaveLength(20);
    for (const [title, slug] of fromFiles) {
      expect(parseArticle(read(`content/blog/${slug}.md`)).title, `${slug}.md`).toBe(title);
    }
  });

  it("names the two live articles older than the repo files", () => {
    const bySlug = new Map(pairs.map(([title, slug]) => [slug, title]));
    expect(bySlug.get("bituach-briut-digitali")).toBe("ביטוח בריאות דיגיטלי: אבחון מרחוק וכיסוי מיידי");
    expect(bySlug.get("pensia-beidan-ha-ai")).toBe("פנסיה בעידן ה-AI: האם הרובוט יודע לתכנן עבורכם טוב יותר?");
  });

  it("maps 22 distinct titles to 22 distinct slugs", () => {
    expect(pairs).toHaveLength(22);
    expect(new Set(pairs.map(([title]) => title)).size).toBe(22);
    expect(new Set(pairs.map(([, slug]) => slug)).size).toBe(22);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd $WT && npx vitest run tests/contract/article-slug.contract.test.ts; echo "exit=$?"`
Expected: FAIL with `ENOENT: no such file or directory, open '…/supabase/migrations/20261014000000_blog_slug.sql'`, then `exit=1`.

- [ ] **Step 3: Write the migration** — `supabase/migrations/20261014000000_blog_slug.sql`

Copy the titles byte for byte. They contain `״` (U+05F4) and `—` (U+2014). The contract test compares them with the files.

```sql
-- Articles get a readable address: /blog/<slug> instead of /blog/<Base44 id>.
--
-- The slug lives only here. Base44's BlogPost has no such field, and the
-- admin's writes go Base44-first through the `contentAdmin` function, which
-- passes the slug to this mirror alone (PR 1 of
-- docs/superpowers/specs/2026-10-13-seo-ai-visibility-design.md).
--
-- The backfill names every article that was live when this was written: the
-- 20 under content/blog/ by their file names (the value scripts/seed-blog.mjs
-- writes from now on), and the two older ones by hand. It matches on the exact
-- title, the one field both the files and the rows hold. A title held by two
-- rows gives its slug to one of them, published first and then the older, so
-- the unique constraint below cannot fail on a duplicate.
--
-- Every other row gets `post-<its Base44 id>`, or its own uuid if it never had
-- one: a draft no file names, or a live article whose title was edited since.
-- That way the constraints hold for every row. A published row given such a
-- slug is named in a NOTICE: its address works, but it deserves a real one
-- from /admin/blog.
--
-- A row inserted without a slug gets the same fallback, from a BEFORE INSERT
-- trigger. The code running when this was written never sends a slug:
-- contentAdmin, scripts/seed-blog.mjs and scripts/publish-blog.mjs. With the
-- trigger they keep working once the column is NOT NULL, so this migration can
-- go to production before the code that writes real slugs. The trigger covers
-- an upsert's insert too (EXCLUDED carries the filled value), and a conflict
-- update that does not name `slug` leaves an existing slug alone. The fallback
-- always starts `post-`, so it is never a bare 24-hex value, which would
-- collide with the old-URL route.
--
-- No begin/commit here: supabase/tests/blog_slug_check.sql re-applies this file
-- inside its own transaction, and a commit would end it. For the same reason
-- every object below is created re-runnably.
--
-- The slug rule is spelled in four places that cannot import one another:
-- here, src/lib/articlePath.ts, base44/functions/contentAdmin/entry.ts and
-- scripts/published-articles.mjs. tests/contract/article-slug.contract.test.ts
-- fails when they drift.

alter table public.blog_posts add column slug text;

-- `post-<Base44 id>`, lowercased, every run of other characters one hyphen,
-- trimmed of hyphens at either end; `post-<uuid>` when no Base44 id is left.
-- scripts/backfill-from-base44.mjs spells the same rule in JS (it runs with
-- triggers off).
create or replace function public.blog_posts_fallback_slug(p_base44_id text, p_id uuid)
  returns text
  language sql immutable set search_path = '' as $$
  select 'post-' || coalesce(
    nullif(trim(both '-' from regexp_replace(lower(coalesce(p_base44_id, '')), '[^a-z0-9]+', '-', 'g')), ''),
    p_id::text)
$$;

create or replace function public.blog_posts_fill_slug() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if new.slug is null then
    new.slug := public.blog_posts_fallback_slug(new.base44_id, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists blog_posts_fill_slug on public.blog_posts;
create trigger blog_posts_fill_slug
  before insert on public.blog_posts
  for each row execute function public.blog_posts_fill_slug();

with wanted(title, slug) as (
  values
    ('עזבתם עבודה? שלושה דברים לעשות בחודש הראשון', 'azavtem-avoda'),
    ('ביטוח חיים למשכנתא: כך בודקים אם אפשר לשלם פחות — בלי להחליף בנק', 'bituach-chaim-mashkanta'),
    ('ביטוח נסיעות לחו״ל: שלוש בדיקות לפני שקונים עוד פוליסה', 'bituach-nesiot'),
    ('חיסכון לכל ילד: ההחלטה של שתי דקות שרוב ההורים לא קיבלו', 'chisachon-lechol-yeled'),
    ('המעסיק באמת מפקיד? בדיקה של עשר דקות בין התלוש לקרן', 'hafkadot-maasik'),
    ('הר הביטוח: איך בודקים אם אתם משלמים פעמיים על אותו ביטוח בריאות', 'har-habituach-kfilut'),
    ('לקרוא נכון את גמל נט ופנסיה נט — ומה באמת משפר את התוצאה', 'hashvaa-gemel-net-pensia-net'),
    ('החזר מס לשכירים: שש סיבות שכנראה מגיע לכם כסף — ואיך מבקשים אותו לבד', 'hechzer-mas-lesachirim'),
    ('להוריד דמי ניהול בפנסיה: המהלך הפשוט ביותר, צעד אחר צעד', 'horadat-dmei-nihul'),
    ('כסף שנשכח: איך מאתרים קופות, פוליסות וחשבונות בנק רדומים בעשר דקות', 'kesef-shenishkach'),
    ('מסלול ההשקעה בקרן הפנסיה: בדיקה של רבע שעה, פעם בשנה', 'maslul-hashkaa'),
    ('מי באמת מטפל בכספים הגדולים של חייכם?', 'mi-metapel-bakesafim-hagdolim'),
    ('מוטבים: הטופס של חמש דקות שרוב האנשים לא מילאו', 'mutavim'),
    ('התחתנתם או נולד ילד: רשימת העדכונים הפיננסיים בעמוד אחד', 'nolad-yeled-hitchatantem'),
    ('אובדן כושר עבודה: שלוש שאלות לשאול את קרן הפנסיה שלכם — בשיחת טלפון אחת', 'ovdan-kosher-avoda'),
    ('שגרת הבדיקה השנתית: סדר תפעולי לכל מכשיר פיננסי', 'shigrat-bdika-shnatit'),
    ('עצמאים: מה להפקיד עד 31 בדצמבר כדי לא לוותר על הטבת מס', 'sof-shana-atzmaim'),
    ('תיק המשפחה: ערב אחד שחוסך למשפחה חודשים של חיפושים', 'tik-hamishpacha'),
    ('טופס 101: חמש דקות בתחילת השנה שחוסכות מס עודף כל השנה', 'tofes-101'),
    ('התשואה נטו: ארבעה משתנים שאתם באמת שולטים בהם', 'tsua-neto-arbaa-mishtanim'),
    ('ביטוח בריאות דיגיטלי: אבחון מרחוק וכיסוי מיידי', 'bituach-briut-digitali'),
    ('פנסיה בעידן ה-AI: האם הרובוט יודע לתכנן עבורכם טוב יותר?', 'pensia-beidan-ha-ai')
),
chosen as (
  select distinct on (w.slug) b.id, w.slug
  from wanted w
  join public.blog_posts b on b.title = w.title
  order by w.slug, b.published desc, b.created_at asc
)
update public.blog_posts b
   set slug = chosen.slug
  from chosen
 where b.id = chosen.id;

update public.blog_posts
   set slug = public.blog_posts_fallback_slug(base44_id, id)
 where slug is null;

do $$
declare r record;
begin
  for r in
    select slug, title from public.blog_posts
     where published and slug like 'post-%'
     order by created_at
  loop
    raise notice 'published article given a fallback slug: % (%)', r.slug, r.title;
  end loop;
end $$;

alter table public.blog_posts
  alter column slug set not null,
  add constraint blog_posts_slug_key unique (slug),
  add constraint blog_posts_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  add constraint blog_posts_slug_not_base44_id check (slug !~ '^[0-9a-f]{24}$');
```

- [ ] **Step 4: Run the contract test**

Run: `cd $WT && npx vitest run tests/contract/article-slug.contract.test.ts; echo "exit=$?"`
Expected: `4 passed`, `exit=0`.

- [ ] **Step 5: Write the database check** — `supabase/tests/blog_slug_check.sql`

```sql
-- Proves the slug migration on rows shaped like production's: each live title
-- gets its file's slug; a second row with the same title, a draft no file
-- names and a row with no Base44 id get `post-` slugs; a write that sends no
-- slug (what the code running before this PR does) gets the fallback from the
-- trigger, including through an upsert, and never overwrites an existing slug;
-- and the constraints refuse a malformed, Base44-shaped or duplicate slug.
--
-- Run against a local `supabase start`, after `supabase db reset`, from the
-- repository root:
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/tests/blog_slug_check.sql
-- Every block raises on a wrong answer, so a clean run is the assertion.
\set ON_ERROR_STOP on
begin;

-- Undo the migration inside this transaction, seed rows as production held
-- them before it, and apply the real file again on top of them. The trigger
-- goes first: it names `new.slug`, which the seed inserts below no longer have.
drop trigger blog_posts_fill_slug on public.blog_posts;
alter table public.blog_posts drop column slug;

insert into public.blog_posts (base44_id, title, body, published, created_at) values
  ('aaaaaaaaaaaaaaaaaaaaaaa1', 'להוריד דמי ניהול בפנסיה: המהלך הפשוט ביותר, צעד אחר צעד', 'b', true, '2026-10-01'),
  -- One title, two rows: the published one takes the slug, though it is newer.
  ('aaaaaaaaaaaaaaaaaaaaaaa2', 'ביטוח נסיעות לחו״ל: שלוש בדיקות לפני שקונים עוד פוליסה', 'b', false, '2026-09-01'),
  ('aaaaaaaaaaaaaaaaaaaaaaa3', 'ביטוח נסיעות לחו״ל: שלוש בדיקות לפני שקונים עוד פוליסה', 'b', true, '2026-10-02'),
  -- One of the two live articles older than the repo files.
  ('aaaaaaaaaaaaaaaaaaaaaaa4', 'פנסיה בעידן ה-AI: האם הרובוט יודע לתכנן עבורכם טוב יותר?', 'b', true, '2026-08-01'),
  -- A draft no file names, with an id that needs cleaning.
  ('B44_Odd.ID', 'טיוטה בלי קובץ', 'b', false, '2026-10-03'),
  -- A row that never had a Base44 id.
  (null, 'שורה שנוצרה רק ב-Supabase', 'b', false, '2026-10-04');

\ir ../migrations/20261014000000_blog_slug.sql

do $$ begin
  if (select slug from public.blog_posts where base44_id = 'aaaaaaaaaaaaaaaaaaaaaaa1') is distinct from 'horadat-dmei-nihul' then
    raise exception 'a repo article did not get its file name as its slug';
  end if;
  if (select slug from public.blog_posts where base44_id = 'aaaaaaaaaaaaaaaaaaaaaaa3') is distinct from 'bituach-nesiot' then
    raise exception 'the published copy of a duplicated title did not get the slug';
  end if;
  if (select slug from public.blog_posts where base44_id = 'aaaaaaaaaaaaaaaaaaaaaaa2') is distinct from 'post-aaaaaaaaaaaaaaaaaaaaaaa2' then
    raise exception 'the draft copy of a duplicated title should fall back to its Base44 id';
  end if;
  if (select slug from public.blog_posts where base44_id = 'aaaaaaaaaaaaaaaaaaaaaaa4') is distinct from 'pensia-beidan-ha-ai' then
    raise exception 'an older live article did not get its hand-picked slug';
  end if;
  if (select slug from public.blog_posts where base44_id = 'B44_Odd.ID') is distinct from 'post-b44-odd-id' then
    raise exception 'an untidy Base44 id was not cleaned into a valid slug';
  end if;
  if (select slug from public.blog_posts where title = 'שורה שנוצרה רק ב-Supabase') !~ '^post-[0-9a-f]{8}-[0-9a-f]{4}-' then
    raise exception 'a row with no Base44 id should fall back to its uuid';
  end if;
  if exists (select 1 from public.blog_posts where slug is null) then
    raise exception 'a row was left without a slug';
  end if;
end $$;

-- The fallback trigger: the writers running before this PR send no slug.
do $$ begin
  -- contentAdmin's create mirror, today: a plain upsert with no slug, new row.
  insert into public.blog_posts (base44_id, title, body, published)
    values ('bbbbbbbbbbbbbbbbbbbbbbb1', 'חדש בלי כתובת', 'b', false)
    on conflict (base44_id) do update set title = excluded.title, body = excluded.body, published = excluded.published;
  if (select slug from public.blog_posts where base44_id = 'bbbbbbbbbbbbbbbbbbbbbbb1') is distinct from 'post-bbbbbbbbbbbbbbbbbbbbbbb1' then
    raise exception 'an upsert-insert without a slug did not get the fallback';
  end if;
  -- The same upsert against an existing row must not touch its slug.
  insert into public.blog_posts (base44_id, title, body, published)
    values ('aaaaaaaaaaaaaaaaaaaaaaa1', 'להוריד דמי ניהול בפנסיה: המהלך הפשוט ביותר, צעד אחר צעד', 'b2', true)
    on conflict (base44_id) do update set title = excluded.title, body = excluded.body, published = excluded.published;
  if (select slug from public.blog_posts where base44_id = 'aaaaaaaaaaaaaaaaaaaaaaa1') is distinct from 'horadat-dmei-nihul' then
    raise exception 'an upsert without a slug overwrote an existing slug';
  end if;
  -- A plain insert without a slug, and one with no Base44 id either.
  insert into public.blog_posts (base44_id, title, body) values ('bbbbbbbbbbbbbbbbbbbbbbb2', 'בלי כתובת', 'b');
  if (select slug from public.blog_posts where base44_id = 'bbbbbbbbbbbbbbbbbbbbbbb2') is distinct from 'post-bbbbbbbbbbbbbbbbbbbbbbb2' then
    raise exception 'an insert without a slug did not get the fallback';
  end if;
  insert into public.blog_posts (title, body) values ('בלי כתובת ובלי מזהה', 'b');
  if (select slug from public.blog_posts where title = 'בלי כתובת ובלי מזהה') !~ '^post-[0-9a-f]{8}-' then
    raise exception 'an insert with no slug and no Base44 id did not fall back to its uuid';
  end if;
  -- A slug that is sent is kept.
  insert into public.blog_posts (base44_id, title, body, slug) values ('bbbbbbbbbbbbbbbbbbbbbbb3', 'עם כתובת', 'b', 'im-ktovet');
  if (select slug from public.blog_posts where base44_id = 'bbbbbbbbbbbbbbbbbbbbbbb3') is distinct from 'im-ktovet' then
    raise exception 'the trigger replaced a slug that was sent';
  end if;
end $$;

-- The constraints, row by row.
do $$ begin
  begin
    update public.blog_posts set slug = null where base44_id = 'bbbbbbbbbbbbbbbbbbbbbbb3';
    raise exception 'a slug was cleared to null';
  exception when not_null_violation then null;
  end;
  begin
    insert into public.blog_posts (title, body, slug) values ('x', 'b', 'Has-Capitals');
    raise exception 'an uppercase slug was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.blog_posts (title, body, slug) values ('x', 'b', 'double--hyphen');
    raise exception 'a double hyphen was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.blog_posts (title, body, slug) values ('x', 'b', 'trailing-');
    raise exception 'a trailing hyphen was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.blog_posts (title, body, slug) values ('x', 'b', 'עברית');
    raise exception 'a Hebrew slug was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.blog_posts (title, body, slug) values ('x', 'b', 'abcdefabcdefabcdefabcdef');
    raise exception 'a slug shaped like a Base44 id was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.blog_posts (title, body, slug) values ('x', 'b', 'horadat-dmei-nihul');
    raise exception 'a duplicate slug was accepted';
  exception when unique_violation then null;
  end;
  insert into public.blog_posts (title, body, slug) values ('תקין', 'b', 'kebab-case-2026');
end $$;

-- An anonymous visitor reads a published article's slug, and never a draft's.
set local role anon;
do $$ begin
  if (select count(*) from public.blog_posts where slug = 'horadat-dmei-nihul') <> 1 then
    raise exception 'anon cannot read a published article by its slug';
  end if;
  if exists (select 1 from public.blog_posts where slug = 'post-aaaaaaaaaaaaaaaaaaaaaaa2') then
    raise exception 'anon read a draft by its slug';
  end if;
end $$;

rollback;
```

- [ ] **Step 6: Give the existing checks' seed rows a slug**

In `supabase/tests/rls_check.sql`, replace:
```sql
insert into public.blog_posts (title, body, published) values ('published','b', true), ('draft','b', false);
```
with:
```sql
insert into public.blog_posts (title, body, published, slug) values ('published','b', true, 'rls-published'), ('draft','b', false, 'rls-draft');
```

In `supabase/tests/agency_isolation_check.sql`, replace the four-row insert (L50-54):
```sql
insert into public.blog_posts (title, body, published, agency_id) values
  ('מאמר א׳', 'תוכן', true, '00000000-0000-0000-0000-000000000001'),
  ('מאמר ב׳', 'תוכן', true, 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('מאמר משותף', 'תוכן', true, null),
  ('טיוטה משותפת', 'תוכן', false, null);
```
with:
```sql
insert into public.blog_posts (title, body, published, agency_id, slug) values
  ('מאמר א׳', 'תוכן', true, '00000000-0000-0000-0000-000000000001', 'iso-a'),
  ('מאמר ב׳', 'תוכן', true, 'aaaaaaaa-0000-0000-0000-000000000002', 'iso-b'),
  ('מאמר משותף', 'תוכן', true, null, 'iso-shared'),
  ('טיוטה משותפת', 'תוכן', false, null, 'iso-shared-draft');
```

- [ ] **Step 7: Run every database check against a fresh local database**

These checks run by hand and are not wired into CI, the same as `rls_check.sql` and `account_check.sql`. If Docker or the Supabase CLI is not available, write that in the PR description and leave this step unchecked. Do not skip it silently.

```bash
cd $WT && supabase start && supabase db reset; echo "exit=$?"
for f in blog_slug_check rls_check account_check agency_isolation_check storage_check submission_limits_check; do
  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f "supabase/tests/$f.sql" > /tmp/$f.log 2>&1; echo "$f exit=$?"
done
```
Expected: every line reads `exit=0`, and no log contains `ERROR:`. The `db reset` applies the migration to an empty table, so it prints no NOTICE.

- [ ] **Step 8: Update the STD** — `tests/test-plan/03-std-contract.md`

Before `## 5. Runtime counterpart`, add:
```
### 4.8 Article addresses — `article-slug.contract.test.ts`

`blog_posts.slug` is shaped by four things that cannot import one another — the
migration's CHECK, `src/lib/articlePath.ts`, `contentAdmin` and
`scripts/published-articles.mjs` — and these cases keep them one rule. The
backfill is checked against the files it names, from its own side, so a draft
added to `content/blog/` later needs no row in a migration that has shipped.
`supabase/tests/blog_slug_check.sql` is the runtime counterpart: it re-applies
the migration on production-shaped rows (a duplicated title, an untidy Base44
id, a row with none) and asserts the backfill and every constraint. It also
asserts the BEFORE INSERT fallback trigger: an insert or upsert that sends no
slug gets `post-<id>`, an existing slug is never overwritten, and a sent slug is
kept. That trigger is what lets the migration reach production before the code
that writes real slugs.

| ID | Title | Expected result |
|---|---|---|
| CTR-SLUG-001 | "the migration's CHECKs are articlePath's patterns" | `slug ~` equals `SLUG_PATTERN.source`; `slug !~` equals `BASE44_ID_PATTERN.source` |
| CTR-SLUG-002 | "gives a repo article's slug to that file's exact title" | 20 backfill rows name a file; each title equals that file's front matter |
| CTR-SLUG-003 | "names the two live articles older than the repo files" | `bituach-briut-digitali`, `pensia-beidan-ha-ai` with their exact titles |
| CTR-SLUG-004 | "maps 22 distinct titles to 22 distinct slugs" | 22 rows, no title or slug twice |
```
In §6 change `All 542 cases pass.` to `All 546 cases pass.`

- [ ] **Step 9: Commit**

```bash
cd $WT && git add supabase/migrations/20261014000000_blog_slug.sql supabase/tests/blog_slug_check.sql supabase/tests/rls_check.sql supabase/tests/agency_isolation_check.sql tests/contract/article-slug.contract.test.ts tests/test-plan/03-std-contract.md && git commit -m "$(cat <<'EOF'
SEO PR1: blog_posts.slug, backfilled for the 22 live articles

Added nullable, backfilled by exact title (the 20 repo file names plus the
two older articles), every other row post-<id>, then NOT NULL, UNIQUE and
the kebab-case and not-a-Base44-id CHECKs. A BEFORE INSERT trigger fills
post-<id> for a writer that sends no slug, so the code running today keeps
working and the migration can be applied before this PR is merged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ
EOF
)"
```

---

### Task 3: Reads — resolve a slug, then a Base44 id, then a uuid

**Files:**
- Modify: `src/services/supabase/SupabaseTableClient.ts` (`interface SupabaseQuery`, L8-12)
- Modify: `src/services/supabase/RestTableClient.ts` (L1 import; add `or` after `eq`, L45-47)
- Modify: `src/services/supabase/SupabaseContentService.ts` (whole file)
- Modify: `tests/helpers/supabase-table-fake.ts` (the `query` object)
- Test: `tests/unit/supabase-content.test.ts` (replace `describe("SupabaseContentService.getArticle", …)` L99-117), `tests/unit/rest-table-client.test.ts` (two cases)
- Modify: `tests/test-plan/01-std-unit.md` (§4.19 rows, new §4.23, §5 total)

**Interfaces:**
- Consumes: `SLUG_PATTERN` and `UUID_PATTERN` from Task 1.
- Produces:
  - `SupabaseQuery.or(filters: string): SupabaseQuery`. The `filters` argument has no brackets; this is supabase-js's signature.
  - `ARTICLE_COLUMNS` now includes `slug`.
  - `SupabaseContentService.getArticle(key: string): Promise<Article>`. It throws `Error & { status: 404 }` when not found and a plain `Error("blog_posts read failed: …")` on a read failure.

- [ ] **Step 1: Teach the fake `or`** — in `tests/helpers/supabase-table-fake.ts`, inside `const query: SupabaseQuery = {`, after the `eq(column, value) { … },` member add:

```ts
    or(filters) {
      calls.push(["or", filters]);
      return query;
    },
```

- [ ] **Step 2: Write the failing tests**

In `tests/unit/supabase-content.test.ts`, change the import line `import { SupabaseContentService } from "@/services/supabase/SupabaseContentService";` to:
```ts
import { ARTICLE_COLUMNS, SupabaseContentService } from "@/services/supabase/SupabaseContentService";
```
Replace the whole `describe("SupabaseContentService.getArticle", () => { … });` block with:

```ts
describe("SupabaseContentService.getArticle", () => {
  const B44 = "64f0a1b2c3d4e5f6a7b8c9d0";
  const UUID = "6f1c0e3a-0000-4000-8000-000000000001";
  const slugRow = (over: Record<string, unknown> = {}) =>
    articleRow({ base44_id: B44, slug: "horadat-dmei-nihul", ...over });

  it("reads the slug with every article", () => {
    expect(ARTICLE_COLUMNS.split(",")).toContain("slug");
  });

  it("asks for the key as a slug or a Base44 id, in one request", async () => {
    const { client, calls } = tableFake(ok([slugRow()]));
    await new SupabaseContentService(client).getArticle("horadat-dmei-nihul");
    expect(calls).toContainEqual(["or", "slug.eq.horadat-dmei-nihul,base44_id.eq.horadat-dmei-nihul"]);
    expect(calls.filter((c) => c[0] === "eq")).toEqual([]);
  });

  it("adds the uuid clause only for a uuid-shaped key — PostgREST errors on id.eq.<anything else>", async () => {
    const { client, calls } = tableFake(ok([slugRow({ id: UUID, base44_id: null })]));
    await new SupabaseContentService(client).getArticle(UUID);
    expect(calls).toContainEqual(["or", `slug.eq.${UUID},base44_id.eq.${UUID},id.eq.${UUID}`]);
  });

  it("prefers the slug, then the Base44 id, then the uuid", async () => {
    // Three rows, each matching the key a different way, in the worst order.
    const byUuid = slugRow({ id: UUID, base44_id: "b-1", slug: "s-1", title: "by uuid" });
    const byBase44 = slugRow({ id: "6f1c0e3a-0000-4000-8000-000000000002", base44_id: UUID, slug: "s-2", title: "by base44 id" });
    const bySlug = slugRow({ id: "6f1c0e3a-0000-4000-8000-000000000003", base44_id: "b-3", slug: UUID, title: "by slug" });

    const all = tableFake(ok([byUuid, byBase44, bySlug]));
    expect((await new SupabaseContentService(all.client).getArticle(UUID)).title).toBe("by slug");

    const noSlug = tableFake(ok([byUuid, byBase44]));
    expect((await new SupabaseContentService(noSlug.client).getArticle(UUID)).title).toBe("by base44 id");
  });

  it("returns the article under its Base44 id, with its slug", async () => {
    const { client } = tableFake(ok([slugRow()]));
    const a = await new SupabaseContentService(client).getArticle(B44);
    expect(a.id).toBe(B44);
    expect(a.slug).toBe("horadat-dmei-nihul");
  });

  it("throws a 404 'not found' when no row matches, so the page shows 'not found'", async () => {
    const { client } = tableFake(ok([]));
    await expect(new SupabaseContentService(client).getArticle("gone")).rejects.toMatchObject({
      message: expect.stringMatching(/not found/),
      status: 404,
    });
  });

  it.each(["Has-Capitals", "a,b", "x)", "slug.eq.y", "", "../etc"])(
    "never asks about %j — no article's slug, Base44 id or uuid looks like it",
    async (key) => {
      const { client, calls } = tableFake(ok([slugRow()]));
      await expect(new SupabaseContentService(client).getArticle(key)).rejects.toMatchObject({ status: 404 });
      expect(calls).toEqual([]);
    },
  );

  it("fails, rather than answering 'not found', when the read fails", async () => {
    const { client } = tableFake(failed);
    const err = await new SupabaseContentService(client).getArticle("horadat-dmei-nihul").catch((e) => e);
    expect(err.message).toMatch(/blog_posts read failed/);
    expect(err.status).toBeUndefined();
  });
});
```

In `tests/unit/rest-table-client.test.ts`, add inside `describe("RestTableClient — the request", …)` after the case `"encodes a filter value that has characters of its own"`:

```ts
  it("builds an or filter inside PostgREST's brackets", async () => {
    const { rest, fetchImpl } = client(ok([]));
    await rest.from("blog_posts").select("*").or("slug.eq.a,base44_id.eq.a").limit(3);
    expect(new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get("or")).toBe("(slug.eq.a,base44_id.eq.a)");
  });
```
Add after `"asks for the same URL with the same anonymous credentials"` in the same file:

```ts
  it("asks for an or filter exactly as supabase-js does", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const seen: string[] = [];
    const record = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const sdk = createClient(URL_, KEY, {
      global: { fetch: record },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    await sdk.from("blog_posts").select("id,slug").or("slug.eq.k,base44_id.eq.k").limit(3);
    await new RestTableClient(URL_, KEY, record).from("blog_posts").select("id,slug").or("slug.eq.k,base44_id.eq.k").limit(3);
    expect(seen[1]).toBe(seen[0]);
  });
```

- [ ] **Step 3: Run them and watch them fail**

Run: `cd $WT && npx vitest run tests/unit/supabase-content.test.ts tests/unit/rest-table-client.test.ts; echo "exit=$?"`
Expected: FAIL. The output shows `rest.from(...).select(...).or is not a function` and an `or` call missing from `calls` (the service still uses `eq("base44_id")`), and ends with `exit=1`.

- [ ] **Step 4: Add `or` to the query surface**

In `src/services/supabase/SupabaseTableClient.ts`, replace:
```ts
export interface SupabaseQuery extends PromiseLike<SupabaseReadResult> {
  eq(column: string, value: unknown): SupabaseQuery;
```
with:
```ts
export interface SupabaseQuery extends PromiseLike<SupabaseReadResult> {
  eq(column: string, value: unknown): SupabaseQuery;
  /** PostgREST `or=(…)`. `filters` without the brackets, as supabase-js takes it. */
  or(filters: string): SupabaseQuery;
```

In `src/services/supabase/RestTableClient.ts`, change line 1 to:
```ts
import type { SupabaseQuery, SupabaseReadResult, SupabaseTableClient } from "./SupabaseTableClient.js";
```
and after the `eq` method of `RestQuery` add:
```ts
  or(filters: string): SupabaseQuery {
    return this.with("or", `(${filters})`);
  }
```

- [ ] **Step 5: Rewrite `src/services/supabase/SupabaseContentService.ts`**

```ts
import type { Article, ContentPort, Testimonial } from "../ports.js";
import { SLUG_PATTERN, UUID_PATTERN } from "../../lib/articlePath.js";
import { fetchRows, toPortRow, type SupabaseTableClient } from "./SupabaseTableClient.js";

// Relative imports carry `.js`: api/og/blog.ts uses this class, and api/ is
// compiled as Node ESM (nodenext), which resolves no extensionless path.

/**
 * Named columns, not `*`: the port's fields and the two the mapping needs.
 * `slug` is the article's address, `/blog/<slug>` — see src/lib/articlePath.ts.
 */
export const ARTICLE_COLUMNS =
  "id,base44_id,slug,title,excerpt,body,image_url,tags,action_time,published,created_at";
export const TESTIMONIAL_COLUMNS = "id,base44_id,name,role,quote,image_url,rating,source,created_at";

export const toArticle = (row: Record<string, unknown>): Article => toPortRow(row) as unknown as Article;

/** `rating` is a numeric column, and PostgREST sends numerics as strings. */
export const toTestimonial = (row: Record<string, unknown>): Testimonial => {
  const out = toPortRow(row);
  if (out.rating !== undefined) out.rating = Number(out.rating);
  return out as unknown as Testimonial;
};

/**
 * "No such article", shaped the way api/og/blog.ts and Base44's `get` both
 * spell it: a 404 status on the error. BlogPost.tsx reads any error as
 * "not found"; the server tells a 404 from a failed read by this.
 */
const notFound = (key: string) => Object.assign(new Error(`article ${key} not found`), { status: 404 });

/**
 * Read side of the content store, on Supabase.
 *
 * The `published` filter is in the query even though RLS already hides drafts
 * from an anonymous reader: a signed-in admin passes that policy, and the
 * public blog must not list drafts to her either. The rule belongs to the
 * port, as it did in Base44ContentService.
 */
export class SupabaseContentService implements ContentPort {
  constructor(private readonly client: SupabaseTableClient) {}

  async listArticles(limit = 50): Promise<Article[]> {
    const rows = await fetchRows(
      this.client
        .from("blog_posts")
        .select(ARTICLE_COLUMNS)
        .eq("published", true)
        .order("created_at", { ascending: false })
        .limit(limit),
      "blog_posts",
    );
    return rows.map(toArticle);
  }

  /**
   * One article, by whatever followed `/blog/` in the address.
   *
   * That is a slug (every link the site builds now), a Base44 id (every link
   * before slugs: bookmarks, search results, the agents' answers), or Supabase's
   * uuid for a row that never had a Base44 id. One request asks for all three,
   * and the slug wins, then the Base44 id, then the uuid.
   *
   * The key goes into a PostgREST `or=(…)` filter, where a comma or a bracket
   * would change the filter itself. So a key that is not slug-shaped is never
   * sent: no slug, Base44 id or uuid can look like it. The uuid clause is sent
   * only for a uuid-shaped key, because PostgREST answers `id.eq.<not a uuid>`
   * with an error (22P02), not with an empty list.
   */
  async getArticle(key: string): Promise<Article> {
    if (!SLUG_PATTERN.test(key)) throw notFound(key);
    const clauses = [`slug.eq.${key}`, `base44_id.eq.${key}`];
    if (UUID_PATTERN.test(key)) clauses.push(`id.eq.${key}`);
    const rows = await fetchRows(
      this.client.from("blog_posts").select(ARTICLE_COLUMNS).or(clauses.join(",")).limit(3),
      "blog_posts",
    );
    const row =
      rows.find((r) => r.slug === key) ?? rows.find((r) => r.base44_id === key) ?? rows.find((r) => r.id === key);
    if (!row) throw notFound(key);
    return toArticle(row);
  }

  async listTestimonials(limit = 50): Promise<Testimonial[]> {
    const rows = await fetchRows(
      this.client
        .from("testimonials")
        .select(TESTIMONIAL_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(limit),
      "testimonials",
    );
    return rows.map(toTestimonial);
  }
}
```

- [ ] **Step 6: Run the tests, the typecheck and the whole unit suite**

Run: `cd $WT && npx vitest run tests/unit/supabase-content.test.ts tests/unit/rest-table-client.test.ts; echo "exit=$?"; npm run typecheck; echo "exit=$?"; npx vitest run tests/unit; echo "exit=$?"`
Expected: all pass, and all three lines read `exit=0`.

- [ ] **Step 7: Update the STD** — `tests/test-plan/01-std-unit.md`

At the end of the §4.19 table add:
```
| UNIT-REST-013 | "builds an or filter inside PostgREST's brackets" | `or=(slug.eq.a,base44_id.eq.a)` |
| UNIT-REST-014 | "asks for an or filter exactly as supabase-js does" | Same URL as supabase-js's `.or()` |
```
Before `## 5. Pass criteria` add:
```
### 4.23 Reading one article — `tests/unit/supabase-content.test.ts` (`getArticle`)

`/blog/:key` holds a slug, an old Base44 id, or a uuid. One PostgREST request
asks for all three and the slug wins. The key reaches an `or=(…)` filter, so a
key that is not slug-shaped is answered "not found" without a request — a comma
or a bracket in it would rewrite the filter.

| ID | Title | Expected result |
|---|---|---|
| UNIT-ART-001 | "reads the slug with every article" | `slug` in `ARTICLE_COLUMNS` |
| UNIT-ART-002 | "asks for the key as a slug or a Base44 id, in one request" | `or: slug.eq.k,base44_id.eq.k`; no `eq` |
| UNIT-ART-003 | "adds the uuid clause only for a uuid-shaped key" | `…,id.eq.<uuid>` |
| UNIT-ART-004 | "prefers the slug, then the Base44 id, then the uuid" | The slug's row; without it, the Base44 id's |
| UNIT-ART-005 | "returns the article under its Base44 id, with its slug" | `id` is the Base44 id; `slug` present |
| UNIT-ART-006 | "throws a 404 'not found' when no row matches" | `status: 404` |
| UNIT-ART-007 | "never asks about %j" (6 keys) | `status: 404`; no call recorded |
| UNIT-ART-008 | "fails, rather than answering 'not found', when the read fails" | `blog_posts read failed`; no `status` |
```
In §5 change `All 362 cases pass.` to `All 374 cases pass.`

- [ ] **Step 8: Commit**

```bash
cd $WT && git add src/services/supabase/SupabaseTableClient.ts src/services/supabase/RestTableClient.ts src/services/supabase/SupabaseContentService.ts tests/helpers/supabase-table-fake.ts tests/unit/supabase-content.test.ts tests/unit/rest-table-client.test.ts tests/test-plan/01-std-unit.md && git commit -m "$(cat <<'EOF'
SEO PR1: getArticle resolves a slug, then a Base44 id, then a uuid

One or=(…) request; keys that are not slug-shaped are never sent, and the
uuid clause only goes with a uuid-shaped key.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ
EOF
)"
```

---

### Task 4: Every link builder uses the slug; old addresses become slug addresses

**Files:**
- Modify: `src/lib/blogSeo.ts` (imports L6-14, L35)
- Modify: `src/components/dorit/blog/ArticleCard.tsx` (imports L1-6, L30)
- Modify: `src/components/dorit/blog/FeaturedRow.tsx` (imports L1-5, L47, L60)
- Modify: `src/pages/Blog.tsx` (import after L26, L92)
- Modify: `src/App.jsx` L89
- Modify: `src/pages/BlogPost.tsx` (whole file)
- Modify: `src/hooks/useContent.ts` (`useArticle`, L31-38)
- Test: `tests/unit/blogSeo.test.ts`, `tests/component/blog-page.test.tsx`, `tests/component/blog-post-redirect.test.tsx` (new), `tests/contract/article-slug.contract.test.ts`
- Modify: `tests/test-plan/02-std-component.md`, `tests/test-plan/03-std-contract.md`

**Interfaces:**
- Consumes: `articlePath` (Task 1). `Article.slug` and `getArticle(key)` (Task 3). `contentKeys.article` from `src/hooks/useContent.ts`.
- Produces:
  - The route `/blog/:key`.
  - `BlogPost` replaces history with `articlePath(post) + search + hash` when `post.slug && post.slug !== key`.
  - `useArticle` gets `staleTime: 5 min`.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/blogSeo.test.ts`, inside `describe("computeBlogSeoConfig", …)`, add:

```ts
  it("uses the article's slug for its path, breadcrumb and BlogPosting when it has one", () => {
    const withSlug = computeBlogSeoConfig({ ...post, slug: "bechirat-keren-pensia" });
    expect(withSlug.path).toBe("/blog/bechirat-keren-pensia");
    const [crumbs, posting] = withSlug.jsonLd as Array<Record<string, any>>;
    expect(crumbs.itemListElement.at(-1).item).toBe(`${SITE_URL}/blog/bechirat-keren-pensia`);
    expect(posting.mainEntityOfPage["@id"]).toBe(`${SITE_URL}/blog/bechirat-keren-pensia`);
  });
```

In `tests/component/blog-page.test.tsx`, at the end of the file add:

```tsx
describe("article links", () => {
  it("links each card and the blog's JSON-LD to the slug, or to the id where the store has none", async () => {
    base44Mock.entities.BlogPost.filter.mockResolvedValue([
      post("pen-1", "פנסיה", { slug: "maslul-hashkaa" }),
      post("pen-2", "פנסיה"),
    ]);
    renderBlog();
    await loaded();
    const hrefs = screen.getAllByTestId("article-card").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(expect.arrayContaining(["/blog/maslul-hashkaa", "/blog/pen-2"]));

    const blog = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((s) => JSON.parse(s.textContent ?? "{}"))
      .find((b) => b["@type"] === "Blog");
    const urls = blog.blogPost.map((p: { url: string }) => new URL(p.url).pathname);
    expect(urls).toEqual(expect.arrayContaining(["/blog/maslul-hashkaa", "/blog/pen-2"]));
  });
});
```

Create `tests/component/blog-post-redirect.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 *
 * An article reached by an old-form address — a Base44 id from a bookmark, a
 * search result or an agent's answer — takes its slug address once it loads,
 * keeping whatever the visitor's link carried after it. The server answers
 * the same address with a 301 (api/og/blog.ts); this is the half that covers
 * a visit that reaches the page another way, such as in-app navigation.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { base44Mock } from "./base44-mock";

if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock("@/api/base44Client", () => ({ base44: base44Mock }));
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

const auth = vi.hoisted(() => ({ isAuthenticated: false, user: null as null | { role: string } }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth }));

vi.mock("framer-motion", async () => {
  const R = await import("react");
  const passthrough = new Proxy(
    {},
    { get: (_t, tag: string) => ({ children, ...props }: any) => R.createElement(tag, props, children) },
  );
  return {
    motion: passthrough,
    AnimatePresence: ({ children }: any) => R.createElement(R.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

const { default: BlogPost } = await import("@/pages/BlogPost");

const B44 = "64f0a1b2c3d4e5f6a7b8c9d0";
const ARTICLE = {
  id: B44,
  slug: "horadat-dmei-nihul",
  title: "להוריד דמי ניהול בפנסיה",
  body: "גוף המאמר.",
  published: true,
  created_date: "2026-10-01T09:00:00Z",
};

function Where() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="where">{`${pathname}${search}${hash}`}</output>;
}

const renderAt = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/blog/:key"
            element={
              <>
                <BlogPost />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const where = () => screen.getByTestId("where").textContent;

beforeEach(() => {
  base44Mock.entities.BlogPost.get.mockReset();
});

describe("an article reached by an old-form address", () => {
  it("takes its slug address, keeping the query and the hash", async () => {
    base44Mock.entities.BlogPost.get.mockResolvedValue(ARTICLE);
    renderAt(`/blog/${B44}?utm_source=whatsapp#mah-bodkim`);
    await screen.findByRole("heading", { level: 1, name: ARTICLE.title });
    await waitFor(() => expect(where()).toBe("/blog/horadat-dmei-nihul?utm_source=whatsapp#mah-bodkim"));
    // Put under its new key before the switch, so the slug address costs no second read.
    expect(base44Mock.entities.BlogPost.get).toHaveBeenCalledTimes(1);
  });

  it("stays where it is when the address already is the slug", async () => {
    base44Mock.entities.BlogPost.get.mockResolvedValue(ARTICLE);
    renderAt("/blog/horadat-dmei-nihul");
    await screen.findByRole("heading", { level: 1, name: ARTICLE.title });
    expect(where()).toBe("/blog/horadat-dmei-nihul");
  });

  it("stays on the id where the store has no slug (a build reading Base44)", async () => {
    base44Mock.entities.BlogPost.get.mockResolvedValue({ ...ARTICLE, slug: undefined });
    renderAt(`/blog/${B44}`);
    await screen.findByRole("heading", { level: 1, name: ARTICLE.title });
    expect(where()).toBe(`/blog/${B44}`);
  });
});
```

In `tests/contract/article-slug.contract.test.ts`, change the first import line to:
```ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
```
and append at the end of the file:

```ts
describe("every article link goes through articlePath", () => {
  const walk = (dir: string): string[] =>
    readdirSync(join(REPO_ROOT, dir)).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(join(REPO_ROOT, p)).isDirectory()) return walk(p);
      return /\.(ts|tsx|js|jsx)$/.test(name) ? [p] : [];
    });
  const files = [...walk("src"), ...walk("api")];

  it("builds no /blog/<…> address by hand", () => {
    // `/blog/${post.id}` in five files is how links to the same article came to
    // disagree. One builder; a link built anywhere else fails here.
    const handBuilt = /\/blog\/\$\{|["'`]\/blog\/["'`]\s*\+/;
    const offenders = files.filter((f) => f !== "src/lib/articlePath.ts" && handBuilt.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it.each([
    "src/components/dorit/blog/ArticleCard.tsx",
    "src/components/dorit/blog/FeaturedRow.tsx",
    "src/pages/Blog.tsx",
    "src/pages/BlogPost.tsx",
    "src/lib/blogSeo.ts",
  ])("%s links articles through articlePath", (file) => {
    expect(read(file)).toMatch(/\barticlePath\(/);
  });
});
```
(Task 6 adds `src/pages/BlogAdmin.tsx` and Task 9 adds `api/og/blog.ts` to this list once they use it.)

- [ ] **Step 2: Run them and watch them fail**

Run: `cd $WT && npx vitest run tests/unit/blogSeo.test.ts tests/component/blog-page.test.tsx tests/component/blog-post-redirect.test.tsx tests/contract/article-slug.contract.test.ts; echo "exit=$?"`
Expected: FAIL, ending with `exit=1`:
- blogSeo: `expected '/blog/post-1' to be '/blog/bechirat-keren-pensia'`
- blog-page: the hrefs lack `/blog/maslul-hashkaa`
- redirect test: `where` stays `/blog/64f0…`, because `useParams` has no `key`
- the contract lists four offending files (ArticleCard, FeaturedRow, Blog, blogSeo) and five files without `articlePath(`

- [ ] **Step 3: Switch every builder to `articlePath`**

`src/lib/blogSeo.ts` — after the `import type { Article } from "../services/ports.js";` line add:
```ts
import { articlePath } from "./articlePath.js";
```
and replace `  const path = \`/blog/${post.id}\`;` with:
```ts
  const path = articlePath(post);
```

`src/components/dorit/blog/ArticleCard.tsx` — after `import { cn } from "@/lib/utils";` add:
```ts
import { articlePath } from "@/lib/articlePath";
```
and replace `      to={\`/blog/${post.id}\`}` with:
```tsx
      to={articlePath(post)}
```
Keep `id={\`post-${post.id}\`}`: it is the recommender's scroll anchor, not a link.

`src/components/dorit/blog/FeaturedRow.tsx` — after `import type { Article } from "@/services";` add:
```ts
import { articlePath } from "@/lib/articlePath";
```
Replace `          to={\`/blog/${featured.id}\`}` with `          to={articlePath(featured)}`, and replace `<Link to={\`/blog/${p.id}\`} className=` with `<Link to={articlePath(p)} className=`.

`src/pages/Blog.tsx` — after `import { SITE_NAME, absoluteUrl, breadcrumbLd, useSeo } from "@/lib/seo";` add:
```ts
import { articlePath } from "@/lib/articlePath";
```
and replace `                url: absoluteUrl(\`/blog/${post.id}\`),` with:
```tsx
                url: absoluteUrl(articlePath(post)),
```
Leave the recommender's matching (`byId` on `p.id`) as it is. The agents read Base44, which has no slug, so they can only name ids. Every `Article` still carries its id, and an id link in the agent's prose reaches the slug through the 301 (Task 9) and the history replace below.

`src/App.jsx` — replace `        <Route path="/blog/:id" element={<BlogPost />} />` with:
```jsx
        <Route path="/blog/:key" element={<BlogPost />} />
```

`src/hooks/useContent.ts` — replace the `useArticle` function with:
```ts
export function useArticle(key: string | undefined) {
  return useQuery<Article>({
    queryKey: contentKeys.article(key),
    queryFn: () => services.content.getArticle(key as string),
    enabled: !!key,
    retry: false, // a missing article is an answer, not a failure to retry
    // Fresh for as long as the lists are. BlogPost.tsx seeds the slug's key
    // when it moves an old address there, and that copy must not be re-read.
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 4: Rewrite `src/pages/BlogPost.tsx`**

```tsx
import React from "react";
import { useParams, Link, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { contentKeys, useArticle } from "@/hooks/useContent";
import type { Article } from "@/services";
import { Image } from "@/components/ui/image";
import ReactMarkdown from "react-markdown";
import { Loader2, ArrowRight, Calendar } from "lucide-react";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import ShareButtons from "@/components/dorit/primitives/ShareButtons";
import CredentialsStrip from "@/components/dorit/primitives/CredentialsStrip";
import { useSeo } from "@/lib/seo";
import { articlePath } from "@/lib/articlePath";
import { BLOG_POST_NOT_FOUND_SEO, computeBlogSeoConfig } from "@/lib/blogSeo";

export default function BlogPost() {
  /** A slug, or — from a link made before slugs — a Base44 id or a uuid. */
  const { key } = useParams<{ key: string }>();
  const { data, isPending: loading, isError: notFound } = useArticle(key);
  const post: Article | null = data ?? null;
  const navigate = useNavigate();
  const { search, hash } = useLocation();
  const queryClient = useQueryClient();

  // A missing post must never be indexed as a real article — same rule
  // api/og/blog.ts falls back to when Supabase has nothing for the key.
  useSeo(post ? computeBlogSeoConfig(post) : notFound ? BLOG_POST_NOT_FOUND_SEO : null);

  // Reached by an old address (a Base44 id from a bookmark, a search result
  // or an agent's answer): show the article, then take the address it lives
  // at, so what the visitor copies or shares is the slug. `replace`, so Back
  // does not return to the old form and bounce forward again. The query and
  // hash the link carried come along (utm_* tags among them). The article is
  // put under its new key first, so the switch costs no second read.
  React.useEffect(() => {
    if (!post?.slug || post.slug === key) return;
    queryClient.setQueryData(contentKeys.article(post.slug), post);
    navigate(`${articlePath(post)}${search}${hash}`, { replace: true });
  }, [post, key, search, hash, navigate, queryClient]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin text-accent" />
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <p className="font-heading text-3xl">המאמר לא נמצא</p>
        <Link
          to="/blog"
          className="mt-6 inline-flex items-center gap-2 text-accent hover:underline"
        >
          חזרה לבלוג <ArrowRight size={16} />
        </Link>
      </div>
    );
  }

  return (
    <article className="relative bg-background min-h-screen">
      <FloatingHeader />
      <div className="pt-32 md:pt-36 pb-24">
        <div className="max-w-3xl mx-auto px-6 md:px-10">
          <Link
            to="/blog"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors"
          >
            <ArrowRight size={16} /> חזרה לבלוג
          </Link>

          <div className="mt-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar size={13} />
              {new Date(post.created_date).toLocaleDateString("he-IL", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </div>
            <h1 className="font-heading text-4xl md:text-5xl mt-4 leading-tight">
              {post.title}
            </h1>
            {post.tags && (
              <div className="mt-4 flex flex-wrap gap-2">
                {post.tags
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .map((t) => (
                    <span
                      key={t}
                      className="text-sm px-2 py-0.5 border border-border text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
              </div>
            )}
          </div>

          {post.image_url && (
            <div className="mt-8 overflow-hidden">
              <Image
                src={post.image_url}
                alt={post.title}
                className="w-full h-64 md:h-80 object-cover"
                fittingType="fill"
              />
            </div>
          )}

          <div className="mt-10 blog-body">
            <ReactMarkdown>{post.body || ""}</ReactMarkdown>
          </div>

          <div className="mt-10">
            <CredentialsStrip />
          </div>

          <ShareButtons title={post.title} />
        </div>
      </div>
      <Footer />
    </article>
  );
}
```

- [ ] **Step 5: Run the tests, lint and typecheck**

Run: `cd $WT && npx vitest run tests/unit/blogSeo.test.ts tests/component tests/contract/article-slug.contract.test.ts; echo "exit=$?"; npm run lint; echo "exit=$?"; npm run typecheck; echo "exit=$?"`
Expected: all pass, and all three lines read `exit=0`.

- [ ] **Step 6: Update the STDs**

`tests/test-plan/02-std-component.md`, at the end of the §4.12 table:
```
| CMP-BLOG-024 | "links each card and the blog's JSON-LD to the slug, or to the id where the store has none" | `/blog/maslul-hashkaa` and `/blog/pen-2` in the cards and in `Blog.blogPost[].url` |
```
Before `## 5. Pass criteria` add:
```
### 4.15 `<BlogPost />` — old addresses — `tests/component/blog-post-redirect.test.tsx`

An address from before slugs (a Base44 id) shows the article, then replaces
itself with `/blog/<slug>`, keeping the query and hash the link carried. The
article is cached under the slug first, so the switch reads nothing again.

| ID | Title | Expected result |
|---|---|---|
| CMP-POST-001 | "takes its slug address, keeping the query and the hash" | `/blog/horadat-dmei-nihul?utm_source=whatsapp#mah-bodkim`; one read |
| CMP-POST-002 | "stays where it is when the address already is the slug" | Unchanged |
| CMP-POST-003 | "stays on the id where the store has no slug (a build reading Base44)" | Unchanged |
```
In §5 change `All 76 cases pass.` to `All 80 cases pass.`

`tests/test-plan/03-std-contract.md`, at the end of the §4.8 table:
```
| CTR-SLUG-005 | "builds no /blog/<…> address by hand" | No `/blog/${` or `"/blog/" +` in `src/` or `api/` outside `articlePath.ts` |
| CTR-SLUG-006 | "%s links articles through articlePath" (5 files) | `articlePath(` in ArticleCard, FeaturedRow, Blog, BlogPost, blogSeo |
```
In §6 change `All 546 cases pass.` to `All 552 cases pass.`

`tests/test-plan/01-std-unit.md` §5: the blogSeo case adds one: change `All 374 cases pass.` to `All 375 cases pass.`

- [ ] **Step 7: Commit**

```bash
cd $WT && git add src/lib/blogSeo.ts src/components/dorit/blog/ArticleCard.tsx src/components/dorit/blog/FeaturedRow.tsx src/pages/Blog.tsx src/App.jsx src/pages/BlogPost.tsx src/hooks/useContent.ts tests/unit/blogSeo.test.ts tests/component/blog-page.test.tsx tests/component/blog-post-redirect.test.tsx tests/contract/article-slug.contract.test.ts tests/test-plan/01-std-unit.md tests/test-plan/02-std-component.md tests/test-plan/03-std-contract.md && git commit -m "$(cat <<'EOF'
SEO PR1: article links are /blog/<slug>; old addresses move to it

Cards, the featured row, the blog's JSON-LD and the post's canonical all go
through articlePath. /blog/:key replaces an old Base44-id address with the
slug, keeping its query and hash.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ
EOF
)"
```

---

### Task 5: `contentAdmin` writes the slug to the mirror, and only there

**Files:**
- Modify: `base44/functions/contentAdmin/entry.ts`: `ARTICLE_FIELDS` (~L96-97), `mirror()` (~L107-132), the `createArticle` and `updateArticle` cases (~L171-182)
- Test: `tests/integration/content-admin.integration.test.ts` (whole file)
- Modify: `tests/contract/article-slug.contract.test.ts` (one case)
- Modify: `AGENTS.md` (Key Files, one bullet)
- Modify: `tests/test-plan/12-std-integration.md`, `tests/test-plan/03-std-contract.md`

**Interfaces:**
- Consumes: the Supabase column and constraints (Task 2). `SLUG_TAKEN` wording (Task 1), duplicated in Hebrew.
- Produces (behaviour of the `contentAdmin` op API):
  - `createArticle { draft: { …, slug } }` → 400 `'כתובת המאמר חסרה או אינה תקינה.'` when the slug is invalid, 409 `'הכתובת כבר בשימוש במאמר אחר.'` when it is taken, else 200 `{ ok, id }`.
  - `updateArticle { id, draft }`: when `draft.slug` is present it is validated and checked the same way. The mirror is `PATCH blog_posts?base44_id=eq.<id>` with only the sent fields, and 0 rows → 500.
  - `ARTICLE_FIELDS` never contains `slug`.

- [ ] **Step 1: Write the failing tests** — replace `tests/integration/content-admin.integration.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { invokeFunction } from "../helpers/base44-function";

/**
 * The admin's content writes and their Supabase mirror.
 *
 * The site reads posts and testimonials from Supabase, so a write that reached
 * Base44 but not Supabase is, to a visitor, a write that never happened. The
 * function writes Base44 first, because creating a row there is what produces
 * the id stamped into Supabase's base44_id, and fails the request when the
 * mirror does.
 *
 * An article's slug (its address, `/blog/<slug>`) is the mirror's alone:
 * Base44's BlogPost has no such field. It is checked before anything is
 * written, because a refusal from the mirror's unique constraint would come
 * after the Base44 row already exists.
 */
const SUPABASE = "https://stub.supabase.co";
const env = { SUPABASE_URL: SUPABASE, SUPABASE_SERVICE_ROLE_KEY: "test-only-service-key" };
const headers = { "X-Supabase-Auth": "test-access-token" };
const asAdmin = [
  { match: "/auth/v1/user", status: 200, json: { id: "admin-1" } },
  { match: "/rest/v1/profiles", status: 200, json: [{ role: "admin" }] },
];
/** The slug lookup. First matching route wins, so these sit before any catch-all. */
const slugFree = { match: "/rest/v1/blog_posts?slug=eq.", status: 200, json: [] };
const slugHeldBy = (base44Id: string) => ({ match: "/rest/v1/blog_posts?slug=eq.", status: 200, json: [{ base44_id: base44Id }] });
/** The PATCH by base44_id finds its row and returns it. */
const rowFound = { match: "/rest/v1/blog_posts?base44_id=eq.", status: 200, json: [{ base44_id: "post-1" }] };
const asAdminWithBlog = [...asAdmin, slugFree, rowFound];
const mirrorDown = (table: string) => [...asAdmin, { match: `/rest/v1/${table}`, status: 500, text: "mirror down" }];
const draft = { title: "כותרת", body: "גוף", published: true, slug: "koteret" };

const ops: [string, Record<string, unknown>, string][] = [
  ["createArticle", { op: "createArticle", draft }, "blog_posts"],
  ["updateArticle", { op: "updateArticle", id: "post-1", draft: { title: "חדש" } }, "blog_posts"],
  ["removeArticle", { op: "removeArticle", id: "post-1" }, "blog_posts"],
  ["createTestimonial", { op: "createTestimonial", draft: { name: "נועה", quote: "ציטוט" } }, "testimonials"],
  ["removeTestimonial", { op: "removeTestimonial", id: "t-1" }, "testimonials"],
];

describe("contentAdmin — the harness reaches it", () => {
  it("refuses a caller with no token with 401", async () => {
    const r = await invokeFunction("contentAdmin", ops[0][1], { env, routes: asAdmin });
    expect(r.status).toBe(401);
  });
});

describe("contentAdmin — the Supabase mirror", () => {
  it("answers 200 with the Base44 id, and stamps that id into Supabase", async () => {
    const r = await invokeFunction("contentAdmin", ops[0][1], { env, headers, routes: asAdminWithBlog });
    expect(r.status).toBe(200);
    const created = r.leads[0] as { id: string }; // the harness records every entity create here
    expect(r.json.id).toBe(created.id);
    const mirror = r.callsTo("/rest/v1/blog_posts").find((c) => c.method === "POST")!;
    expect((mirror.body as { base44_id: string }).base44_id).toBe(created.id);
  });

  it.each(ops)("succeeds on %s when both stores take the write", async (_name, body) => {
    const r = await invokeFunction("contentAdmin", body, { env, headers, routes: asAdminWithBlog });
    expect(r.status).toBe(200);
  });

  it.each(ops)("fails %s with 500 when the mirror write fails", async (_name, body, table) => {
    const r = await invokeFunction("contentAdmin", body, { env, headers, routes: mirrorDown(table) });
    expect(r.status).toBe(500);
    expect(Object.keys(r.json).sort()).toEqual(["error", "rid"]);
  });
});

describe("contentAdmin — retrying a delete after a failed mirror", () => {
  const deletes = ops.filter(([name]) => name.startsWith("remove"));

  it.each(deletes)("%s: a Base44 404 means already gone, and the mirror still runs", async (_name, body, table) => {
    const r = await invokeFunction("contentAdmin", body, { env, headers, routes: asAdmin, leadAlreadyDeleted: true });
    expect(r.status).toBe(200);
    const calls = r.callsTo(`/rest/v1/${table}`);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("DELETE");
  });

  it.each(deletes)("%s: any other Base44 failure still fails the request, with no mirror call", async (_name, body, table) => {
    const r = await invokeFunction("contentAdmin", body, { env, headers, routes: asAdmin, failLeadWrite: true });
    expect(r.status).toBe(500);
    expect(r.callsTo(`/rest/v1/${table}`)).toHaveLength(0);
  });
});

describe("contentAdmin — the article's address (slug)", () => {
  it.each([
    ["no slug", undefined],
    ["an empty slug", ""],
    ["a slug with capitals", "Koteret"],
    ["a slug shaped like a Base44 id", "64f0a1b2c3d4e5f6a7b8c9d0"],
  ])("refuses to create an article with %s, before writing anything", async (_label, slug) => {
    const r = await invokeFunction(
      "contentAdmin",
      { op: "createArticle", draft: { ...draft, slug } },
      { env, headers, routes: asAdminWithBlog },
    );
    expect(r.status).toBe(400);
    expect(Object.keys(r.json).sort()).toEqual(["error", "rid"]);
    expect(r.leads).toHaveLength(0);
    expect(r.callsTo("/rest/v1/blog_posts")).toHaveLength(0);
  });

  it("refuses a slug another article has with 409, before writing Base44", async () => {
    const r = await invokeFunction("contentAdmin", ops[0][1], {
      env,
      headers,
      routes: [...asAdmin, slugHeldBy("other-post"), rowFound],
    });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("הכתובת כבר בשימוש במאמר אחר.");
    expect(r.leads).toHaveLength(0);
    expect(r.callsTo("/rest/v1/blog_posts").filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("writes the slug to the mirror and keeps it out of Base44", async () => {
    const r = await invokeFunction("contentAdmin", ops[0][1], { env, headers, routes: asAdminWithBlog });
    expect(r.status).toBe(200);
    expect(r.leads[0]).not.toHaveProperty("slug");
    const mirror = r.callsTo("/rest/v1/blog_posts").find((c) => c.method === "POST")!;
    expect((mirror.body as { slug: string }).slug).toBe("koteret");
  });

  it("updates the mirror in place with a PATCH of only what changed — a publish toggle has no slug", async () => {
    const r = await invokeFunction(
      "contentAdmin",
      { op: "updateArticle", id: "post-1", draft: { published: false } },
      { env, headers, routes: asAdminWithBlog },
    );
    expect(r.status).toBe(200);
    const [patch] = r.callsTo("/rest/v1/blog_posts?base44_id=eq.post-1");
    expect(patch.method).toBe("PATCH");
    expect(patch.body).toEqual({ published: false });
    expect(r.callsTo("?slug=eq.")).toHaveLength(0);
  });

  it("lets an article keep its own slug, and sends it to the mirror only", async () => {
    const r = await invokeFunction(
      "contentAdmin",
      { op: "updateArticle", id: "post-1", draft: { title: "חדש", slug: "koteret" } },
      { env, headers, routes: [...asAdmin, slugHeldBy("post-1"), rowFound] },
    );
    expect(r.status).toBe(200);
    expect(r.leadUpdates[0].fields).not.toHaveProperty("slug");
    const [patch] = r.callsTo("/rest/v1/blog_posts?base44_id=eq.post-1");
    expect(patch.body).toEqual({ title: "חדש", slug: "koteret" });
  });

  it("fails an update whose mirror row is missing, rather than reporting success", async () => {
    const r = await invokeFunction(
      "contentAdmin",
      { op: "updateArticle", id: "post-1", draft: { published: true } },
      { env, headers, routes: [...asAdmin, slugFree, { match: "/rest/v1/blog_posts?base44_id=eq.", status: 200, json: [] }] },
    );
    expect(r.status).toBe(500);
  });

  it("refuses to rename an article to a slug another one has", async () => {
    const r = await invokeFunction(
      "contentAdmin",
      { op: "updateArticle", id: "post-1", draft: { title: "חדש", slug: "taken" } },
      { env, headers, routes: [...asAdmin, slugHeldBy("other-post"), rowFound] },
    );
    expect(r.status).toBe(409);
    expect(r.leadUpdates).toHaveLength(0);
  });
});
```

In `tests/contract/article-slug.contract.test.ts`, inside `describe("one slug rule, wherever it is spelled", …)`, after the migration case add:

```ts
  it("contentAdmin's copy is the same", () => {
    const fn = read("base44/functions/contentAdmin/entry.ts");
    expect(fn.match(/const SLUG_PATTERN = \/(.+)\/;/)?.[1]).toBe(SLUG_PATTERN.source);
    expect(fn.match(/const BASE44_ID_PATTERN = \/(.+)\/;/)?.[1]).toBe(BASE44_ID_PATTERN.source);
    // The slug is the mirror's alone: Base44's BlogPost has no such field.
    expect(fn.match(/const ARTICLE_FIELDS = \[([^\]]*)\]/)?.[1]).not.toContain("'slug'");
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd $WT && npx vitest run tests/integration/content-admin.integration.test.ts tests/contract/article-slug.contract.test.ts; echo "exit=$?"`
Expected: FAIL, ending with `exit=1`. The slug cases answer 200 instead of 400/409, the update mirror's method is `POST` not `PATCH`, and the contract finds no `SLUG_PATTERN` in `contentAdmin`.

- [ ] **Step 3: Implement in `base44/functions/contentAdmin/entry.ts`**

Replace:
```js
const ARTICLE_FIELDS = ['title', 'excerpt', 'body', 'image_url', 'tags', 'published'];
const TESTIMONIAL_FIELDS = ['name', 'role', 'quote', 'image_url', 'rating', 'source'];
```
with:
```js
const ARTICLE_FIELDS = ['title', 'excerpt', 'body', 'image_url', 'tags', 'published'];
const TESTIMONIAL_FIELDS = ['name', 'role', 'quote', 'image_url', 'rating', 'source'];

/**
 * כתובת המאמר — `/blog/<slug>`. נשמרת רק בעותק של Supabase: ל-BlogPost של
 * Base44 אין שדה כזה, ולכן היא לא ב-ARTICLE_FIELDS ולא נכתבת לשם.
 *
 * אותה תבנית כמו ב-src/lib/articlePath.ts, במיגרציה 20261014000000_blog_slug.sql
 * וב-scripts/published-articles.mjs. משוכפל זה בסדר, מפוצל זה לא —
 * tests/contract/article-slug.contract.test.ts נכשל כשהן נפרדות. כתובת בצורת
 * מזהה Base44 (24 תווים הקסדצימליים) נדחית: vercel.json שולח כל כתובת כזו
 * להפניה של קישורים ישנים, והמאמר לא היה נגיש.
 */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/;
const isValidSlug = (s) => typeof s === 'string' && SLUG_PATTERN.test(s) && !BASE44_ID_PATTERN.test(s);

/**
 * האם מאמר אחר כבר משתמש בכתובת.
 *
 * נבדק לפני הכתיבה ל-Base44: האילוץ הייחודי ב-Supabase היה דוחה רק את השיקוף,
 * אחרי שהשורה ב-Base44 כבר נוצרה — וניסיון חוזר עם כתובת אחרת היה יוצר שורה שנייה.
 */
async function slugTaken(slug, ownId) {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !key) throw new Error('Supabase is not configured');
  const res = await fetch(
    `${url}/rest/v1/blog_posts?slug=eq.${encodeURIComponent(slug)}&select=base44_id`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`slug lookup ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('slug lookup: the answer is not a list');
  return rows.some((r) => r?.base44_id !== ownId);
}
```

In `mirror()`, replace:
```js
    const res = await fetch(`${url}/rest/v1/${table}${query}`, {
      method: op === 'delete' ? 'DELETE' : 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: op === 'delete' ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 140)}`);
    log('info', 'content.mirrored', { rid, table, op });
```
with:
```js
    // 'update' is a PATCH on the one row, not an upsert. An update should
    // touch only what changed (a publish toggle sends `published` alone), and
    // it should fail loudly when the row is missing, not create one.
    const method = op === 'delete' ? 'DELETE' : op === 'update' ? 'PATCH' : 'POST';
    const res = await fetch(`${url}/rest/v1/${table}${query}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: op === 'update' ? 'return=representation' : 'resolution=merge-duplicates,return=minimal',
      },
      body: op === 'delete' ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 140)}`);
    // A PATCH that matched no row changes nothing and reports no error. The site
    // reads this copy, so that is a failed write, not a successful one.
    if (op === 'update') {
      const rows = await res.json().catch(() => null);
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('no Supabase row has this base44_id');
    }
    log('info', 'content.mirrored', { rid, table, op });
```

Replace the two article cases:
```js
      case 'createArticle': {
        const fields = { ...pick(draft, ARTICLE_FIELDS), published: !!draft?.published };
        const row = await base44.asServiceRole.entities.BlogPost.create(fields);
        const newId = row?.id ?? null;
        await mirror(rid, 'upsert', 'blog_posts?on_conflict=base44_id', newId, { ...fields, base44_id: newId });
        result = { ok: true, id: newId };
        break;
      }
      case 'updateArticle': {
        const fields = pick(draft, ARTICLE_FIELDS);
        await base44.asServiceRole.entities.BlogPost.update(id, fields);
        await mirror(rid, 'upsert', 'blog_posts?on_conflict=base44_id', id, { ...fields, base44_id: id });
        break;
      }
```
with:
```js
      case 'createArticle': {
        const slug = draft?.slug;
        if (!isValidSlug(slug)) {
          log('warn', 'article.slug_invalid', { rid, op });
          return json({ error: 'כתובת המאמר חסרה או אינה תקינה.' }, 400);
        }
        if (await slugTaken(slug, null)) {
          log('warn', 'article.slug_taken', { rid, op });
          return json({ error: 'הכתובת כבר בשימוש במאמר אחר.' }, 409);
        }
        const fields = { ...pick(draft, ARTICLE_FIELDS), published: !!draft?.published };
        const row = await base44.asServiceRole.entities.BlogPost.create(fields);
        const newId = row?.id ?? null;
        await mirror(rid, 'upsert', 'blog_posts?on_conflict=base44_id', newId, { ...fields, slug, base44_id: newId });
        result = { ok: true, id: newId };
        break;
      }
      case 'updateArticle': {
        const fields = pick(draft, ARTICLE_FIELDS);
        const slug = draft?.slug;
        if (slug !== undefined) {
          if (!isValidSlug(slug)) {
            log('warn', 'article.slug_invalid', { rid, op });
            return json({ error: 'כתובת המאמר חסרה או אינה תקינה.' }, 400);
          }
          if (await slugTaken(slug, id)) {
            log('warn', 'article.slug_taken', { rid, op });
            return json({ error: 'הכתובת כבר בשימוש במאמר אחר.' }, 409);
          }
        }
        await base44.asServiceRole.entities.BlogPost.update(id, fields);
        await mirror(
          rid, 'update', 'blog_posts', id,
          slug === undefined ? fields : { ...fields, slug },
          `?base44_id=eq.${encodeURIComponent(id)}`,
        );
        break;
      }
```

- [ ] **Step 4: Run the tests and the function contracts**

Run: `cd $WT && npx vitest run tests/integration/content-admin.integration.test.ts tests/contract/article-slug.contract.test.ts tests/contract/logging.contract.test.ts tests/contract/agents.contract.test.ts tests/security; echo "exit=$?"`
Expected: all pass, `exit=0`.

- [ ] **Step 5: AGENTS.md** — after the `src/services/supabase/SupabaseLeadAdminService.ts` bullet (it ends "…an empty answer is an error, never a success."), add:

```
- **An article's address is `blog_posts.slug`, and its rule is spelled four times.**
  Supabase holds it alone (Base44's `BlogPost` has none), so `contentAdmin` sends
  it to the mirror and never to Base44. It is Latin kebab-case and never 24 hex
  characters, because `vercel.json` sends every `/blog/<24 hex>` to
  `api/og/blog.ts`, which answers an old Base44-id link with a 301 to the slug.
  The rule lives in `src/lib/articlePath.ts`, the CHECK in
  `supabase/migrations/20261014000000_blog_slug.sql`, `contentAdmin` and
  `scripts/published-articles.mjs`; `tests/contract/article-slug.contract.test.ts`
  fails when they drift, and when an article link is built by hand instead of
  with `articlePath()`. A partial write to `blog_posts` is a PATCH by
  `base44_id`, never an upsert: it touches only what changed, and fails when
  the row is missing instead of creating one. A row inserted without a slug
  gets `post-<id>` from the `blog_posts_fill_slug` trigger.
```

- [ ] **Step 6: Update the STDs**

`tests/test-plan/12-std-integration.md`, before `## 5. Pass criteria`:
```
### 4.24 `contentAdmin` — the article's address — `INT-CNT-001..007`

`content-admin.integration.test.ts`. The slug is the Supabase mirror's alone,
so it is validated and checked for uniqueness before Base44 is written — a
refusal from the mirror's unique constraint would arrive after the Base44 row
exists. An update is a PATCH by `base44_id` carrying only what changed, so a
publish toggle touches `published` and nothing else; a PATCH that finds no row
is a failure, never a silently created row.

| ID | Title | Expected result |
|---|---|---|
| INT-CNT-001 | "refuses to create an article with %s, before writing anything" (4) | 400 with `error` and `rid`; no Base44 create; no `blog_posts` call |
| INT-CNT-002 | "refuses a slug another article has with 409, before writing Base44" | 409 "הכתובת כבר בשימוש במאמר אחר."; no create, no mirror POST |
| INT-CNT-003 | "writes the slug to the mirror and keeps it out of Base44" | Base44 fields have no `slug`; the mirror POST has `slug: koteret` |
| INT-CNT-004 | "updates the mirror in place with a PATCH of only what changed" | `PATCH …?base44_id=eq.post-1` with `{ published: false }`; no slug lookup |
| INT-CNT-005 | "lets an article keep its own slug, and sends it to the mirror only" | 200; Base44 update has no `slug`; PATCH carries it |
| INT-CNT-006 | "fails an update whose mirror row is missing" | 500 |
| INT-CNT-007 | "refuses to rename an article to a slug another one has" | 409; no Base44 update |
```
In §5 change `All 284 cases pass.` to `All 294 cases pass.`

`tests/test-plan/03-std-contract.md`, at the end of the §4.8 table:
```
| CTR-SLUG-007 | "contentAdmin's copy is the same" | Both patterns equal `articlePath.ts`'s; `ARTICLE_FIELDS` has no `slug` |
```
In §6 change `All 552 cases pass.` to `All 553 cases pass.`

- [ ] **Step 7: Commit**

```bash
cd $WT && git add base44/functions/contentAdmin/entry.ts tests/integration/content-admin.integration.test.ts tests/contract/article-slug.contract.test.ts AGENTS.md tests/test-plan/12-std-integration.md tests/test-plan/03-std-contract.md && git commit -m "$(cat <<'EOF'
SEO PR1: contentAdmin writes the slug to the Supabase mirror only

Validated and checked for uniqueness before Base44 is written; an update
mirrors as a PATCH of what changed, and a PATCH that finds no row fails.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ
EOF
)"
```

---

### Task 6: The admin form's slug field

**Files:**
- Modify: `src/pages/BlogAdmin.tsx`: imports L1-23, `BlogPostEdit`/`EMPTY`/`toEdit` L27-56, `save()` payload L117-126, the form after the title block (~L177-185), the save button `disabled` (~L271)
- Test: `tests/component/blog-admin-slug.test.tsx` (new)
- Modify: `tests/contract/frontend-payloads.contract.test.ts` L456-468, `tests/contract/article-slug.contract.test.ts` (list)
- Modify: `tests/test-plan/02-std-component.md`, `tests/test-plan/03-std-contract.md`

**Interfaces:**
- Consumes: `articlePath`, `slugProblem`, `SLUG_PROBLEMS`, `SLUG_TAKEN` (Task 1). `Article.slug` from the admin list (Supabase reads, Task 3).
- Produces: the `BlogAdmin` payload literal gains `slug`. The field is `#blog-slug`, labelled "כתובת המאמר (slug) *". A `role="status"` warning appears when a published article's slug changes.

- [ ] **Step 1: Write the failing test** — `tests/component/blog-admin-slug.test.tsx`

```tsx
/**
 * @vitest-environment jsdom
 *
 * The admin article form's address field: prefilled for an existing article,
 * refused unless it can be one, and a warning before a published article's
 * address changes (there is no redirect table — the old address will 404).
 * The hooks are stubbed; the writes are contentAdmin's, covered in
 * tests/integration/content-admin.integration.test.ts.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SLUG_PROBLEMS, SLUG_TAKEN } from "@/lib/articlePath";

const h = vi.hoisted(() => ({
  articles: [
    {
      id: "64f0a1b2c3d4e5f6a7b8c9d0",
      slug: "horadat-dmei-nihul",
      title: "להוריד דמי ניהול",
      body: "גוף",
      published: true,
      created_date: "2026-10-01T09:00:00Z",
    },
    {
      id: "64f0a1b2c3d4e5f6a7b8c9d1",
      slug: "mutavim",
      title: "מוטבים",
      body: "גוף",
      published: false,
      created_date: "2026-10-02T09:00:00Z",
    },
  ],
  save: vi.fn(async (_args: unknown) => {}),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useAdminArticles: () => ({ data: h.articles, isPending: false, isError: false }),
  useSaveArticle: () => ({ mutateAsync: h.save, isPending: false }),
  useSetArticlePublished: () => ({ mutate: vi.fn(), isError: false }),
  useRemoveArticle: () => ({ mutate: vi.fn(), isError: false }),
}));
vi.mock("@/services", () => ({ services: { uploads: { upload: vi.fn() } } }));

const { default: BlogAdmin } = await import("@/pages/BlogAdmin");

const renderAdmin = () =>
  render(
    <MemoryRouter>
      <BlogAdmin />
    </MemoryRouter>,
  );
const slugInput = () => screen.getByLabelText(/כתובת המאמר/) as HTMLInputElement;
const saveButton = () => screen.getByRole("button", { name: /שמירה/ }) as HTMLButtonElement;
const edit = (i: number) => fireEvent.click(screen.getAllByRole("button", { name: "עריכה" })[i]);
const typeSlug = (value: string) => fireEvent.change(slugInput(), { target: { value } });

beforeEach(() => h.save.mockClear());

describe("the article's address in the admin form", () => {
  it("prefills an existing article's slug", () => {
    renderAdmin();
    edit(0);
    expect(slugInput().value).toBe("horadat-dmei-nihul");
  });

  it("asks for one on a new article, and will not save without it", () => {
    renderAdmin();
    fireEvent.click(screen.getByRole("button", { name: /מאמר חדש/ }));
    expect(screen.getByText(SLUG_PROBLEMS.missing)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it.each([
    ["Dmei Nihul", SLUG_PROBLEMS.format],
    ["64f0a1b2c3d4e5f6a7b8c9d0", SLUG_PROBLEMS.base44Id],
    ["mutavim", SLUG_TAKEN],
  ])("refuses %j", (value, message) => {
    renderAdmin();
    edit(0);
    typeSlug(value);
    expect(screen.getByText(message)).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it("warns before a published article's address changes", () => {
    renderAdmin();
    edit(0);
    typeSlug("dmei-nihul");
    expect(screen.getByRole("status").textContent).toMatch(/ישבור קישורים/);
    expect(screen.getByRole("status").textContent).toContain("/blog/horadat-dmei-nihul");
  });

  it("does not warn for a draft, which nobody links to yet", () => {
    renderAdmin();
    edit(1);
    typeSlug("mutavim-2026");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("sends the slug with the article", async () => {
    renderAdmin();
    edit(0);
    typeSlug("dmei-nihul-2026");
    fireEvent.click(saveButton());
    await vi.waitFor(() => expect(h.save).toHaveBeenCalledTimes(1));
    expect(h.save).toHaveBeenCalledWith({
      id: "64f0a1b2c3d4e5f6a7b8c9d0",
      draft: expect.objectContaining({ slug: "dmei-nihul-2026" }),
    });
  });
});
```

In `tests/contract/frontend-payloads.contract.test.ts`, replace the first case of `describe("BlogPost writes match the BlogPost entity", …)`:
```ts
  it("the admin payload carries title and body and nothing undeclared", () => {
    const adminPayload = findObjectLiteralCalls(/const payload\s*=\s*/).find(
      (c) => c.file === "src/pages/BlogAdmin.tsx"
    );
    expect(adminPayload, "BlogAdmin payload literal").toBeDefined();
    expect(adminPayload!.keys.filter((k) => !(k in blogPost.properties))).toEqual([]);
```
with:
```ts
  /** Sent by the form, stored by the Supabase mirror only — contentAdmin keeps it out of the Base44 write. */
  const MIRROR_ONLY = ["slug"];

  it("keeps the mirror-only fields off the BlogPost entity", () => {
    for (const key of MIRROR_ONLY) {
      expect(key in blogPost.properties, `${key} became a Base44 field — drop it from MIRROR_ONLY`).toBe(false);
    }
  });

  it("the admin payload carries title and body and nothing undeclared", () => {
    const adminPayload = findObjectLiteralCalls(/const payload\s*=\s*/).find(
      (c) => c.file === "src/pages/BlogAdmin.tsx"
    );
    expect(adminPayload, "BlogAdmin payload literal").toBeDefined();
    expect(adminPayload!.keys).toContain("slug");
    expect(adminPayload!.keys.filter((k) => !(k in blogPost.properties) && !MIRROR_ONLY.includes(k))).toEqual([]);
```

In `tests/contract/article-slug.contract.test.ts`, add `"src/pages/BlogAdmin.tsx",` to the `it.each([...])` list of files that link through `articlePath`.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd $WT && npx vitest run tests/component/blog-admin-slug.test.tsx tests/contract/frontend-payloads.contract.test.ts tests/contract/article-slug.contract.test.ts; echo "exit=$?"`
Expected: FAIL, ending with `exit=1`. The output shows `Unable to find a label with the text of: /כתובת המאמר/`, `expected [ …keys ] to contain 'slug'`, and `BlogAdmin.tsx` lacks `articlePath(`.

- [ ] **Step 3: Implement in `src/pages/BlogAdmin.tsx`**

After `import { Image } from "@/components/ui/image";` add:
```ts
import { SLUG_TAKEN, articlePath, slugProblem } from "@/lib/articlePath";
```

Replace the `BlogPostEdit` interface, `EMPTY` and `toEdit` with:
```tsx
interface BlogPostEdit {
  id?: string;
  title: string;
  /** The article's address, `/blog/<slug>`. Stored in the Supabase mirror only. */
  slug: string;
  /** The slug the article had when the editor opened — the address links already use. */
  originalSlug: string;
  /** Whether the article was live when the editor opened, so links to it may exist. */
  wasPublished: boolean;
  excerpt: string;
  body: string;
  image_url: string;
  tags: string;
  published: boolean;
}

const EMPTY: BlogPostEdit = {
  title: "",
  slug: "",
  originalSlug: "",
  wasPublished: false,
  excerpt: "",
  body: "",
  image_url: "",
  tags: "",
  published: false,
};

/** A stored article, with the optional fields the editor needs as strings. */
const toEdit = (p: BlogPostItem): BlogPostEdit => ({
  id: p.id,
  title: p.title,
  slug: p.slug ?? "",
  originalSlug: p.slug ?? "",
  wasPublished: !!p.published,
  excerpt: p.excerpt ?? "",
  body: p.body ?? "",
  image_url: p.image_url ?? "",
  tags: p.tags ?? "",
  published: !!p.published,
});
```

After `const writeError = …;` add:
```tsx
  // The form's own list holds every article's slug (drafts included), so a
  // taken one is caught here; contentAdmin refuses it again with 409.
  const slugError = editing
    ? slugProblem(editing.slug) ??
      (posts.some((p) => p.slug === editing.slug && p.id !== editing.id) ? SLUG_TAKEN : null)
    : null;
  // There is no redirect table: a published article's old address will 404.
  const slugChanged = Boolean(
    editing?.id && editing.wasPublished && editing.originalSlug && editing.slug !== editing.originalSlug,
  );
```

In `save()`, replace `    if (!editing || !editing.title || !editing.body) return;` with:
```tsx
    if (!editing || !editing.title || !editing.body || slugError) return;
```
and replace the payload literal and its comment:
```tsx
    // Kept as a literal object: tests/contract/frontend-payloads pins its keys
    // to the BlogPost entity schema.
    const payload = {
      title: editing.title,
      excerpt: editing.excerpt,
      body: editing.body,
      tags: editing.tags,
      published: !!editing.published,
      image_url,
    };
```
with:
```tsx
    // Kept as a literal object: tests/contract/frontend-payloads pins its keys
    // to the BlogPost entity schema. `slug` is the one exception, sent for the
    // Supabase mirror only (contentAdmin keeps it out of the Base44 write).
    const payload = {
      title: editing.title,
      slug: editing.slug,
      excerpt: editing.excerpt,
      body: editing.body,
      tags: editing.tags,
      published: !!editing.published,
      image_url,
    };
```

In the form, insert this block straight after the closing `</div>` of the title field (the `md:col-span-2` div whose label reads `כותרת *`):
```tsx
              <div className="md:col-span-2">
                <label
                  htmlFor="blog-slug"
                  className="block text-xs tracking-[0.15em] uppercase text-muted-foreground mb-2"
                >
                  כתובת המאמר (slug) *
                </label>
                <input
                  id="blog-slug"
                  dir="ltr"
                  value={editing.slug}
                  onChange={(e) => setEditing({ ...editing, slug: e.target.value.toLowerCase() })}
                  placeholder="horadat-dmei-nihul"
                  aria-describedby="blog-slug-path"
                  aria-invalid={slugError ? true : undefined}
                  className="w-full bg-background border border-border px-4 py-3 font-mono text-sm focus:outline-none focus:border-accent transition-colors"
                />
                <p id="blog-slug-path" dir="ltr" className="mt-2 text-xs text-muted-foreground">
                  {articlePath({ id: editing.id ?? "", slug: editing.slug })}
                </p>
                {slugError ? (
                  <p aria-live="polite" className="mt-1 text-sm text-destructive">
                    {slugError}
                  </p>
                ) : null}
                {slugChanged ? (
                  <p role="status" className="mt-1 text-sm text-accent">
                    שינוי הכתובת של מאמר שפורסם ישבור קישורים קיימים אליו:{" "}
                    <span dir="ltr">{articlePath({ id: "", slug: editing.originalSlug })}</span> תחזיר "המאמר לא נמצא".
                  </p>
                ) : null}
              </div>
```

Replace the save button's `disabled={busy || !editing.title || !editing.body}` with:
```tsx
                  disabled={busy || !editing.title || !editing.body || Boolean(slugError)}
```

- [ ] **Step 4: Run the tests, lint and typecheck**

Run: `cd $WT && npx vitest run tests/component tests/contract; echo "exit=$?"; npm run lint; echo "exit=$?"; npm run typecheck; echo "exit=$?"`
Expected: all pass, and all three lines read `exit=0`.

- [ ] **Step 5: Update the STDs**

`tests/test-plan/02-std-component.md`, before `## 5. Pass criteria`:
```
### 4.16 `<BlogAdmin />` — the article's address — `tests/component/blog-admin-slug.test.tsx`

The hooks are stubbed; contentAdmin repeats every refusal server-side (§4.24 of STD-12).

| ID | Title | Expected result |
|---|---|---|
| CMP-BADM-001 | "prefills an existing article's slug" | `horadat-dmei-nihul` |
| CMP-BADM-002 | "asks for one on a new article, and will not save without it" | `SLUG_PROBLEMS.missing`; save disabled |
| CMP-BADM-003 | "refuses %j" (3) | Format, Base44-id and taken messages; save disabled |
| CMP-BADM-004 | "warns before a published article's address changes" | `role="status"` naming `/blog/horadat-dmei-nihul` |
| CMP-BADM-005 | "does not warn for a draft, which nobody links to yet" | No status |
| CMP-BADM-006 | "sends the slug with the article" | `mutateAsync({ id, draft: { …, slug } })` |
```
In §5 change `All 80 cases pass.` to `All 88 cases pass.`

`tests/test-plan/03-std-contract.md`: in §4.2 (Frontend payloads), add a sentence at the end of its prose: "`slug` is the one key the admin's BlogPost payload may carry that the entity lacks — it is the Supabase mirror's alone — and a case fails if it ever becomes a Base44 field." In §4.8 change the CTR-SLUG-006 title to `(6 files)` and add BlogAdmin to its expected-result list. In §6 change `All 553 cases pass.` to `All 555 cases pass.`

- [ ] **Step 6: Commit**

```bash
cd $WT && git add src/pages/BlogAdmin.tsx tests/component/blog-admin-slug.test.tsx tests/contract/frontend-payloads.contract.test.ts tests/contract/article-slug.contract.test.ts tests/test-plan/02-std-component.md tests/test-plan/03-std-contract.md && git commit -m "$(cat <<'EOF'
SEO PR1: the admin form asks for the article's slug

Required, Latin kebab-case, not a Base44-id shape and not another
article's; prefilled for existing articles, with a warning before a
published article's address changes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ
EOF
)"
```

---

### Task 7: Prebuild every published article

**Files:**
- Create: `scripts/published-articles.mjs`
- Modify: `scripts/prerender.mjs` (whole file)
- Create: `e2e/fixtures/prerender-articles.json`
- Modify: `playwright.config.ts` (webServer `env`, ~L147-170)
- Modify: `scripts/run-tests.sh` (after L150)
- Modify: `.github/workflows/ci.yml`, `build` job, step `Build` (~L172-177)
- Test: `tests/unit/published-articles.test.ts` (new), `e2e/seo/prerender.spec.ts`, `tests/contract/article-slug.contract.test.ts` (one case)
- Modify: `README.md` ("Prerendering closes it"), `tests/test-plan/11-std-seo.md`, `tests/test-plan/01-std-unit.md`, `tests/test-plan/03-std-contract.md`

**Interfaces:**
- Consumes:
  - Supabase `blog_posts` (Task 2) through REST with the publishable key.
  - Vite's `loadEnv`.
  - In fixture mode, the page's Base44 `GET …/entities/BlogPost/<key>`.
- Produces (`scripts/published-articles.mjs`):
  - `SLUG_PATTERN`, `BASE44_ID_PATTERN`, `isValidSlug(slug)`, `articleRoute(slug) → "/blog/<slug>"`
  - `fetchPublishedArticles({ url, key, columns = "slug,updated_at", fetchImpl = fetch }) → Promise<row[]>`. **PR 2 reuses this** with columns `slug,title,excerpt,body,updated_at`.
  - `planArticles(env, { fetchImpl, readFileImpl }) → Promise<{ routes: string[], fixtureRows: object[] | null, warning: string | null }>`
  - `fixtureArticleFor(requestUrl, rows) → row | null`
  - `duplicateTitles(results: { route, title }[]) → { title, routes }[]`
- Env:
  - `PRERENDER_ARTICLES_FIXTURE`: path to a JSON list of Base44-shaped rows with `slug`. Test builds only.
  - `PRERENDER_REQUIRED=1`.

- [ ] **Step 1: Write the failing unit tests** — `tests/unit/published-articles.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import {
  articleRoute,
  duplicateTitles,
  fetchPublishedArticles,
  fixtureArticleFor,
  isValidSlug,
  planArticles,
  // @ts-expect-error — plain .mjs tooling, imported for its pure steps.
} from "../../scripts/published-articles.mjs";

/**
 * The published articles, as the build sees them — the list prerender.mjs
 * prebuilds a page for, and that PR 2's sitemap and llms.txt will read.
 * What is worth pinning is that an answer that cannot be trusted is never
 * "no articles", and that test articles can never reach a deployment.
 */

const URL_ = "https://project-ref.supabase.co";
const KEY = "sb_publishable_test";
const SUPABASE_ENV = { VITE_SUPABASE_URL: URL_, VITE_SUPABASE_PUBLISHABLE_KEY: KEY };
const FIXTURE = [
  {
    id: "e2e-article-1",
    slug: "bdikat-maslul-e2e",
    title: "t",
    body: "b",
    published: true,
    created_date: "2026-10-01T09:00:00Z",
  },
];

const answer = (body: unknown, status = 200) =>
  vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
const readFixture = (rows: unknown) => vi.fn(async (_path: string, _enc: string) => JSON.stringify(rows));

describe("fetchPublishedArticles", () => {
  it("asks PostgREST for published rows, newest first, with the publishable key", async () => {
    const fetchImpl = answer([{ slug: "a", updated_at: "2026-10-01" }]);
    await fetchPublishedArticles({ url: `${URL_}/`, key: KEY, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${URL_}/rest/v1/blog_posts`);
    expect(u.searchParams.get("select")).toBe("slug,updated_at");
    expect(u.searchParams.get("published")).toBe("eq.true");
    expect(u.searchParams.get("order")).toBe("created_at.desc");
    const sent = init!.headers as Record<string, string>;
    expect(sent.apikey).toBe(KEY);
    expect(sent.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("selects the columns it is asked for", async () => {
    const fetchImpl = answer([]);
    await fetchPublishedArticles({ url: URL_, key: KEY, columns: "slug,title,excerpt,updated_at", fetchImpl });
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("select")).toBe("slug,title,excerpt,updated_at");
  });

  it("returns the rows", async () => {
    const rows = [{ slug: "a" }, { slug: "b" }];
    expect(await fetchPublishedArticles({ url: URL_, key: KEY, fetchImpl: answer(rows) })).toEqual(rows);
  });

  it("throws on a refusal, naming the status", async () => {
    await expect(
      fetchPublishedArticles({ url: URL_, key: KEY, fetchImpl: answer({ message: "Invalid API key" }, 401) }),
    ).rejects.toThrow(/HTTP 401/);
  });

  it("throws on an answer that is not a list — never 'no articles'", async () => {
    await expect(fetchPublishedArticles({ url: URL_, key: KEY, fetchImpl: answer({}) })).rejects.toThrow(/not a list/);
  });

  it.each(["../escape", "Bad", "64f0a1b2c3d4e5f6a7b8c9d0", null])(
    "refuses a row whose slug %j could not be a file under dist/blog",
    async (slug) => {
      await expect(
        fetchPublishedArticles({ url: URL_, key: KEY, fetchImpl: answer([{ slug }]) }),
      ).rejects.toThrow(/unusable slug/);
    },
  );
});

describe("planArticles", () => {
  it("lists the published articles as /blog/<slug> routes", async () => {
    const plan = await planArticles(SUPABASE_ENV, { fetchImpl: answer([{ slug: "a" }, { slug: "b" }]) });
    expect(plan).toEqual({ routes: ["/blog/a", "/blog/b"], fixtureRows: null, warning: null });
  });

  it("warns, and prebuilds no article, when Supabase is not configured", async () => {
    const fetchImpl = answer([]);
    const plan = await planArticles({}, { fetchImpl });
    expect(plan.routes).toEqual([]);
    expect(plan.warning).toMatch(/VITE_SUPABASE_URL/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails when articles are required and Supabase is not configured", async () => {
    await expect(planArticles({ PRERENDER_REQUIRED: "1" }, { fetchImpl: answer([]) })).rejects.toThrow(
      /VITE_SUPABASE_URL/,
    );
  });

  it("warns when Supabase cannot be read and articles are not required", async () => {
    const plan = await planArticles(SUPABASE_ENV, { fetchImpl: answer({ message: "down" }, 503) });
    expect(plan.routes).toEqual([]);
    expect(plan.warning).toMatch(/HTTP 503/);
  });

  it("fails when Supabase cannot be read and articles are required", async () => {
    await expect(
      planArticles({ ...SUPABASE_ENV, PRERENDER_REQUIRED: "1" }, { fetchImpl: answer({ message: "down" }, 503) }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it("takes the fixture's articles in the e2e build, without asking Supabase", async () => {
    const fetchImpl = answer([]);
    const plan = await planArticles(
      { PRERENDER_ARTICLES_FIXTURE: "e2e/fixtures/prerender-articles.json", PRERENDER_REQUIRED: "1" },
      { fetchImpl, readFileImpl: readFixture(FIXTURE) },
    );
    expect(plan.routes).toEqual(["/blog/bdikat-maslul-e2e"]);
    expect(plan.fixtureRows).toEqual(FIXTURE);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([[{ VERCEL: "1" }], [{ VERCEL_ENV: "production" }]])(
    "refuses the fixture in a Vercel build (%j)",
    async (vercel) => {
      await expect(
        planArticles({ PRERENDER_ARTICLES_FIXTURE: "f.json", ...vercel }, { readFileImpl: readFixture(FIXTURE) }),
      ).rejects.toThrow(/Vercel build/);
    },
  );

  it("refuses the fixture in a bundle that reads Supabase", async () => {
    await expect(
      planArticles({ PRERENDER_ARTICLES_FIXTURE: "f.json", ...SUPABASE_ENV }, { readFileImpl: readFixture(FIXTURE) }),
    ).rejects.toThrow(/reads Supabase/);
  });

  it("refuses a fixture article with an unusable slug", async () => {
    await expect(
      planArticles({ PRERENDER_ARTICLES_FIXTURE: "f.json" }, { readFileImpl: readFixture([{ slug: "Bad" }]) }),
    ).rejects.toThrow(/unusable slug/);
  });
});

describe("fixtureArticleFor", () => {
  it("answers the page's Base44 read by the slug at the end of its URL", () => {
    expect(
      fixtureArticleFor("http://127.0.0.1:4183/api/apps/e2e-sanity-app/entities/BlogPost/bdikat-maslul-e2e", FIXTURE),
    ).toBe(FIXTURE[0]);
  });

  it("answers null for any other key", () => {
    expect(fixtureArticleFor("http://127.0.0.1:4183/api/apps/x/entities/BlogPost/other", FIXTURE)).toBeNull();
  });
});

describe("duplicateTitles", () => {
  it("names each title more than one route was rendered with", () => {
    expect(
      duplicateTitles([
        { route: "/", title: "א" },
        { route: "/blog/x", title: "ב" },
        { route: "/blog/y", title: "ב" },
      ]),
    ).toEqual([{ title: "ב", routes: ["/blog/x", "/blog/y"] }]);
  });

  it("is empty when every title is distinct", () => {
    expect(duplicateTitles([{ route: "/", title: "א" }, { route: "/faq", title: "ב" }])).toEqual([]);
  });
});

describe("isValidSlug and articleRoute", () => {
  it("are the app's rule and address", () => {
    expect(isValidSlug("horadat-dmei-nihul")).toBe(true);
    expect(isValidSlug("64f0a1b2c3d4e5f6a7b8c9d0")).toBe(false);
    expect(articleRoute("horadat-dmei-nihul")).toBe("/blog/horadat-dmei-nihul");
  });
});
```

In `tests/contract/article-slug.contract.test.ts`, add after the `@ts-expect-error … seed-blog.mjs` import:
```ts
// @ts-expect-error — plain .mjs tooling, imported for its copy of the rule.
import * as published from "../../scripts/published-articles.mjs";
```
and inside `describe("one slug rule, wherever it is spelled", …)` add:
```ts
  it("the build's copy is the same", () => {
    expect(published.SLUG_PATTERN.source).toBe(SLUG_PATTERN.source);
    expect(published.BASE44_ID_PATTERN.source).toBe(BASE44_ID_PATTERN.source);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd $WT && npx vitest run tests/unit/published-articles.test.ts tests/contract/article-slug.contract.test.ts; echo "exit=$?"`
Expected: FAIL with `Failed to load url ../../scripts/published-articles.mjs` (or `Cannot find module`), then `exit=1`.

- [ ] **Step 3: Write `scripts/published-articles.mjs`**

```js
// The published articles, as the build sees them.
//
// One module for every build step that needs the list, so they cannot disagree
// about what is published: scripts/prerender.mjs today (a prebuilt page per
// article), and the sitemap and llms.txt generator after it.
//
// Read from Supabase's REST API with the publishable key — the same anonymous
// read the site makes — so row-level security returns published rows only. The
// `published=eq.true` filter says so explicitly as well.

import { readFile } from 'node:fs/promises'

/**
 * Latin kebab-case, never shaped like a Base44 id. The same rule as
 * src/lib/articlePath.ts, the slug migration's CHECK and contentAdmin —
 * tests/contract/article-slug.contract.test.ts fails when they drift.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/

export const isValidSlug = (slug) =>
  typeof slug === 'string' && SLUG_PATTERN.test(slug) && !BASE44_ID_PATTERN.test(slug)

/** The address an article is prebuilt at. */
export const articleRoute = (slug) => `/blog/${slug}`

/** A slug becomes a file name under dist/blog/, so one that is not kebab-case is never used. */
function assertSlugs(rows, source) {
  for (const row of rows) {
    if (!isValidSlug(row?.slug)) {
      throw new Error(`${source}: a published article has an unusable slug: ${JSON.stringify(row?.slug)}`)
    }
  }
}

/**
 * Every published article's row, newest first.
 *
 * `columns` must include `slug`. Throws — never returns an empty list — when
 * the read fails or the answer cannot be trusted: "no articles" would build a
 * site with no article pages and look like success.
 */
export async function fetchPublishedArticles({ url, key, columns = 'slug,updated_at', fetchImpl = fetch }) {
  const params = new URLSearchParams({ select: columns, published: 'eq.true', order: 'created_at.desc' })
  const res = await fetchImpl(`${url.replace(/\/+$/, '')}/rest/v1/blog_posts?${params}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`blog_posts read failed: HTTP ${res.status}`)
  const rows = await res.json().catch(() => null)
  if (!Array.isArray(rows)) throw new Error('blog_posts read failed: the answer is not a list')
  assertSlugs(rows, 'blog_posts')
  return rows
}

/**
 * Which articles this build prebuilds, decided from the build's environment.
 *
 *   PRERENDER_ARTICLES_FIXTURE   A JSON file of Base44-shaped rows with a slug,
 *                                for the e2e build: hermetic, no Supabase. The
 *                                page's Base44 read is answered from it. Refused
 *                                in a Vercel build and in a bundle that reads
 *                                Supabase, so test articles never ship.
 *   VITE_SUPABASE_URL +
 *   VITE_SUPABASE_PUBLISHABLE_KEY  The live list.
 *   PRERENDER_REQUIRED=1         A list that cannot be had fails the build —
 *                                production must not ship a blog without its
 *                                pages. Without it the build warns and
 *                                prebuilds the static routes only.
 *
 * Returns the routes to add, the fixture rows (null outside fixture mode) and a
 * warning to print (null when there is nothing to say). Throws when the build
 * must stop.
 */
export async function planArticles(env, { fetchImpl = fetch, readFileImpl = readFile } = {}) {
  const required = env.PRERENDER_REQUIRED === '1'
  const url = (env.VITE_SUPABASE_URL ?? '').trim()
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()
  const fixture = (env.PRERENDER_ARTICLES_FIXTURE ?? '').trim()

  if (fixture) {
    if (env.VERCEL === '1' || env.VERCEL_ENV) {
      throw new Error(
        'PRERENDER_ARTICLES_FIXTURE is set in a Vercel build — refusing to prebuild test articles into a deployment.',
      )
    }
    if (url && key) {
      throw new Error(
        'PRERENDER_ARTICLES_FIXTURE answers Base44 reads, but this bundle reads Supabase. ' +
          'Build with VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY empty.',
      )
    }
    const rows = JSON.parse(await readFileImpl(fixture, 'utf8'))
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${fixture}: expected a non-empty list of articles`)
    assertSlugs(rows, fixture)
    return { routes: rows.map((r) => articleRoute(r.slug)), fixtureRows: rows, warning: null }
  }

  if (!url || !key) {
    const why =
      'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not both set, so the published articles cannot be listed'
    if (required) throw new Error(`${why}.`)
    return { routes: [], fixtureRows: null, warning: `${why}; articles are not prebuilt.` }
  }

  try {
    const rows = await fetchPublishedArticles({ url, key, fetchImpl })
    return { routes: [...new Set(rows.map((r) => articleRoute(r.slug)))], fixtureRows: null, warning: null }
  } catch (err) {
    if (required) throw err
    return {
      routes: [],
      fixtureRows: null,
      warning: `Could not list the published articles (${err.message}); articles are not prebuilt.`,
    }
  }
}

/** The fixture row a prerendered page's Base44 read asks for, by the key at the end of its URL. */
export function fixtureArticleFor(requestUrl, rows) {
  const key = decodeURIComponent(new URL(requestUrl).pathname.split('/').pop() ?? '')
  return rows.find((r) => r.slug === key) ?? null
}

/** Each title more than one route was rendered with, and the routes that share it. */
export function duplicateTitles(results) {
  const byTitle = new Map()
  for (const { route, title } of results) byTitle.set(title, [...(byTitle.get(title) ?? []), route])
  return [...byTitle]
    .filter(([, routes]) => routes.length > 1)
    .map(([title, routes]) => ({ title, routes }))
}
```

- [ ] **Step 4: Run the unit tests**

Run: `cd $WT && npx vitest run tests/unit/published-articles.test.ts tests/contract/article-slug.contract.test.ts; echo "exit=$?"`
Expected: all pass (24 + the contract cases), `exit=0`.

- [ ] **Step 5: Write the e2e fixture and the failing e2e case**

`e2e/fixtures/prerender-articles.json`:
```json
[
  {
    "id": "e2e-article-1",
    "slug": "bdikat-maslul-e2e",
    "title": "בדיקת מסלול ההשקעה — מאמר לבדיקת הבנייה המוקדמת",
    "excerpt": "מאמר בדיקה שנבנה מראש בסביבת הבדיקות בלבד.",
    "body": "## מה בודקים\n\nבדיקה שנתית של מסלול ההשקעה לוקחת רבע שעה ונעשית באזור האישי של הקרן.\n",
    "tags": "פנסיה",
    "published": true,
    "created_date": "2026-10-01T09:00:00Z"
  }
]
```

In `e2e/seo/prerender.spec.ts`, replace the first line `import { expect, test, test_step } from "../fixtures/app";` with:
```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, test_step } from "../fixtures/app";

/**
 * The one article the e2e build prebuilds (PRERENDER_ARTICLES_FIXTURE, set in
 * playwright.config.ts, scripts/run-tests.sh and CI's build job). The build
 * has no Supabase, so the prerender answers the page's read from this file —
 * hermetic, and refused anywhere it could reach a deployment.
 */
const [ARTICLE] = JSON.parse(
  readFileSync(join(process.cwd(), "e2e/fixtures/prerender-articles.json"), "utf8"),
) as Array<{ slug: string; title: string; body: string }>;
const ARTICLE_PATH = `/blog/${ARTICLE.slug}`;
/** The first prose line of the body — what a crawler must be able to quote. */
const ARTICLE_SENTENCE = ARTICLE.body
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l && !l.startsWith("#"))!;
```
Add a ninth entry to `PRERENDERED`, after `{ path: "/accessibility", titleContains: "נגישות" },`:
```ts
  { path: ARTICLE_PATH, titleContains: ARTICLE.title },
```
Add, inside the `test.describe`, after the FAQ case:
```ts
  test("an article is served as full HTML: its body, its canonical and its BlogPosting", async ({ request }) => {
    // The point of prebuilding articles: an assistant that does not run
    // JavaScript can quote the article itself, under its own address.
    const html = await test_step(`fetch ${ARTICLE_PATH} without a browser`, async () => {
      const res = await request.get(ARTICLE_PATH);
      expect(res.status(), `${ARTICLE_PATH} did not return 200`).toBe(200);
      return res.text();
    });

    await test_step("the body text is in the HTML", async () => {
      expect(html.replace(/<[^>]+>/g, " ")).toContain(ARTICLE_SENTENCE);
    });

    await test_step("the canonical is the article's slug address", async () => {
      expect(new URL(canonicalOf(html)).pathname).toBe(ARTICLE_PATH);
    });

    await test_step("BlogPosting names the article and the same address", async () => {
      const posting = jsonLdOf(html).find((b) => b["@type"] === "BlogPosting");
      expect(posting, "no BlogPosting markup in the served HTML").toBeTruthy();
      expect(posting.headline).toBe(ARTICLE.title);
      expect(new URL(posting.mainEntityOfPage["@id"]).pathname).toBe(ARTICLE_PATH);
    });
  });
```

In `playwright.config.ts`, inside `webServer.env`, after `VITE_SUPABASE_PUBLISHABLE_KEY: "",` add:
```ts
          // One fixture article for the prerender to prebuild. The build has no
          // Supabase (above), so the article list comes from this file and the
          // page's Base44 read is answered from it — scripts/published-articles.mjs.
          PRERENDER_ARTICLES_FIXTURE: "e2e/fixtures/prerender-articles.json",
```

In `scripts/run-tests.sh`, after the line `    export VITE_SUPABASE_PUBLISHABLE_KEY=""` add:
```bash
    # The one article the e2e build prebuilds, without Supabase — see playwright.config.ts.
    export PRERENDER_ARTICLES_FIXTURE="e2e/fixtures/prerender-articles.json"
```

In `.github/workflows/ci.yml`, `build` job, replace:
```yaml
      - name: Build
        env:
          # Fail here if the browser is unavailable, rather than shipping a
          # plain bundle that fails the prerender suite three jobs later.
          PRERENDER_REQUIRED: "1"
        run: npm run build:prerender
```
with:
```yaml
      - name: Build
        env:
          # Fail here if the browser is unavailable, rather than shipping a
          # plain bundle that fails the prerender suite three jobs later.
          PRERENDER_REQUIRED: "1"
          # This bundle is the e2e artifact and has no Supabase, so it prebuilds
          # one fixture article instead of the live list. Refused in any Vercel
          # build; workflow.contract.test.ts keeps it out of every other job.
          PRERENDER_ARTICLES_FIXTURE: e2e/fixtures/prerender-articles.json
        run: npm run build:prerender
```

Run: `cd $WT && npx playwright install chromium && CI=1 npx playwright test e2e/seo/prerender.spec.ts --project=web-chromium; echo "exit=$?"`
Expected: FAIL, `exit=1`. Today's `prerender.mjs` never builds `/blog/bdikat-maslul-e2e`, so the article case returns the SPA fallback and gets the home page's canonical: `expected '/' to be '/blog/bdikat-maslul-e2e'`.

- [ ] **Step 6: Rewrite `scripts/prerender.mjs`**

```js
// Prerender the public routes to real HTML files.
//
// The app is client-rendered: `dist/index.html` ships one static <head> and an
// empty `<div id="root">`, and every path returns that same file. `useSeo`
// writes the right title, canonical and JSON-LD once React mounts — which only
// helps a crawler that executes JavaScript.
//
// Google does. GPTBot, ClaudeBot, PerplexityBot and CCBot largely do not, so to
// an AI assistant the whole site was one page, and `/faq` — the richest content
// here — did not exist. Verified against live production before this was
// written: `/`, `/faq` and `/claims` returned byte-identical HTML, all three
// declaring the home page as their canonical.
//
// So: run the real app in a real browser at build time, let `useSeo` and the
// components do exactly what they do for a visitor, and write the resulting DOM
// to `dist/<route>.html`. No second copy of the metadata to drift, because
// nothing here knows what any route's title should be — it renders and asks.
//
// Two files, deliberately:
//
//   dist/index.html — the prerendered home page, served at `/`.
//   dist/app.html   — the untouched SPA shell, the rewrite target for anything
//                     without a prerendered file (an article published since
//                     the last build, 404s).
//
// Without the split, the SPA fallback would be the prerendered *home* page, and
// a crawler fetching an article not yet prebuilt would be served the home
// page's content under that URL. An empty shell is the honest answer for a
// route we have not prerendered.

import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { duplicateTitles, fixtureArticleFor, planArticles } from './published-articles.mjs'

const DIST = join(process.cwd(), 'dist')
const PORT = Number(process.env.PRERENDER_PORT ?? 4183)

/**
 * Stamped into every file this script writes, so a later run can tell a
 * prerendered page from the shell `vite build` emits.
 *
 * Without it, running the script twice against one build destroys the fallback:
 * the second run copies the already-prerendered `index.html` over `app.html`,
 * and every route that is *not* prerendered starts being served the home
 * page's content under its own URL. `npm run build:prerender` happens to be
 * safe because `vite build` rewrites `index.html` first; running
 * `npm run prerender` on its own is not, and that is the command someone
 * reaches for when iterating.
 */
const MARKER = '<!-- prerendered by scripts/prerender.mjs -->'

const exists = async (p) => access(p).then(() => true, () => false)

// The public, statically-routed pages — the sitemap's contents.
//
// Published articles are added to these at build time (`planArticles` in
// scripts/published-articles.mjs): each becomes `dist/blog/<slug>.html`, which
// Vercel serves before any rewrite. A page is a snapshot, so an article edited
// since the last build is stale until the next production deploy — the publish
// workflow and the nightly CI run are what make one (README, "When an article's
// page is rebuilt").
const ROUTES = [
  '/',
  '/faq',
  '/tools',
  '/perspective',
  '/claims',
  '/blog',
  '/privacy',
  '/accessibility',
]

/** The route is rendered when its own canonical has replaced the static one. */
const canonicalFor = (route) => (route === '/' ? '/' : route.replace(/\/+$/, ''))

/**
 * Undo the font preload's self-promotion.
 *
 * `index.html` loads the fonts with `rel="preload" as="style"` and an `onload`
 * that flips it to `rel="stylesheet"` — the standard trick for keeping the
 * stylesheet off the critical path. By the time the DOM is captured that flip
 * has already happened, so a naive snapshot writes `rel="stylesheet"` into the
 * file and every prerendered page ships a render-blocking stylesheet: the exact
 * cost the pattern exists to avoid, reintroduced by the step meant to help.
 *
 * Detected by the `onload` handler rather than the URL, so it keeps working if
 * the font host changes. `SEO-MOB-007` asserts the same property on the served
 * HTML and is what fails if this stops working.
 */
function restoreAsyncFont(html) {
  return html.replace(
    /<link([^>]*?)rel="stylesheet"([^>]*?onload="this\.onload=null;this\.rel='stylesheet'"[^>]*)>/g,
    '<link$1rel="preload"$2>',
  )
}

/**
 * Drop the beacon `@vercel/analytics` injects into the live DOM.
 *
 * `<Analytics />` appends `<script src="/_vercel/insights/script.js">` on
 * mount, so the captured DOM carries it and every prerendered page ships it as
 * static markup. Nothing under `/_vercel/` is a file in this build: the path is
 * synthesised by Vercel's edge, and production is Base44, which has never heard
 * of it. There the tag resolves to the SPA fallback — `index.html`, 200,
 * `text/html` — and the browser refuses to execute a document as a script on
 * every page load, for a beacon that collects nothing on that host anyway.
 *
 * Removing it costs nothing on Vercel either: the component re-injects the tag
 * when React mounts, which is how it works for a client-rendered visit today.
 *
 * Matched on the `/_vercel/` prefix rather than the one filename, because
 * `@vercel/speed-insights` places its beacon there too and would arrive the
 * same way. `API-SUR-…` in `e2e/api/http-surface.spec.ts` — "every same-origin
 * file referenced by index.html actually exists" — is what fails if this stops
 * working.
 */
function dropVercelBeacon(html) {
  return html.replace(/<script\b[^>]*\bsrc="\/_vercel\/[^"]*"[^>]*><\/script>/g, '')
}

/**
 * Answer a prerendered article page's Base44 read from the fixture file.
 *
 * Only in the e2e build (`PRERENDER_ARTICLES_FIXTURE`), whose bundle has no
 * Supabase and so reads the article through the Base44 SDK, which nothing
 * serves at build time. `planArticles` refuses the fixture anywhere it could
 * reach a deployment.
 */
async function serveFixtureArticles(page, rows) {
  await page.route(/\/entities\/BlogPost\/[^/?#]+/, (route) => {
    const row = fixtureArticleFor(route.request().url(), rows)
    return route.fulfill({
      status: row ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(row ?? { error: 'not found' }),
    })
  })
}

async function main() {
  const { loadEnv, preview } = await import('vite')
  const { chromium } = await import('@playwright/test')

  // Keep the shell before anything overwrites index.html — but only when
  // `index.html` still *is* the shell. See MARKER.
  const indexPath = join(DIST, 'index.html')
  const shellPath = join(DIST, 'app.html')
  if ((await readFile(indexPath, 'utf8')).includes(MARKER)) {
    if (!(await exists(shellPath))) {
      console.error(
        `\n::error::dist/index.html is already prerendered and dist/app.html is missing, ` +
          `so the SPA shell cannot be recovered. Run a fresh build: npm run build:prerender`,
      )
      process.exit(1)
    }
    // app.html was written from the pristine shell by the run that prerendered
    // index.html, so it is already correct. Copying now would overwrite it with
    // the home page.
  } else {
    await cp(indexPath, shellPath)
  }

  // Which articles to prebuild. The environment is read the way `vite build`
  // read it — the env files, with the process environment winning — so the list
  // comes from the same Supabase project the bundle reads.
  const env = { ...process.env, ...loadEnv('production', process.cwd(), 'VITE_') }
  let articles
  try {
    articles = await planArticles(env)
  } catch (err) {
    console.error(`\n::error::The published articles cannot be prebuilt: ${err.message}`)
    process.exit(1)
  }
  if (articles.warning) console.warn(`\n::warning::${articles.warning}`)
  const routes = [...ROUTES, ...articles.routes]

  const server = await preview({
    preview: { port: PORT, host: '127.0.0.1', strictPort: true },
    logLevel: 'warn',
  })

  // A build host without the Chromium binary is a reason to ship the plain SPA
  // — which is what every build shipped before this script existed — not a
  // reason to fail the deploy. `app.html` is already in place above, so the
  // rewrite target exists either way.
  //
  // Loud, though: a silent skip is how this step would quietly stop running and
  // nobody would notice until rankings moved. `e2e/seo/prerender.spec.ts` is the
  // other half of that — it fails if the served HTML is not per-route.
  let browser
  try {
    browser = await chromium.launch()
  } catch (err) {
    await server.close()
    const why = err.message.split('\n')[0]

    // Where the artifact is *tested* for being prerendered, a skip is not a
    // degraded build — it is a build that will fail a later job with nine
    // opaque failures in a suite that is working correctly. That is exactly how
    // this was found. `PRERENDER_REQUIRED=1` moves the error to where the cause
    // is, in the job that could have installed the browser.
    if (process.env.PRERENDER_REQUIRED === '1') {
      console.error(
        `\n::error::Prerendering was required and could not run: ${why}\n` +
          `Install the browser before building: npx playwright install --with-deps chromium`,
      )
      process.exit(1)
    }

    console.warn(
      `\n::warning::Prerendering skipped — could not launch Chromium (${why}).\n` +
        `The build ships the client-rendered SPA, exactly as it did before.\n` +
        `Install the browser with: npx playwright install chromium`,
    )
    return
  }

  const results = []

  try {
    for (const route of routes) {
      const page = await browser.newPage()
      try {
        if (articles.fixtureRows && route.startsWith('/blog/')) {
          await serveFixtureArticles(page, articles.fixtureRows)
        }

        await page.goto(`http://127.0.0.1:${PORT}${route}`, {
          waitUntil: 'networkidle',
          timeout: 45_000,
        })

        // Wait for the route's own metadata rather than a fixed delay: the
        // whole point is to capture the head `useSeo` writes, and a timeout
        // that fires early would bake the static head back in. An article that
        // does not load keeps the not-found canonical (`/blog`), times out
        // here, and fails the build rather than shipping a "not found" page.
        const want = canonicalFor(route)
        await page.waitForFunction(
          (expected) => {
            const href = document
              .querySelector('link[rel="canonical"]')
              ?.getAttribute('href')
            if (!href) return false
            try {
              return new URL(href).pathname.replace(/(.)\/+$/, '$1') === expected
            } catch {
              return false
            }
          },
          want,
          { timeout: 20_000 },
        )

        // Vite's runtime adds `modulepreload` hints for the route's chunks
        // using the *absolute* origin it was loaded from, so capturing the DOM
        // bakes `http://127.0.0.1:4183/assets/…` into the shipped HTML. The
        // hints are worth keeping — they are the route's own chunks — so make
        // them root-relative rather than dropping them.
        const html = `${MARKER}\n${dropVercelBeacon(
          restoreAsyncFont((await page.content()).replaceAll(`http://127.0.0.1:${PORT}/`, '/')),
        )}`
        if (html.includes(`127.0.0.1:${PORT}`)) {
          throw new Error(`${route}: the preview origin survived into the HTML`)
        }
        // `<route>.html`, not `<route>/index.html`. Measured, not assumed: the
        // directory form is only served at `/faq/` with the trailing slash —
        // `/faq` falls straight through to the SPA fallback, which would have
        // shipped eight prerendered files that nothing ever requested. The
        // sibling file answers `/faq`, `/faq/` and `/faq.html` alike, on
        // `vite preview` and on Vercel, and every copy declares `/faq` as its
        // canonical so the spare spellings consolidate. An article is
        // `dist/blog/<slug>.html`, beside `dist/blog.html`.
        const target =
          route === '/' ? join(DIST, 'index.html') : join(DIST, `${route.slice(1)}.html`)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, html, 'utf8')

        const title = await page.title()
        results.push({ route, bytes: html.length, title })
        console.log(
          `  ${route.padEnd(16)} ${String(html.length).padStart(7)} bytes  ${title.slice(0, 48)}`,
        )
      } finally {
        await page.close()
      }
    }
  } finally {
    await browser.close()
    await server.close()
  }

  // Two routes with one title is the defect this step exists to remove — every
  // page the home page — or two articles competing for one search result.
  // Either way it would fail silently, so assert it here rather than discover
  // it in Search Console.
  const dupes = duplicateTitles(results)
  if (dupes.length) {
    console.error(
      `\nPrerender gave more than one route the same title — the per-route head did not apply, ` +
        `or two published articles share a title. Refusing to ship pages that compete with each other:\n` +
        dupes.map((d) => `  "${d.title}": ${d.routes.join(', ')}`).join('\n'),
    )
    process.exit(1)
  }

  // The fallback is the one output nothing downstream inspects — no route
  // serves it under `vite preview`, so a corrupted `app.html` would reach
  // production silently and hand crawlers the home page under every
  // not-yet-built article URL. Assert it is still an empty shell rather than
  // assume.
  const shell = await readFile(shellPath, 'utf8')
  const shellRoot = shell.match(/<div id="root">([\s\S]*?)<\/div>/)?.[1] ?? ''
  if (shell.includes(MARKER) || shellRoot.trim() !== '') {
    console.error(
      `\n::error::dist/app.html is not an empty SPA shell (${shellRoot.trim().length} chars in #root). ` +
        `Every route without a prerendered file would be served this content. ` +
        `Run a fresh build: npm run build:prerender`,
    )
    process.exit(1)
  }

  console.log(
    `\nPrerendered ${results.length} routes (${articles.routes.length} articles), every title distinct.`,
  )
}

await main()
```

- [ ] **Step 7: Run the e2e prerender suite and the unit suite**

Run: `cd $WT && CI=1 npx playwright test e2e/seo/prerender.spec.ts --project=web-chromium; echo "exit=$?"; ls dist/blog/; npx vitest run tests/unit tests/contract; echo "exit=$?"`
Expected:
- The playwright run passes all cases, including `/blog/bdikat-maslul-e2e is served with its own title and canonical` and `an article is served as full HTML…`, with `exit=0`.
- `ls` prints `bdikat-maslul-e2e.html`.
- The vitest run gives `exit=0`.

Then check that the e2e build's other pages are unaffected:

Run: `cd $WT && SKIP_BUILD=1 npx playwright test e2e/seo e2e/ui/blog.spec.ts --project=web-chromium; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 8: README** — in "### Prerendering closes it", replace the bullet:
```
- **Blog posts stay client-rendered** on purpose: they come from the Base44
  backend, so prerendering them would bake a snapshot into the bundle that goes
  stale the moment a post is edited.
```
with:
```
- **Published articles are prebuilt too**, one `dist/blog/<slug>.html` each.
  `scripts/published-articles.mjs` lists them from Supabase with the publishable
  key (row-level security returns published rows only), and Vercel serves the
  file before any rewrite. A page is a snapshot: an edit reaches it on the next
  production deploy — see "When an article's page is rebuilt". A production
  build (`PRERENDER_REQUIRED=1`) that cannot list the articles fails rather than
  shipping a blog without its pages; any other build warns and prebuilds the
  static routes only.
- **The e2e build prebuilds a fixture article**, not a real one.
  `PRERENDER_ARTICLES_FIXTURE=e2e/fixtures/prerender-articles.json` (set by the
  CI `build` job, `playwright.config.ts` and `scripts/run-tests.sh`) makes the
  prerender answer the page's read from that file. It is refused in a Vercel
  build and in a bundle that reads Supabase, so it cannot reach a deployment.
```
and replace `What still mitigates the blog-post case is [\`public/llms.txt\`](public/llms.txt): a static file those` with `Beside the pages sits [\`public/llms.txt\`](public/llms.txt): a static file those`.

- [ ] **Step 9: Update the STDs**

`tests/test-plan/11-std-seo.md` §5a:
- Change the row `SEO-PRE-001..008` title to `"\`<route>\` is served with its own title and canonical" for the eight public routes and the fixture article (SEO-PRE-012)`.
- Replace the quoted note that begins `> Blog posts are deliberately not prerendered` (four lines) with:
```
> Published articles are prerendered too (`dist/blog/<slug>.html`). In this
> suite the build prebuilds one fixture article from
> `e2e/fixtures/prerender-articles.json` (`PRERENDER_ARTICLES_FIXTURE`), so the
> cases are hermetic; production lists the real ones from Supabase. SEO-PRE-009
> and SEO-PRE-011 include it.
```
- Add after the SEO-PRE-011 row:
```
| SEO-PRE-012 | "`/blog/bdikat-maslul-e2e` is served with its own title and canonical" | The prebuilt article's title, and a canonical on its slug |
| SEO-PRE-013 | "an article is served as full HTML: its body, its canonical and its BlogPosting" | The body's first sentence is in the HTML; canonical and `BlogPosting.mainEntityOfPage` are `/blog/<slug>`; `headline` is the title |
```
- In §6 change `All 19 unit and 48 e2e cases pass` to `All 19 unit and 50 e2e cases pass`.

`tests/test-plan/01-std-unit.md`: in §2 add the row ``| `fetchPublishedArticles`, `planArticles`, `fixtureArticleFor`, `duplicateTitles` | `scripts/published-articles.mjs` |``, and before `## 5. Pass criteria` add:
```
### 4.22 The published articles at build time — `tests/unit/published-articles.test.ts`

The list `prerender.mjs` prebuilds pages for, and that PR 2's sitemap and
llms.txt will read. An answer that cannot be trusted is never "no articles",
and test articles can never reach a deployment.

| ID | Title | Expected result |
|---|---|---|
| UNIT-PUBART-001 | "asks PostgREST for published rows, newest first, with the publishable key" | `published=eq.true`, `order=created_at.desc`; key as `apikey` and bearer |
| UNIT-PUBART-002 | "selects the columns it is asked for" | `select` as given |
| UNIT-PUBART-003 | "returns the rows" | Rows unchanged |
| UNIT-PUBART-004 | "throws on a refusal, naming the status" | `HTTP 401` |
| UNIT-PUBART-005 | "throws on an answer that is not a list" | `not a list` |
| UNIT-PUBART-006..009 | "refuses a row whose slug %j could not be a file under dist/blog" | `../escape`, `Bad`, a Base44 id, `null` → `unusable slug` |
| UNIT-PUBART-010 | "lists the published articles as /blog/<slug> routes" | `["/blog/a", "/blog/b"]` |
| UNIT-PUBART-011 | "warns, and prebuilds no article, when Supabase is not configured" | Warning; no request |
| UNIT-PUBART-012 | "fails when articles are required and Supabase is not configured" | Throws |
| UNIT-PUBART-013 | "warns when Supabase cannot be read and articles are not required" | Warning naming `HTTP 503` |
| UNIT-PUBART-014 | "fails when Supabase cannot be read and articles are required" | Throws `HTTP 503` |
| UNIT-PUBART-015 | "takes the fixture's articles in the e2e build, without asking Supabase" | Fixture routes and rows; no request |
| UNIT-PUBART-016..017 | "refuses the fixture in a Vercel build (%j)" | `VERCEL=1` or `VERCEL_ENV` → throws |
| UNIT-PUBART-018 | "refuses the fixture in a bundle that reads Supabase" | Throws |
| UNIT-PUBART-019 | "refuses a fixture article with an unusable slug" | Throws |
| UNIT-PUBART-020 | "answers the page's Base44 read by the slug at the end of its URL" | The fixture row |
| UNIT-PUBART-021 | "answers null for any other key" | `null` |
| UNIT-PUBART-022 | "names each title more than one route was rendered with" | `{ title, routes }` |
| UNIT-PUBART-023 | "is empty when every title is distinct" | `[]` |
| UNIT-PUBART-024 | "are the app's rule and address" | Same verdicts as `articlePath.ts` |
```
In §5 change `All 375 cases pass.` to `All 399 cases pass.`

`tests/test-plan/03-std-contract.md`, at the end of the §4.8 table:
```
| CTR-SLUG-008 | "the build's copy is the same" | `scripts/published-articles.mjs` patterns equal `articlePath.ts`'s |
```
In §6 change `All 555 cases pass.` to `All 556 cases pass.`

- [ ] **Step 10: Commit**

```bash
cd $WT && git add scripts/published-articles.mjs scripts/prerender.mjs e2e/fixtures/prerender-articles.json e2e/seo/prerender.spec.ts playwright.config.ts scripts/run-tests.sh .github/workflows/ci.yml tests/unit/published-articles.test.ts tests/contract/article-slug.contract.test.ts README.md tests/test-plan/11-std-seo.md tests/test-plan/01-std-unit.md tests/test-plan/03-std-contract.md && git commit -m "$(cat <<'EOF'
SEO PR1: prebuild every published article as dist/blog/<slug>.html

prerender.mjs lists the published slugs from Supabase (publishable key)
through scripts/published-articles.mjs, which PR 2 reuses. A required build
that cannot list them fails; the e2e build prebuilds a fixture article that
is refused anywhere it could deploy.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ
EOF
)"
```

---

### Task 8: The scripts that write `blog_posts`

**Files:**
- Modify: `scripts/seed-blog.mjs`: imports L33-36, add `slugFromFile`, `mirrorRow` (L85-87), `loadArticles` (L89-93)
- Modify: `scripts/publish-blog.mjs`: replace `upsertSupabase` (L61-73) with `publishInSupabase`, and its call (~L129)
- Modify: `scripts/backfill-from-base44.mjs`: `TABLES.BlogPost` (L46-49) and the row loop (L76-99)
- Test: `tests/unit/seed-blog.test.ts`, `tests/unit/publish-blog.test.ts`, `tests/unit/base44-repair-scripts.test.ts`
- Modify: `README.md` ("Blog articles in the repo"), `tests/test-plan/01-std-unit.md`

**Interfaces:**
- Consumes: `isValidSlug` from `scripts/published-articles.mjs` (Task 7).
- Produces:
  - `slugFromFile(file: string): string`, which throws on a non-kebab name.
  - `mirrorRow(step, base44Id)` now includes `slug: step.article.slug`.
  - `publishInSupabase(url, key, base44Id, fetchImpl = fetch): Promise<void>`. It PATCHes, and 0 rows throws.
  - The backfill SQL inserts `slug = 'post-<sanitised id>'` for BlogPost rows and never updates it on conflict.

- [ ] **Step 1: Write the failing tests**

`tests/unit/seed-blog.test.ts`: change the import to:
```ts
import { planSeed, mirrorRow, parseArticle, readExecResult, slugFromFile } from "../../scripts/seed-blog.mjs";
```
add `slug: "horadat-dmei-nihul",` to the `article()` fixture (after `file:`), and append:
```ts
describe("the article's address", () => {
  it("mirrors the file name as the slug, and keeps it out of the Base44 payload", () => {
    const [step] = planSeed([article()], []);
    expect(step.payload).not.toHaveProperty("slug");
    expect(mirrorRow(step, "b44-new").slug).toBe("horadat-dmei-nihul");
  });

  it("takes the slug from the file name", () => {
    expect(slugFromFile("horadat-dmei-nihul.md")).toBe("horadat-dmei-nihul");
  });

  it("refuses a file name that cannot be an address", () => {
    expect(() => slugFromFile("Horadat Dmei.md")).toThrow(/kebab-case/);
  });
});
```

`tests/unit/publish-blog.test.ts`: change the import to:
```ts
import { planPublish, publishInSupabase, readExecResult } from "../../scripts/publish-blog.mjs";
```
add `vi` to the vitest import (`import { describe, expect, it, vi } from "vitest";`) and append:
```ts
describe("publishInSupabase", () => {
  const reply = (body: unknown, status = 200) =>
    vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    );

  it("PATCHes the one row by base44_id, touching only `published`", async () => {
    const fetchImpl = reply([{ base44_id: "b44-7" }]);
    await publishInSupabase("https://x.supabase.co", "service-key", "b44-7", fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://x.supabase.co/rest/v1/blog_posts?base44_id=eq.b44-7");
    expect(init!.method).toBe("PATCH");
    expect(JSON.parse(String(init!.body))).toEqual({ published: true });
    expect((init!.headers as Record<string, string>).Prefer).toBe("return=representation");
  });

  it("fails when no Supabase row has the id, rather than reporting it published", async () => {
    await expect(publishInSupabase("https://x.supabase.co", "k", "b44-7", reply([]))).rejects.toThrow(/no Supabase row/);
  });

  it("fails on a refusal, naming the status", async () => {
    await expect(publishInSupabase("https://x.supabase.co", "k", "b44-7", reply({ message: "x" }, 401))).rejects.toThrow(
      /401/,
    );
  });
});
```

`tests/unit/base44-repair-scripts.test.ts`: inside `describe("backfill-from-base44", …)` add:
```ts
  it("gives an imported article a fallback slug, and never overwrites one already set", () => {
    const dir = mkdtempSync(join(tmpdir(), "backfill-"));
    const file = join(dir, "export.json");
    writeFileSync(
      file,
      JSON.stringify({
        BlogPost: [{ id: "64F0a1b2c3d4e5f6a7b8c9d0", title: "t", body: "b", published: true, created_date: "2026-10-01T00:00:00Z" }],
      }),
    );
    const r = node(["scripts/backfill-from-base44.mjs", file]);
    rmSync(dir, { recursive: true, force: true });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/insert into public\.blog_posts \([^)]*\bslug\b/);
    expect(r.stdout).toContain("'post-64f0a1b2c3d4e5f6a7b8c9d0'");
    expect(r.stdout).not.toMatch(/slug = excluded\.slug/);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd $WT && npx vitest run tests/unit/seed-blog.test.ts tests/unit/publish-blog.test.ts tests/unit/base44-repair-scripts.test.ts; echo "exit=$?"`
Expected: FAIL, `exit=1`. The output shows `slugFromFile is not a function`, `publishInSupabase is not a function`, and the backfill's stdout has no `slug`.

- [ ] **Step 3: Implement**

`scripts/seed-blog.mjs` — after `import { fileURLToPath } from "node:url";` add:
```js
import { isValidSlug } from "./published-articles.mjs";
```
After the `export { parseArticle };` line add:
```js
/**
 * The article's address, `/blog/<slug>`: its file name. Supabase holds it
 * (Base44's BlogPost has no such field), so it goes to the mirror only. A file
 * name that could not be an address is refused before anything is written.
 * Note that a re-seed writes the file name back over a slug renamed in
 * /admin/blog.
 */
export function slugFromFile(file) {
  const slug = file.replace(/\.md$/, "");
  if (!isValidSlug(slug)) {
    throw new Error(`${file}: the file name is the article's address (/blog/<name>) and must be Latin kebab-case`);
  }
  return slug;
}
```
Replace `mirrorRow`:
```js
/** The Supabase row for a step, once Base44 has given it an id. */
export function mirrorRow(step, base44Id) {
  return { ...step.payload, published: step.published, slug: step.article.slug, base44_id: base44Id };
}
```
In `loadArticles`, replace `.map((f) => ({ file: f, ...parseArticle(readFileSync(join(CONTENT_DIR, f), "utf8")) }));` with:
```js
    .map((f) => ({ file: f, slug: slugFromFile(f), ...parseArticle(readFileSync(join(CONTENT_DIR, f), "utf8")) }));
```

`scripts/publish-blog.mjs` — replace the whole `async function upsertSupabase(url, key, row) { … }` with:
```js
/**
 * Publish the Supabase copy in place.
 *
 * A PATCH, not an upsert: publishing changes `published` and nothing else,
 * and must never create a row Base44 does not have. An empty answer means no
 * row had this base44_id — reported as a failure, never counted as published.
 */
export async function publishInSupabase(url, key, base44Id, fetchImpl = fetch) {
  const res = await fetchImpl(`${url}/rest/v1/blog_posts?base44_id=eq.${encodeURIComponent(base44Id)}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ published: true }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("no Supabase row has this base44_id — run scripts/reconcile-stores.mjs");
  }
}
```
and replace `      await upsertSupabase(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { base44_id: s.id, published: true });` with:
```js
      await publishInSupabase(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, s.id);
```

`scripts/backfill-from-base44.mjs` — replace:
```js
  BlogPost: {
    table: "blog_posts",
    cols: ["title","excerpt","body","image_url","tags","action_time","published"],
  },
```
with:
```js
  BlogPost: {
    table: "blog_posts",
    cols: ["title","excerpt","body","image_url","tags","action_time","published"],
    // Base44 has no slug, and blog_posts.slug is NOT NULL. The table's fill
    // trigger does not fire here (the load runs with session_replication_role
    // = replica), so a new row gets the migration's fallback (`post-<id>`)
    // from this script instead; an existing row keeps the slug it
    // has, so a re-run never renames a live article.
    insertOnly: { slug: (r) => fallbackSlug(r.id) },
  },
```
After the `q` helper, add:
```js
/** `post-<id>`, cleaned the way supabase/migrations/20261014000000_blog_slug.sql cleans it. */
const fallbackSlug = (id) => {
  const s = String(id ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s) throw new Error("a BlogPost row has no id to make a slug from");
  return `post-${s}`;
};
```
In the loop, replace:
```js
for (const [entity, { table, cols }] of Object.entries(TABLES)) {
```
with:
```js
for (const [entity, { table, cols, insertOnly = {} }] of Object.entries(TABLES)) {
```
replace:
```js
  const columns = [...cols, "base44_id", "created_at", "updated_at"];
  // `status` carries a NOT NULL default; an explicit NULL would defeat it.
  const updatable = columns.filter((c) => c !== "base44_id");
```
with:
```js
  const extra = Object.keys(insertOnly);
  const columns = [...cols, ...extra, "base44_id", "created_at", "updated_at"];
  // `status` carries a NOT NULL default; an explicit NULL would defeat it.
  // Insert-only columns are set on a new row and never overwritten.
  const updatable = columns.filter((c) => c !== "base44_id" && !extra.includes(c));
```
and replace:
```js
        const vals = cols.map((c) => q(r[c]));
        vals.push(q(r.id), q(r.created_date), q(r.updated_date ?? r.created_date));
```
with:
```js
        const vals = cols.map((c) => q(r[c]));
        for (const c of extra) vals.push(q(insertOnly[c](r)));
        vals.push(q(r.id), q(r.created_date), q(r.updated_date ?? r.created_date));
```

- [ ] **Step 4: Run the tests**

Run: `cd $WT && npx vitest run tests/unit/seed-blog.test.ts tests/unit/publish-blog.test.ts tests/unit/base44-repair-scripts.test.ts; echo "exit=$?"; node scripts/seed-blog.mjs > /dev/null; echo "seed dry-run exit=$?"`
Expected: all pass, `exit=0`. The dry run (no `--apply`, no writes) reads every file name through `slugFromFile` and prints `seed dry-run exit=0`.

- [ ] **Step 5: README** — in "## Blog articles in the repo", after the paragraph ending "…so correcting an article cannot take down one that is live." add:
```

Each post's address, `/blog/<slug>`, is its **file name**, so a file must be
named in Latin kebab-case (`horadat-dmei-nihul.md`); the script refuses any
other. The slug goes to Supabase only — Base44's `BlogPost` has no such field —
and a re-seed writes the file name back over a slug changed in `/admin/blog`.
```

- [ ] **Step 6: Update the STD** — `tests/test-plan/01-std-unit.md`

At the end of the §4.12 table:
```
| UNIT-SEED-010 | "mirrors the file name as the slug, and keeps it out of the Base44 payload" | Mirror row `slug`; payload has none |
| UNIT-SEED-011 | "takes the slug from the file name" | `horadat-dmei-nihul` |
| UNIT-SEED-012 | "refuses a file name that cannot be an address" | Throws naming kebab-case |
```
Before `## 5. Pass criteria` add:
```
### 4.25 Publishing by title — `tests/unit/publish-blog.test.ts` (`publishInSupabase`)

The Supabase half of a publish is a PATCH by `base44_id`: it changes
`published` and nothing else, and a row that is not there is a failure rather
than a row silently created.

| ID | Title | Expected result |
|---|---|---|
| UNIT-PUB-001 | "PATCHes the one row by base44_id" | `PATCH …?base44_id=eq.b44-7`, `{ published: true }`, `return=representation` |
| UNIT-PUB-002 | "fails when no Supabase row has the id, rather than reporting it published" | Throws `no Supabase row` |
| UNIT-PUB-003 | "fails on a refusal, naming the status" | Throws `401` |

### 4.26 The Base44 export backfill — `tests/unit/base44-repair-scripts.test.ts`

| ID | Title | Expected result |
|---|---|---|
| UNIT-BKF-001 | "gives an imported article a fallback slug, and never overwrites one already set" | `slug` column with `'post-<lowercased id>'`; no `slug = excluded.slug` |
```
In §5 change `All 399 cases pass.` to `All 406 cases pass.`

- [ ] **Step 7: Commit**

```bash
cd $WT && git add scripts/seed-blog.mjs scripts/publish-blog.mjs scripts/backfill-from-base44.mjs tests/unit/seed-blog.test.ts tests/unit/publish-blog.test.ts tests/unit/base44-repair-scripts.test.ts README.md tests/test-plan/01-std-unit.md && git commit -m "$(cat <<'EOF'
SEO PR1: seed, publish and backfill keep blog_posts.slug whole

seed-blog sets the slug from the file name; publish-blog PATCHes by
base44_id instead of a two-column upsert; the backfill gives a new row
post-<id> and never overwrites an existing slug.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ
EOF
)"
```

---

### Task 9: Old URLs answered on the server — `api/og/blog.ts` and `vercel.json`

**Files:**
- Modify: `api/og/blog.ts` (whole file)
- Modify: `vercel.json`: `rewrites`, insert before the `/blog/:id` bot rule (~L22)
- Test: `tests/unit/og-blog-handler.test.ts` (whole file), `tests/contract/vercel-functions.contract.test.ts`, `tests/contract/article-slug.contract.test.ts` (list)
- Modify: `README.md` (new "### Article addresses"), `tests/test-plan/01-std-unit.md`, `tests/test-plan/03-std-contract.md`

**Interfaces:**
- Consumes: `SupabaseContentService.getArticle` (Task 3), `RestTableClient` (Task 3), `articlePath` (Task 1), `computeBlogSeoConfig`/`renderSeoHtml` (unchanged). At runtime it reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Produces `GET /api/og/blog?id=<key>[&…]`:
  - published, `key !== slug` → `301 Location: /blog/<slug>?<query minus id>`
  - published, `key === slug` → 200 with the head injected
  - missing or draft → `404 + X-Robots-Tag: noindex`
  - read failure → 502
  - unconfigured or no id → 500

- [ ] **Step 1: Write the failing tests** — replace `tests/unit/og-blog-handler.test.ts` with:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SITE_URL } from "@/lib/seo";

// A trimmed stand-in for the bundled `dist/app.html` — enough tags for
// `renderSeoHtml` to patch, so the handler's output is inspectable without a
// real build.
const SHELL = `<!doctype html>
<html><head>
<title>old</title>
<meta name="description" content="old" />
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
<link rel="canonical" href="https://safe-arch-plan.base44.app/" />
<meta property="og:type" content="website" />
<meta property="og:title" content="old" />
<meta property="og:description" content="old" />
<meta property="og:url" content="https://safe-arch-plan.base44.app/" />
<meta property="og:image" content="old" />
<meta name="twitter:title" content="old" />
<meta name="twitter:description" content="old" />
<meta name="twitter:image" content="old" />
</head><body></body></html>`;

const SUPABASE = "https://stub.supabase.co";
const B44 = "64f0a1b2c3d4e5f6a7b8c9d0";
const UUID = "6f1c0e3a-0000-4000-8000-000000000001";
const SLUG = "horadat-dmei-nihul";

type Row = Record<string, unknown>;
/** What PostgREST answers for the next blog_posts read: the rows its filter matched. */
let rows: Row[] = [];
let restStatus = 200;
const restCalls: URL[] = [];

const article = (over: Row = {}): Row => ({
  id: UUID,
  base44_id: B44,
  slug: SLUG,
  title: "איך לבחור קרן פנסיה",
  excerpt: null,
  body: "פסקה על פנסיה.",
  image_url: "https://cdn.example/post-1.jpg",
  tags: "פנסיה",
  action_time: null,
  published: true,
  created_at: "2026-01-01T00:00:00Z",
  ...over,
});

vi.stubGlobal(
  "fetch",
  vi.fn(async (input: string) => {
    const url = String(input);
    if (url.endsWith("/app.html")) return { ok: true, status: 200, text: async () => SHELL } as Response;
    if (url.startsWith(`${SUPABASE}/rest/v1/blog_posts`)) {
      restCalls.push(new URL(url));
      const body = restStatus === 200 ? rows : { message: "upstream down" };
      return new Response(JSON.stringify(body), { status: restStatus, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }),
);

function makeRes() {
  const state = { status: 0, headers: {} as Record<string, string>, body: "" };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    setHeader(key: string, value: string) {
      state.headers[key] = value;
    },
    send(body: string) {
      state.body = body;
    },
  };
  return { res, state };
}

async function loadHandler() {
  vi.resetModules();
  const mod = await import("../../api/og/blog.ts");
  return mod.default;
}

const fetchMock = () => fetch as unknown as ReturnType<typeof vi.fn>;
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = SUPABASE;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
  rows = [];
  restStatus = 200;
  restCalls.length = 0;
  fetchMock().mockClear();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("api/og/blog — an article asked for by its slug", () => {
  it("renders the article's head into the shell, from Supabase", async () => {
    rows = [article()];
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: { id: SLUG } }, res);

    expect(state.status).toBe(200);
    expect(state.headers["Content-Type"]).toContain("text/html");
    expect(state.headers["Cache-Control"]).toContain("s-maxage=600");
    expect(state.body).toContain("איך לבחור קרן פנסיה");
    expect(state.body).toContain("https://cdn.example/post-1.jpg");
    expect(state.body).toContain(`<link rel="canonical" href="${SITE_URL}/blog/${SLUG}"`);
    expect(restCalls[0].searchParams.get("or")).toBe(`(slug.eq.${SLUG},base44_id.eq.${SLUG})`);
  });

  it("reads with the publishable key, as an anonymous visitor would — so drafts stay hidden", async () => {
    rows = [article()];
    const handler = await loadHandler();
    await handler({ method: "GET", query: { id: SLUG } }, makeRes().res);
    const [, init] = fetchMock().mock.calls.find(([u]) => String(u).startsWith(SUPABASE))!;
    expect((init as { headers: Record<string, string> }).headers.apikey).toBe("sb_publishable_test");
  });

  it("fetches the shell from a fixed, trusted origin, never from the request's own headers", async () => {
    rows = [article()];
    const handler = await loadHandler();
    const { res } = makeRes();

    // Vercel always gives the function a `headers` object, so a malicious
    // or forwarded Host must not change where the shell is fetched from —
    // this is the regression test for exactly that (CWE-918 / SSRF).
    await handler(
      { method: "GET", query: { id: SLUG }, headers: { host: "attacker.example" } } as never,
      res
    );

    expect(fetchMock()).toHaveBeenCalledWith(`${SITE_URL}/app.html`, { redirect: "error" });
  });
});

describe("api/og/blog — an address from before slugs", () => {
  it("answers a Base44 id with a 301 to the article's slug", async () => {
    rows = [article()];
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: { id: B44 } }, res);

    expect(state.status).toBe(301);
    expect(state.headers.Location).toBe(`/blog/${SLUG}`);
    // A day, not forever: a slug can still be renamed from /admin/blog.
    expect(state.headers["Cache-Control"]).toBe("public, max-age=86400, s-maxage=86400");
  });

  it("keeps the visitor's own query string, without the id the rewrite added", async () => {
    rows = [article()];
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: { id: B44, utm_source: "whatsapp", tag: ["a", "b"] } }, res);

    expect(state.headers.Location).toBe(`/blog/${SLUG}?utm_source=whatsapp&tag=a&tag=b`);
  });

  it("answers a Supabase uuid the same way", async () => {
    rows = [article({ base44_id: null })];
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: { id: UUID } }, res);

    expect(state.status).toBe(301);
    expect(state.headers.Location).toBe(`/blog/${SLUG}`);
    expect(restCalls[0].searchParams.get("or")).toContain(`id.eq.${UUID}`);
  });

  it("never redirects to a draft — its slug stays private", async () => {
    rows = [article({ published: false, slug: "tyuta-sodit" })];
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: { id: B44 } }, res);

    expect(state.status).toBe(404);
    expect(state.headers.Location).toBeUndefined();
    expect(state.headers["X-Robots-Tag"]).toBe("noindex");
    expect(state.body).not.toContain("tyuta-sodit");
  });
});

describe("api/og/blog — nothing to show", () => {
  it("returns 404 and noindex when no article has the key", async () => {
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: { id: "missing" } }, res);

    expect(state.status).toBe(404);
    expect(state.headers["X-Robots-Tag"]).toBe("noindex");
    expect(state.body).toContain("המאמר לא נמצא");
  });

  it("answers a draft asked for by its slug exactly as a missing one", async () => {
    rows = [article({ published: false, title: "טיוטה שעוד לא פורסמה" })];
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: { id: SLUG } }, res);

    expect(state.status).toBe(404);
    expect(state.headers["X-Robots-Tag"]).toBe("noindex");
    expect(state.body).not.toContain("טיוטה שעוד לא פורסמה");
    expect(state.body).toContain("המאמר לא נמצא");
  });

  it("treats an article with no published flag as a draft", async () => {
    rows = [article({ published: null })];
    const handler = await loadHandler();
    const { res, state } = makeRes();
    await handler({ method: "GET", query: { id: SLUG } }, res);
    expect(state.status).toBe(404);
  });

  it("does not ask Supabase about a key no article can have", async () => {
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: { id: "a,b)" } }, res);

    expect(state.status).toBe(404);
    expect(restCalls).toHaveLength(0);
  });

  it("returns 502 and noindex when Supabase fails", async () => {
    restStatus = 500;
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: { id: SLUG } }, res);

    expect(state.status).toBe(502);
    expect(state.headers["X-Robots-Tag"]).toBe("noindex");
  });

  it("answers 500 without calling Supabase when it is not configured", async () => {
    delete process.env.VITE_SUPABASE_URL;
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: { id: SLUG } }, res);

    expect(state.status).toBe(500);
    expect(state.headers["Cache-Control"]).toBe("no-store");
    expect(restCalls).toHaveLength(0);
  });

  it("answers 500 when the route is hit without an id", async () => {
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: {} }, res);

    expect(state.status).toBe(500);
  });

  it("rejects non-GET methods", async () => {
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "POST", query: { id: SLUG } }, res);

    expect(state.status).toBe(405);
  });
});
```

In `tests/contract/vercel-functions.contract.test.ts`, inside `describe("Vercel functions under api/", …)`, after `"route a crawler's /blog/:id to a function that exists"` add:
```ts
  it("sends every old Base44-id address to the function, whoever asks, before any other blog rule", () => {
    // Bookmarks, search results and the agents' answers name /blog/<Base44 id>.
    // The function answers 301 to the slug — for people as well as crawlers, so
    // no `has` condition — and it must match before the crawler rule and the
    // SPA catch-all would take the request.
    const rules = vercelConfig.rewrites as Array<{ source: string; destination: string; has?: unknown }>;
    const old = rules.findIndex((r) => r.source === "/blog/:id([0-9a-f]{24})");
    expect(old, "no rewrite for /blog/<24 hex>").toBeGreaterThan(-1);
    expect(rules[old].destination).toBe("/api/og/blog?id=:id");
    expect(rules[old].has).toBeUndefined();
    expect(old).toBeLessThan(rules.findIndex((r) => r.source === "/blog/:id"));
    expect(old).toBeLessThan(rules.findIndex((r) => r.destination === "/app.html"));
  });
```

In `tests/contract/article-slug.contract.test.ts`, add `"api/og/blog.ts",` to the `it.each([...])` list of files that link through `articlePath`.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd $WT && npx vitest run tests/unit/og-blog-handler.test.ts tests/contract/vercel-functions.contract.test.ts tests/contract/article-slug.contract.test.ts; echo "exit=$?"`
Expected: FAIL, `exit=1`. The old handler still imports `@base44/sdk` and answers 500 without `VITE_BASE44_APP_ID`. The output shows `no rewrite for /blog/<24 hex>`, and `api/og/blog.ts` lacks `articlePath(`.

- [ ] **Step 3: Rewrite `api/og/blog.ts`**

```ts
// Server-side answers for an article address that has no prebuilt page.
//
// Two kinds of request arrive here, both by `vercel.json` rewrite:
//
//   - `/blog/<24 hex>` — a Base44 id, the form every article link had before
//     slugs: bookmarks, search results, the agents' answers. From anyone, bot
//     or person. Answered with a 301 to `/blog/<slug>`, so the address shared
//     and indexed from now on is the readable one.
//   - `/blog/<slug>` from a crawler, for an article published since the last
//     build. Prebuilt articles are files (scripts/prerender.mjs), and Vercel
//     serves a file before any rewrite, so only the not-yet-built ones get
//     here. Answered with the SPA shell and the article's own <head>.
//
// Anything else — no such article, or a draft — is a 404 with noindex.
//
// The article is read from Supabase with the publishable key: the same
// anonymous read the site makes, so row-level security returns published rows
// only. And the same resolution (`SupabaseContentService.getArticle`: slug,
// then Base44 id, then uuid) the page itself uses, so the two never disagree.
//
// The key arrives as `?id=`, not as a `[id]` path segment: Vercel matches a
// dynamic function path only after vercel.json's rewrites, and its `/api/*`
// and `/(.*)` catch-alls took every such request first — the function
// deployed and was never once reached. A fixed path is a file on disk, which
// is checked before any rewrite.
//
// Relative imports carry `.js` because `"type": "module"` makes @vercel/node
// compile this as Node ESM, which resolves no extensionless path.
//
// `computeBlogSeoConfig` and `renderSeoHtml` are the same functions the client
// route uses (via `useSeo`), so this can never describe a post differently
// than the page a visitor who followed the link actually sees.

import { renderSeoHtml, SITE_URL } from "../../src/lib/seo.js";
import { BLOG_POST_NOT_FOUND_SEO, computeBlogSeoConfig } from "../../src/lib/blogSeo.js";
import { articlePath } from "../../src/lib/articlePath.js";
import { RestTableClient } from "../../src/services/supabase/RestTableClient.js";
import { SupabaseContentService } from "../../src/services/supabase/SupabaseContentService.js";

/** The request/response surface this handler needs — Vercel's Node runtime
 *  supplies both regardless of which `@vercel/node` types are installed. */
interface OgRequest {
  method?: string;
  query: Record<string, string | string[] | undefined>;
}
interface OgResponse {
  status(code: number): OgResponse;
  setHeader(name: string, value: string): void;
  send(body: string): void;
}

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL ?? "").trim();
const SUPABASE_KEY = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();

const content: SupabaseContentService | null =
  SUPABASE_URL && SUPABASE_KEY
    ? new SupabaseContentService(new RestTableClient(SUPABASE_URL, SUPABASE_KEY))
    : null;

// `VERCEL_URL` — the platform-assigned hostname of *this* deployment, never a
// client-supplied value — not `req.headers.host`: a request can carry any
// Host header it likes, and fetching whatever that names would let a visitor
// point this function's outbound request (and the shell it then caches for
// every later request on this warm instance) at a server they control.
const SELF_ORIGIN = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : SITE_URL;

let shellHtml: string | null = null;

/**
 * The untouched SPA shell `scripts/prerender.mjs` writes alongside the
 * prerendered routes — the same file every unrecognised path already falls
 * back to via `vercel.json`'s catch-all rewrite. Fetched from this
 * deployment's own origin rather than bundled in: bundling it required
 * `vercel.json`'s `functions.includeFiles`, which points at a path
 * (`dist/app.html`) that does not survive from `vercel build` into
 * `vercel deploy --prebuilt` — the deploy step tried to `readlink` it and
 * failed with ENOENT. A same-origin fetch has no such handoff to get wrong:
 * if `/app.html` were missing, every other route on the site would already be
 * broken too.
 */
async function loadShell(): Promise<string> {
  if (shellHtml !== null) return shellHtml;
  const res = await fetch(`${SELF_ORIGIN}/app.html`, { redirect: "error" });
  if (!res.ok) throw new Error(`fetching /app.html: ${res.status}`);
  shellHtml = await res.text();
  return shellHtml;
}

/**
 * The visitor's own query string (utm_* tags and the like), without the `id`
 * the rewrite added. Vercel passes the original query through a rewrite, so a
 * link shared as `/blog/<id>?utm_source=whatsapp` keeps its attribution.
 */
function forwardedQuery(query: OgRequest["query"]): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (name === "id" || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) params.append(name, v);
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

export default async function handler(req: OgRequest, res: OgResponse): Promise<void> {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const key = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  if (!key || !content) {
    if (!content) console.error("[api/og/blog] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set");
    res.setHeader("Cache-Control", "no-store");
    res.status(500).send(renderSeoHtml(await loadShell(), BLOG_POST_NOT_FOUND_SEO));
    return;
  }

  try {
    const post = await content.getArticle(key);
    // Row-level security already hides drafts from this anonymous read. The
    // check stays so a change there cannot turn a draft into a public page,
    // or leak its slug through a redirect.
    if (post.published !== true) throw Object.assign(new Error("not published"), { status: 404 });

    if (post.slug && post.slug !== key) {
      res.setHeader("Location", `${articlePath(post)}${forwardedQuery(req.query)}`);
      // A day, not forever: a 301 with no lifetime is kept by browsers
      // indefinitely, and a slug can still be renamed from /admin/blog.
      res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
      res.status(301).send("");
      return;
    }

    const shell = await loadShell();
    res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
    res.status(200).send(renderSeoHtml(shell, computeBlogSeoConfig(post)));
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status !== 404) console.error("[api/og/blog] failed to load post", key, err);
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
    res.setHeader("X-Robots-Tag", "noindex");
    res.status(status === 404 ? 404 : 502).send(renderSeoHtml(await loadShell(), BLOG_POST_NOT_FOUND_SEO));
  }
}
```

- [ ] **Step 4: Add the rewrite** — in `vercel.json` `rewrites`, insert between the `/ws-user-apps/:path*` rule and the `/blog/:id` bot rule:

```json
    {
      "source": "/blog/:id([0-9a-f]{24})",
      "destination": "/api/og/blog?id=:id"
    },
```

- [ ] **Step 5: Run the tests and both typechecks**

Run: `cd $WT && npx vitest run tests/unit/og-blog-handler.test.ts tests/contract; echo "exit=$?"; npm run typecheck; echo "exit=$?"`
Expected: all pass with `exit=0`, and the typecheck gives `exit=0`. `tsc -p ./api/tsconfig.json` resolves the new `.js` imports under nodenext.

- [ ] **Step 6: README** — under "## Blog articles in the repo", after the paragraph Task 8 added ("…not only in `/admin/blog`."), add:
```

### Article addresses

An article lives at `/blog/<slug>`: Latin kebab-case (`horadat-dmei-nihul`),
held in Supabase's `blog_posts.slug` only — Base44's `BlogPost` has no such
field, so `contentAdmin` passes it to the mirror and nowhere else. A repo
article's slug is its file name; one written in `/admin/blog` gets the slug
typed in the form, which refuses anything but kebab-case, a slug another
article has, and one shaped like a Base44 id.

Every link the site builds goes through `articlePath()` in
`src/lib/articlePath.ts`. Old links — `/blog/<Base44 id>`, in bookmarks, search
results and the agents' answers — keep working: `vercel.json` sends every
`/blog/<24 hex characters>` to `api/og/blog.ts` for every visitor, which reads
Supabase and answers `301` to `/blog/<slug>` (keeping the visitor's query
string, cached for a day), or `404` with `noindex` for a draft or an unknown id.
A page reached by an old address some other way replaces it with the slug in
the browser.

Renaming a published article's slug breaks every link to the old one — there is
no redirect table. The form says so before you save.
```

- [ ] **Step 7: Update the STDs**

`tests/test-plan/01-std-unit.md`, before `## 5. Pass criteria`:
```
### 4.24 The server's answer for an article address — `tests/unit/og-blog-handler.test.ts`

`api/og/blog.ts` reads Supabase with the publishable key and the same
`getArticle` the page uses. Old keys get a 301 to the slug; a not-yet-built slug
gets the shell with its head; anything else is 404 + noindex.

| ID | Title | Expected result |
|---|---|---|
| UNIT-OG-001 | "renders the article's head into the shell, from Supabase" | 200; title, image, canonical on the slug; `or=(slug.eq…,base44_id.eq…)` |
| UNIT-OG-002 | "reads with the publishable key, as an anonymous visitor would" | `apikey` is the publishable key |
| UNIT-OG-003 | "fetches the shell from a fixed, trusted origin" | `${SITE_URL}/app.html`, whatever the Host |
| UNIT-OG-004 | "answers a Base44 id with a 301 to the article's slug" | `Location: /blog/<slug>`; a day's cache |
| UNIT-OG-005 | "keeps the visitor's own query string, without the id the rewrite added" | `?utm_source=whatsapp&tag=a&tag=b` |
| UNIT-OG-006 | "answers a Supabase uuid the same way" | 301; `id.eq.<uuid>` asked |
| UNIT-OG-007 | "never redirects to a draft — its slug stays private" | 404; no `Location`; slug absent |
| UNIT-OG-008 | "returns 404 and noindex when no article has the key" | 404, `noindex` |
| UNIT-OG-009 | "answers a draft asked for by its slug exactly as a missing one" | 404; title absent |
| UNIT-OG-010 | "treats an article with no published flag as a draft" | 404 |
| UNIT-OG-011 | "does not ask Supabase about a key no article can have" | 404; no request |
| UNIT-OG-012 | "returns 502 and noindex when Supabase fails" | 502 |
| UNIT-OG-013 | "answers 500 without calling Supabase when it is not configured" | 500, `no-store` |
| UNIT-OG-014 | "answers 500 when the route is hit without an id" | 500 |
| UNIT-OG-015 | "rejects non-GET methods" | 405 |
```
In §5 change `All 406 cases pass.` to `All 412 cases pass.`

`tests/test-plan/03-std-contract.md`, in §4.4 after the `**`canonical-host.contract.test.ts`**` paragraph add:
```
**`vercel-functions.contract.test.ts`, old article addresses.** Every
`/blog/<24 hex>` — a Base44 id, what article links were before slugs — must be
rewritten to `api/og/blog.ts` with no `has` condition (people get the 301 as
well as crawlers), before the crawler rule and the SPA catch-all.
```
In §4.8 change the CTR-SLUG-006 title to `(7 files)` and add `api/og/blog.ts`. In §6 change `All 556 cases pass.` to `All 558 cases pass.`

- [ ] **Step 8: Commit**

```bash
cd $WT && git add api/og/blog.ts vercel.json tests/unit/og-blog-handler.test.ts tests/contract/vercel-functions.contract.test.ts tests/contract/article-slug.contract.test.ts README.md tests/test-plan/01-std-unit.md tests/test-plan/03-std-contract.md && git commit -m "$(cat <<'EOF'
SEO PR1: old /blog/<Base44 id> links 301 to the slug, for everyone

vercel.json routes every 24-hex blog address to api/og/blog.ts, which now
reads Supabase: 301 to /blog/<slug> (query kept), the head for a slug not
yet prebuilt, 404 + noindex for a draft or an unknown key.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ
EOF
)"
```

---

### Task 10: Rebuilds — publish dispatches a deploy, the nightly run deploys Vercel

**Files:**
- Modify: `.github/workflows/ci.yml`
  - the schedule comment (~L67-77)
  - `deploy-supabase.if` (~L484-486)
  - `deploy-vercel.if` (~L693-697)
  - step `Build for Vercel` env (~L785-788)
  - step `Verify the deployment serves the app` (~L843-859)
- Modify: `.github/workflows/publish-blog.yml` (job `permissions`, new last step)
- Test: `tests/contract/workflow.contract.test.ts`
- Modify: `README.md` ("Branches", new "### When an article's page is rebuilt"), `tests/test-plan/03-std-contract.md`

**Interfaces:**
- Consumes: `ci.yml`'s `workflow_dispatch.inputs.deploy` (boolean) and `planArticles`'s `PRERENDER_REQUIRED` (Task 7).
- Produces:
  - On `schedule` events on `main`, `deploy-supabase` and `deploy-vercel` run and `--prod` follows the existing green gate. `deploy` (Base44) does not run.
  - The production Vercel build sets `PRERENDER_REQUIRED=1`.
  - `publish-blog.yml` ends with `gh workflow run ci.yml --ref main -f deploy=true`.

**Decision recorded here:** the nightly run deploys Vercel only (plus the Supabase functions), not Base44.
- The run exists to rebuild the prebuilt article pages, and production is Vercel.
- A Base44 publish also ships the agents, and the nightly run has nobody watching it (AGENTS.md, "`base44 deploy` ships these").
- `deploy-supabase` must run too, because `--prod` is gated on it. Skipping it would demote every nightly build to a preview, and promoting without it would put the site ahead of its functions.
- The dispatched run from `publish-blog.yml` is a `workflow_dispatch` with `deploy=true`, so it publishes Base44 as well, as the spec decided.

- [ ] **Step 1: Write the failing contract tests** — in `tests/contract/workflow.contract.test.ts`:

Replace the case:
```ts
  it("lets no deploy fire from the nightly run", () => {
    // Every deploying job must require a push, or a scheduled run would
    // publish to the client's site at 22:00 with nobody watching.
    for (const name of ["deploy", "deploy-vercel"]) {
      expect(workflow.jobs[name].if ?? "", name).toMatch(/github\.event_name == 'push'/);
    }
  });
```
with:
```ts
  it("keeps the Base44 publish off the nightly run", () => {
    // Publishing Base44 ships the agents too, and the nightly run has nobody
    // watching it. A push, or a deliberate manual run, only.
    const condition = workflow.jobs.deploy.if ?? "";
    expect(condition).toMatch(/github\.event_name == 'push'/);
    expect(condition).not.toMatch(/schedule/);
  });

  it("rebuilds the Vercel site nightly, with the functions deployed first (CTR-REB-001)", () => {
    // Articles are prebuilt at deploy time, so an edit made from /admin/blog
    // reaches its page only on the next production build. The functions job
    // must run too: --prod waits for it, so the site is never ahead of them.
    for (const name of ["deploy-vercel", "deploy-supabase"]) {
      expect(workflow.jobs[name].if ?? "", name).toMatch(/github\.event_name == 'schedule'/);
    }
  });
```
Append at the end of the file:
```ts
describe("articles are prebuilt from the right list", () => {
  type Step = { name?: string; env?: Record<string, string>; run?: string };
  const step = (job: string, name: string) =>
    (stepsOf(workflow.jobs[job]) as Step[]).find((s) => s.name === name);

  it("requires the article list in a production build, and only there (CTR-REB-003)", () => {
    // A production build that cannot list the articles must fail rather than
    // ship a blog without pages; a preview may warn and go on.
    expect(step("deploy-vercel", "Build for Vercel")?.env?.PRERENDER_REQUIRED).toBe(
      "${{ steps.target.outputs.env == 'production' && '1' || '0' }}",
    );
  });

  it("prebuilds the e2e fixture article in the tested build and nowhere else (CTR-REB-004)", () => {
    expect(step("build", "Build")?.env?.PRERENDER_ARTICLES_FIXTURE).toBe("e2e/fixtures/prerender-articles.json");
    for (const [name, job] of jobs) {
      if (name === "build") continue;
      expect(JSON.stringify(job), `${name} must not prebuild the fixture article`).not.toContain(
        "PRERENDER_ARTICLES_FIXTURE",
      );
    }
    expect(readFileSync(join(REPO_ROOT, "vercel.json"), "utf8")).not.toContain("PRERENDER_ARTICLES_FIXTURE");
  });

  it("checks that a production deployment still serves /blog its own page (CTR-REB-005)", () => {
    // `blog.html` and the `blog/` directory of articles sit side by side.
    expect(step("deploy-vercel", "Verify the deployment serves the app")?.run ?? "").toContain(
      'vercel curl "$URL/blog"',
    );
  });
});

describe("publishing an article rebuilds the site (CTR-REB-002)", () => {
  const publish = parse(readFileSync(join(REPO_ROOT, ".github/workflows/publish-blog.yml"), "utf8")) as {
    jobs: {
      publish: {
        permissions?: Record<string, string>;
        steps: Array<{ name?: string; if?: string; env?: Record<string, string>; run?: string }>;
      };
    };
  };
  const job = publish.jobs.publish;
  const last = job.steps[job.steps.length - 1];

  it("ends by dispatching a production deploy of main with the workflow's own token", () => {
    expect(last.run).toMatch(/gh workflow run ci\.yml --ref main -f deploy=true/);
    expect(last.env?.GH_TOKEN).toBe("${{ github.token }}");
  });

  it("may dispatch workflows, and still only read the code", () => {
    expect(job.permissions).toEqual({ contents: "read", actions: "write" });
  });

  it("dispatches only after a real publish", () => {
    expect(last.if).toContain("inputs.apply");
    expect(last.if).toContain("steps.supabase-creds.outputs.ready == 'true'");
  });

  it("sends an input the CI workflow declares", () => {
    const dispatch = (workflow.on as { workflow_dispatch: { inputs: Record<string, { type: string }> } })
      .workflow_dispatch;
    expect(dispatch.inputs.deploy.type).toBe("boolean");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd $WT && npx vitest run tests/contract/workflow.contract.test.ts; echo "exit=$?"`
Expected: FAIL, `exit=1`. Neither deploy-vercel nor deploy-supabase mentions `schedule`, `PRERENDER_REQUIRED` is undefined, there is no `/blog` check, and publish-blog's last step is `Apply`.

- [ ] **Step 3: Edit `.github/workflows/ci.yml`**

Replace the two schedule comment lines:
```yaml
    # Scheduled runs use the default branch, and no deploy job can fire from
    # them — every one requires `github.event_name == 'push'`.
```
with:
```yaml
    # Scheduled runs use the default branch. They deploy the Supabase functions
    # and promote the Vercel build (the usual green gate applies), so an
    # article published or edited from /admin/blog has its prebuilt page by
    # the next night. They never publish Base44: that ships the agents, and
    # nobody is watching at 22:00 — the `deploy` job still requires a push or
    # a manual run with `deploy` ticked.
```

`deploy-supabase`, replace:
```yaml
    if: >-
      github.ref == 'refs/heads/main' &&
      (github.event_name == 'push' || inputs.deploy)
    timeout-minutes: 10
```
with:
```yaml
    # `schedule` too: the nightly run promotes Vercel, and --prod waits for
    # this job, so the site is never live ahead of the functions it calls.
    if: >-
      github.ref == 'refs/heads/main' &&
      (github.event_name == 'push' || github.event_name == 'schedule' || inputs.deploy)
    timeout-minutes: 10
```

`deploy-vercel`, replace:
```yaml
    if: >-
      !cancelled() &&
      needs.build.result == 'success' &&
      (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/builder') &&
      (github.event_name == 'push' || inputs.deploy)
```
with:
```yaml
    # The nightly run (`schedule`) rebuilds production so every prebuilt
    # article page is current — see README, "When an article's page is rebuilt".
    if: >-
      !cancelled() &&
      needs.build.result == 'success' &&
      (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/builder') &&
      (github.event_name == 'push' || github.event_name == 'schedule' || inputs.deploy)
```

Step `Build for Vercel`, replace:
```yaml
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          SCOPE: ${{ vars.VERCEL_SCOPE }}
          PROJECT: ${{ vars.VERCEL_PROJECT_NAME }}
        run: |
          # The workflow-wide VITE_BASE44_APP_ID is the e2e placeholder, and a
```
with:
```yaml
        env:
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
          SCOPE: ${{ vars.VERCEL_SCOPE }}
          PROJECT: ${{ vars.VERCEL_PROJECT_NAME }}
          # Production must prebuild every published article: a Supabase it
          # cannot read fails this build instead of shipping a blog without its
          # pages. A preview warns and goes on (scripts/published-articles.mjs).
          PRERENDER_REQUIRED: ${{ steps.target.outputs.env == 'production' && '1' || '0' }}
        run: |
          # The workflow-wide VITE_BASE44_APP_ID is the e2e placeholder, and a
```

Step `Verify the deployment serves the app`, replace:
```yaml
          echo "$body" | grep -q 'lang="he"' \
            || { echo "::error::Deployment did not serve the Hebrew RTL document"; exit 1; }
```
with:
```yaml
          echo "$body" | grep -q 'lang="he"' \
            || { echo "::error::Deployment did not serve the Hebrew RTL document"; exit 1; }
          # /blog is a file (blog.html) and, since articles are prebuilt, also a
          # directory (blog/<slug>.html). Production must still answer /blog
          # with the blog index's own page, not the shell or a 404.
          if [ "${{ steps.target.outputs.env }}" = production ]; then
            blog=$(npx vercel curl "$URL/blog")
            echo "$blog" | grep -qE '<link rel="canonical" href="[^"]*/blog"' \
              || { echo "::error::/blog is not served its prebuilt page"; exit 1; }
          fi
```

- [ ] **Step 4: Edit `.github/workflows/publish-blog.yml`**

Replace:
```yaml
    permissions:
      contents: read
```
with:
```yaml
    permissions:
      contents: read
      # To dispatch ci.yml at the end — the one workflow event GITHUB_TOKEN may
      # start, so no new secret is needed.
      actions: write
```
Append as the job's last step, after `Apply`:
```yaml

      # Articles are prebuilt into the site at deploy time (scripts/prerender.mjs),
      # so a newly published one has a full-HTML page only after the next
      # production deploy. Only after a real publish: a preview changes nothing,
      # and a failed Apply stops the job before this. If a push to main is
      # already running, the dispatched run supersedes it (ci.yml's concurrency
      # group) and deploys the same commit.
      - name: Rebuild the site so the new articles are prebuilt
        if: inputs.apply && steps.supabase-creds.outputs.ready == 'true'
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
        run: gh workflow run ci.yml --ref main -f deploy=true
```
Also update the header comment's second paragraph: after "…not a button that runs on every push." add the line `# A real publish ends by dispatching CI on main with deploy=true, which prebuilds the new articles' pages.`

- [ ] **Step 5: Run the workflow and deploy contracts**

Run: `cd $WT && npx vitest run tests/contract/workflow.contract.test.ts tests/contract/deploy-gate.contract.test.ts tests/contract/logging.contract.test.ts tests/contract/vercel-functions.contract.test.ts; echo "exit=$?"`
Expected: all pass, `exit=0`. The deploy-gate cases still hold: `deploy-supabase`'s `if` still begins `github.ref == 'refs/heads/main' &&`, and deploy-vercel's still begins `!cancelled() &&` / `needs.build.result == 'success'`.

- [ ] **Step 6: README**

In "### Branches", replace:
```
those two publish the report. Nor can the nightly run deploy — every deploy job
also requires a `push` event.
```
with:
```
those two publish the report. The nightly run deploys one thing: it rebuilds
and promotes the Vercel site from `main` (after deploying the Supabase functions
it calls, behind the same green gate), so an article edited from `/admin/blog`
has its prebuilt page the next morning. It never publishes Base44 — that still
takes a push or a manual run with `deploy` ticked.
```
Under "## Blog articles in the repo", after the "### Article addresses" section from Task 9, add:
```

### When an article's page is rebuilt

Article pages are prebuilt at deploy time, so a change reaches its page only on
the next production deploy. Two things make one without anyone asking:

- **Publishing from the "Publish blog drafts" workflow** ends by dispatching CI
  on `main` with `deploy` ticked (`gh workflow run ci.yml --ref main -f
  deploy=true`, with the workflow's own token — `workflow_dispatch` is the one
  event `GITHUB_TOKEN` may start, so there is no new secret). Only after a real
  publish; a preview dispatches nothing.
- **The nightly CI run** (22:00 Israel summer time) deploys the Supabase
  functions and promotes the Vercel build, which picks up anything published or
  edited from `/admin/blog` that day. It does not publish Base44.

Until then a new article is still reachable — the site renders it in the
browser, and a crawler gets its `<head>` from `api/og/blog.ts` — just not as
full HTML.
```

- [ ] **Step 7: Update the STD** — `tests/test-plan/03-std-contract.md`

In §4.4, at the end of the `**`workflow.contract.test.ts`**` paragraph add:
```
Since articles are prebuilt, the nightly run is no longer deploy-free: CTR-REB-001
requires `deploy-vercel` and `deploy-supabase` to run on `schedule` (the functions
first, because `--prod` waits for them), and a companion case keeps the Base44
publish — which ships the agents — off it. CTR-REB-002 pins that the publish
workflow ends by dispatching `ci.yml` on `main` with `deploy=true`, with
`actions: write` and only after a real publish. CTR-REB-003 requires
`PRERENDER_REQUIRED=1` on the production Vercel build only; CTR-REB-004 keeps
`PRERENDER_ARTICLES_FIXTURE` in the e2e `build` job and out of every other job
and `vercel.json`; CTR-REB-005 requires the production deploy check to fetch
`/blog`, which now shares its name with the `blog/` directory of articles.
```
In §6 change `All 558 cases pass.` to `All 566 cases pass.`

- [ ] **Step 8: Commit**

```bash
cd $WT && git add .github/workflows/ci.yml .github/workflows/publish-blog.yml tests/contract/workflow.contract.test.ts README.md tests/test-plan/03-std-contract.md && git commit -m "$(cat <<'EOF'
SEO PR1: publishing an article and the nightly run rebuild production

publish-blog dispatches ci.yml on main with deploy=true after a real
publish. The nightly run deploys the Supabase functions and promotes the
Vercel build (never Base44). A production build requires the article list.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_018GRkTcyX2bVf4dSieFC3yZ
EOF
)"
```

---

### Task 11: Full verification, the pre-merge migration, and the post-deploy checks

**Files:** none changed, unless a check below fails (fix it in the task that owns the file, then re-run).

**Interfaces:** none.

- [ ] **Step 1: Every suite the AGENTS.md checklist names**

```bash
cd $WT && npm run lint; echo "lint exit=$?"
npm run typecheck; echo "typecheck exit=$?"
npm run test:vitest; echo "vitest exit=$?"
CI=1 npx playwright test e2e/seo e2e/ui/blog.spec.ts e2e/security e2e/api/http-surface.spec.ts --project=web-chromium; echo "e2e exit=$?"
```
Expected: four lines ending `exit=0`.

- [ ] **Step 2: The CSP check over the prebuilt pages**

```bash
cd $WT && node scripts/check-csp-hashes.mjs dist; echo "csp exit=$?"
```
Expected: `csp exit=0`. That includes `dist/blog/bdikat-maslul-e2e.html`, which adds no inline script.

- [ ] **Step 3: Before merging, apply the migration to production** (the user does this, or the agent only at the user's explicit request)

Apply `supabase/migrations/20261014000000_blog_slug.sql` to production by hand. The project is `hjowdyiwjjrqceumkvgt`, DoritFinanaceSite. Record it in `supabase_migrations.schema_migrations`. Then verify, and only then merge.

The migration is additive and safe for the code running today:
- `contentAdmin`, `seed-blog.mjs` and `publish-blog.mjs` never send a slug, and the `blog_posts_fill_slug` trigger fills `post-<id>` for their inserts and upserts.
- Today's reads select named columns that do not include `slug`.

So by the time the merge deploys code that reads `slug`, the column is already there.

```bash
cd $WT && supabase link --project-ref hjowdyiwjjrqceumkvgt
supabase db push --dry-run; echo "exit=$?"
```
Expected: the dry run lists exactly one pending migration, `20261014000000_blog_slug.sql`. If it lists any other, stop and ask the user. Then:
```bash
cd $WT && supabase db push; echo "exit=$?"
```
`supabase db push` records the version in `supabase_migrations.schema_migrations` itself. If the file is applied through the SQL editor instead, record it by hand:
```sql
insert into supabase_migrations.schema_migrations (version, name) values ('20261014000000', 'blog_slug');
```
Expected: `exit=0`, and no `NOTICE: published article given a fallback slug` in the output. Any article that NOTICE names gets a real slug from `/admin/blog`, or a corrected title in the backfill before the next attempt.

Verify, read-only, in the SQL editor:
```sql
-- 22 published rows, every one with its expected slug.
select count(*) from public.blog_posts
 where published and slug in (
   'azavtem-avoda','bituach-chaim-mashkanta','bituach-nesiot','chisachon-lechol-yeled','hafkadot-maasik',
   'har-habituach-kfilut','hashvaa-gemel-net-pensia-net','hechzer-mas-lesachirim','horadat-dmei-nihul',
   'kesef-shenishkach','maslul-hashkaa','mi-metapel-bakesafim-hagdolim','mutavim','nolad-yeled-hitchatantem',
   'ovdan-kosher-avoda','shigrat-bdika-shnatit','sof-shana-atzmaim','tik-hamishpacha','tofes-101',
   'tsua-neto-arbaa-mishtanim','bituach-briut-digitali','pensia-beidan-ha-ai');                -- 22
select count(*) from public.blog_posts where published;                                   -- 22
select tgname from pg_trigger
 where tgrelid = 'public.blog_posts'::regclass and tgname = 'blog_posts_fill_slug';     -- one row
select version from supabase_migrations.schema_migrations where version = '20261014000000'; -- one row
```

- [ ] **Step 4: A production-shaped local build against the real Supabase (read-only)**

This runs after Step 3. It needs the real publishable key in `.env.local`, reads published rows and writes nothing.

```bash
cd $WT && rm -rf dist && PRERENDER_REQUIRED=1 npm run build:prerender; echo "exit=$?"; ls dist/blog | wc -l
```
Expected: `exit=0`, and `22` files in `dist/blog/`. If Supabase cannot be read, the build fails with `::error::The published articles cannot be prebuilt: …` and ships nothing. That is the prerender's fail-safe, and it is right whenever Supabase is unreachable.

- [ ] **Step 5: Write the PR description** with:
  - the note that the migration was applied before the merge (Step 3), with the verification counts
  - the spec-coverage table
  - for two articles, `curl` output showing body text, the canonical on `https://govari-fin.co.il/blog/<slug>` and the JSON-LD. Use Step 4's local build: `npx vite preview --port 4300 &` then `curl -s http://127.0.0.1:4300/blog/horadat-dmei-nihul | grep -o '<link rel="canonical"[^>]*>'`.

- [ ] **Step 6: Merge, then the post-deploy checks** (for the user; the agent does none of it without their explicit request)
  - [ ] Merge only after Step 3's verification passed.
  - [ ] After the production deploy:
    - `curl -s https://govari-fin.co.il/blog/horadat-dmei-nihul | grep -c 'צעד אחר צעד'` is ≥ 1.
    - `curl -sI https://govari-fin.co.il/blog/<a real Base44 id>` shows `301` and `location: /blog/<slug>`.
    - `curl -s https://govari-fin.co.il/blog | grep -o '<link rel="canonical"[^>]*>'` ends `/blog">`.
  - [ ] Closing summary for the user, PR 1 part: the slug migration applied before the merge, and the rename warning (no redirect table).

---

## Spec coverage

| Spec PR 1 requirement | Task |
|---|---|
| Migration: nullable `slug`, backfill 22 live rows by title (20 file names + 2 named), drafts `post-<id>`, then NOT NULL + UNIQUE + CHECK (plus a fallback trigger so it can be applied before the merge) | 2, 11 (applied pre-merge, on the user's request) |
| Writes: required admin slug field, client-side validation, prefilled, rename warning | 6 |
| `FunctionContentAdminService` sends it (the draft is forwarded whole) / `contentAdmin` passes `slug` to the Supabase mirror only | 1 (type), 5 |
| `seed-blog.mjs` sets `slug` from the file name | 8 |
| `slug` joins `ARTICLE_COLUMNS` and the `Article` port | 1, 3 |
| `/blog/:key` resolves slug → base44_id → uuid | 3, 4 |
| Every link builder emits `/blog/<slug>` (ArticleCard, FeaturedRow, Blog.tsx JSON-LD, blogSeo.ts, the recommender's cards) | 4 |
| Old-form URL → app replaces history with the slug URL | 4 |
| `vercel.json` routes `/blog/:id([0-9a-f]{24})` to `api/og/blog` for every UA; 301 for published, 404 + noindex otherwise | 9 |
| Bot rewrite stays, now reading Supabase by slug and filling the head | 9 |
| `prerender.mjs` reads published slugs (publishable key), writes `dist/blog/<slug>.html`; duplicate-title guard covers articles | 7 |
| Supabase unreachable at build time fails CI (`PRERENDER_REQUIRED=1`) | 7, 10 |
| `publish-blog.yml` ends with `gh workflow run ci.yml --ref main -f deploy=true` (`actions: write`) | 10 |
| `ci.yml` nightly run deploys production; README documents both | 10 |
| Tests: migration check | 2 |
| Tests: unit — key resolution, link builders, slug validation | 1, 3, 4 |
| Tests: contract — builders use the slug, vercel.json 24-hex route, publish dispatches a deploy | 4, 9, 10 |
| Tests: og handler 301 / 404 / head from Supabase | 9 |
| Tests: e2e prebuilt article without JS: body, canonical, JSON-LD | 7 |
| Global: AGENTS.md drift rule, STDs, CSP, no production writes, migration on request | 5 (AGENTS.md), every task (STDs), 11 |
| Done means: `build:prerender` writes a page per published article; curl shows body, canonical, JSON-LD for two articles | 11 |
