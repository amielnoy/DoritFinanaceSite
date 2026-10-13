# SEO PR 2 — Sitemap, llms.txt, llms-full.txt, IndexNow, verification tags — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every production build writes a sitemap and an `llms.txt` that list all published articles, a new `llms-full.txt` with the FAQ and every article's text, tells IndexNow about articles changed in the last 48 hours after each production deploy, and can emit the Google/Bing verification meta tags.

**Architecture:** A post-prerender build step (`scripts/build-seo-files.mjs`) rewrites `dist/sitemap.xml` and `dist/llms.txt` and writes `dist/llms-full.txt`, using the copies the site-url plugin has already pointed at the right host as templates, and the published-article list from `scripts/published-articles.mjs` (now paginated and truncation-checked). Pure string builders live in `scripts/seo-files.mjs` so they are unit-tested without a build. IndexNow runs as a non-fatal CI step after the production deploy and reads the live sitemap. Verification tags come from the site-url plugin's `transformIndexHtml`.

**Tech Stack:** Node ESM scripts (`.mjs`), Vite plugin API, Vitest, Playwright (e2e/api), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-13-seo-ai-visibility-design.md`, section "PR 2 — Sitemap, llms.txt, robots, IndexNow". PR 1 (#163) is merged and live.

## Global Constraints

- Follow AGENTS.md: contract tests for every cross-file rule; `tests/test-plan/` updated with each test change; README updated where a rule or file changed.
- `npm run lint`, `npm run typecheck`, `npm run test:vitest` green after every task.
- No deploys by hand, no `seed:blog --apply`, no production data writes.
- The enforced CSP (#161) stays green: no new inline scripts. Meta tags are not scripts.
- `public/llms.txt` stays the template: its header, contact, disclosure and limitations reach `dist/llms.txt` **verbatim**. Every existing `tests/contract/ai-surface.contract.test.ts` check keeps passing against `public/`.
- Sitemap: the 8 static routes carry **no `lastmod`** (no honest value exists); `/blog` gets the newest article's date; each article's `lastmod` is its `updated_at`.
- IndexNow submits only article URLs whose `lastmod` is within the last 48 h; an empty list submits nothing; a failed submission logs `::warning::` and **never fails the deploy**.
- Verification tags are emitted only when `VITE_GOOGLE_SITE_VERIFICATION` / `VITE_BING_SITE_VERIFICATION` are set, through the site-url plugin's HTML transform — never an inline script.
- The Base44 Builder's `npm run build` is unchanged: it ships `public/` as before (no generated files).
- IndexNow key (public by design): `871ea90b6bf1cbdeeb392aa9705d1246`.

## Review Focus

1. **A title or excerpt with `&`, `<`, `[`, `]` or a line break.** The sitemap stays valid XML and each `llms.txt` article stays one Markdown list line. Test in Task 2.
2. **An article with no excerpt or no `updated_at`.** Its `llms.txt` line has no dangling " — ", and its sitemap entry has no empty `<lastmod>`. Test in Task 2.
3. **Supabase unreachable in a preview build (not required).** The build ships the static sitemap and `llms.txt` with a warning instead of crashing. Production (`PRERENDER_REQUIRED=1`) fails. Tests in Tasks 1 and 3.
4. **More rows than one PostgREST page, or an answer with no total.** All rows are fetched, and a short or uncountable answer throws instead of silently shipping a partial sitemap. Test in Task 1.
5. **A verification variable holding the whole `<meta …>` tag** (the usual copy-paste mistake). The build fails with a message saying to paste only the `content` value. Test in Task 4.

---

### Task 1: Paginated, truncation-checked article reads, and one loader for every build step

**Files:**
- Modify: `scripts/published-articles.mjs`
- Modify: `tests/unit/published-articles.test.ts`
- Modify: `tests/test-plan/01-std-unit.md` (rows for the new cases, next to the existing published-articles rows)

**Interfaces:**
- Produces: `fetchPublishedArticles({ url, key, columns, fetchImpl, pageSize })` → `Promise<Row[]>` (now paginated); `loadPublishedArticles(env, { columns, fetchImpl, readFileImpl })` → `Promise<{ rows: Row[], fromFixture: boolean, warning: string | null }>`; `planArticles(env, opts)` keeps its exact current return shape `{ routes, fixtureRows, warning }`.

- [ ] **Step 1: Update the test helper and write the failing tests**

In `tests/unit/published-articles.test.ts`, change `answer` so every mocked response carries a `Content-Range` total, as PostgREST does with `Prefer: count=exact`:

```ts
const answer = (body: unknown, status = 200, total = Array.isArray(body) ? body.length : 0) =>
  vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json",
        "content-range": Array.isArray(body) && body.length ? `0-${body.length - 1}/${total}` : `*/${total}`,
      },
    }),
  );
```

Add the import of `loadPublishedArticles` to the existing import list. Then add:

```ts
describe("fetchPublishedArticles — every row, or an error", () => {
  const row = (i: number) => ({ slug: `article-${i}`, updated_at: "2026-10-01T00:00:00Z" });

  it("asks for an exact count and a range", async () => {
    const fetchImpl = answer([row(1)]);
    await fetchPublishedArticles({ url: URL_, key: KEY, fetchImpl });
    const headers = fetchImpl.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Prefer).toBe("count=exact");
    expect(headers["Range-Unit"]).toBe("items");
    expect(headers.Range).toBe("0-999");
  });

  it("reads page after page until the total is reached", async () => {
    const all = [row(1), row(2), row(3)];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const [from] = String((init?.headers as Record<string, string>).Range).split("-").map(Number);
      const page = all.slice(from, from + 2);
      return new Response(JSON.stringify(page), {
        status: 206,
        headers: { "content-range": `${from}-${from + page.length - 1}/3` },
      });
    });
    const rows = await fetchPublishedArticles({ url: URL_, key: KEY, fetchImpl, pageSize: 2 });
    expect(rows.map((r: { slug: string }) => r.slug)).toEqual(["article-1", "article-2", "article-3"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses an answer that has fewer rows than its own total", async () => {
    const fetchImpl = answer([row(1)], 200, 5);
    await expect(fetchPublishedArticles({ url: URL_, key: KEY, fetchImpl, pageSize: 1000 })).rejects.toThrow(
      /incomplete: 1 of 5/,
    );
  });

  it("refuses an answer with no total, because a cut-off list would look complete", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([row(1)]), { status: 200 }));
    await expect(fetchPublishedArticles({ url: URL_, key: KEY, fetchImpl })).rejects.toThrow(/Content-Range/);
  });

  it("accepts an empty published list when the total says zero", async () => {
    await expect(fetchPublishedArticles({ url: URL_, key: KEY, fetchImpl: answer([]) })).resolves.toEqual([]);
  });
});

describe("loadPublishedArticles — the same rules for every build step", () => {
  it("returns the live rows with the columns asked for", async () => {
    const fetchImpl = answer([{ slug: "a-b", title: "t" }]);
    const out = await loadPublishedArticles(SUPABASE_ENV, { columns: "slug,title", fetchImpl });
    expect(out).toEqual({ rows: [{ slug: "a-b", title: "t" }], fromFixture: false, warning: null });
    expect(String(fetchImpl.mock.calls[0][0])).toContain("select=slug%2Ctitle");
  });

  it("returns the fixture rows in the e2e build", async () => {
    const out = await loadPublishedArticles(
      { PRERENDER_ARTICLES_FIXTURE: "f.json" },
      { readFileImpl: readFixture(FIXTURE) },
    );
    expect(out.fromFixture).toBe(true);
    expect(out.rows).toEqual(FIXTURE);
  });

  it("warns and returns no rows when the list cannot be had and is not required", async () => {
    const out = await loadPublishedArticles(SUPABASE_ENV, { fetchImpl: answer({}, 500) });
    expect(out.rows).toEqual([]);
    expect(out.warning).toMatch(/HTTP 500/);
  });

  it("throws when the list cannot be had and is required", async () => {
    await expect(
      loadPublishedArticles({ ...SUPABASE_ENV, PRERENDER_REQUIRED: "1" }, { fetchImpl: answer({}, 500) }),
    ).rejects.toThrow(/HTTP 500/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/published-articles.test.ts`
Expected: FAIL. `loadPublishedArticles` is not exported; the header and pagination assertions fail.

- [ ] **Step 3: Implement**

In `scripts/published-articles.mjs`, replace `fetchPublishedArticles` with:

```js
/** PostgREST's page size here. Supabase caps a single answer (max-rows), so a list is read in pages. */
export const PAGE_SIZE = 1000

/**
 * Every published article's row, newest first.
 *
 * `columns` must include `slug`. Throws — never returns a short or empty list
 * it cannot vouch for — when a read fails, when an answer has no total
 * (`Content-Range: <from>-<to>/<total>`, asked for with `Prefer: count=exact`),
 * or when the rows read fall short of that total. A cut-off list would build a
 * sitemap missing articles and look like success.
 */
export async function fetchPublishedArticles({
  url,
  key,
  columns = 'slug,updated_at',
  fetchImpl = fetch,
  pageSize = PAGE_SIZE,
}) {
  const params = new URLSearchParams({ select: columns, published: 'eq.true', order: 'created_at.desc' })
  const endpoint = `${url.replace(/\/+$/, '')}/rest/v1/blog_posts?${params}`
  const rows = []
  let total = null
  for (let from = 0; total === null || from < total; from += pageSize) {
    const res = await fetchImpl(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        Prefer: 'count=exact',
        'Range-Unit': 'items',
        Range: `${from}-${from + pageSize - 1}`,
      },
    })
    if (!res.ok) throw new Error(`blog_posts read failed: HTTP ${res.status}`)
    const page = await res.json().catch(() => null)
    if (!Array.isArray(page)) throw new Error('blog_posts read failed: the answer is not a list')
    const counted = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '')
    if (!counted) {
      throw new Error(
        'blog_posts read failed: no total in Content-Range, so a cut-off list could not be told from a complete one',
      )
    }
    total = Number(counted[1])
    rows.push(...page)
    if (page.length === 0) break
  }
  if (rows.length !== total) throw new Error(`blog_posts read is incomplete: ${rows.length} of ${total} rows`)
  assertSlugs(rows, 'blog_posts')
  return rows
}
```

Add `loadPublishedArticles`. It holds the environment rules that `planArticles` has today: fixture mode, its two refusals, the missing-credentials case and `PRERENDER_REQUIRED`. Then rewrite `planArticles` on top of it:

```js
/**
 * The published articles a build step works from, decided from the build's
 * environment. One function so the prerender and the SEO files cannot disagree
 * about what is published. Rules:
 *
 *   PRERENDER_ARTICLES_FIXTURE     A JSON file of rows with a slug, for the e2e
 *                                  build. Refused in a Vercel build and in a
 *                                  bundle that reads Supabase.
 *   VITE_SUPABASE_URL +
 *   VITE_SUPABASE_PUBLISHABLE_KEY  The live list, with the columns asked for.
 *   PRERENDER_REQUIRED=1           A list that cannot be had throws. Without it
 *                                  the step warns and goes on with no articles.
 */
export async function loadPublishedArticles(
  env,
  { columns = 'slug,updated_at', fetchImpl = fetch, readFileImpl = readFile } = {},
) {
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
    return { rows, fromFixture: true, warning: null }
  }

  if (!url || !key) {
    const why =
      'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not both set, so the published articles cannot be listed'
    if (required) throw new Error(`${why}.`)
    return { rows: [], fromFixture: false, warning: `${why}; articles are left out.` }
  }

  try {
    return { rows: await fetchPublishedArticles({ url, key, columns, fetchImpl }), fromFixture: false, warning: null }
  } catch (err) {
    if (required) throw err
    return { rows: [], fromFixture: false, warning: `Could not list the published articles (${err.message}); articles are left out.` }
  }
}

/** Which articles this build prebuilds: routes, the fixture rows (null outside fixture mode) and a warning. */
export async function planArticles(env, opts = {}) {
  const { rows, fromFixture, warning } = await loadPublishedArticles(env, opts)
  return {
    routes: [...new Set(rows.map((r) => articleRoute(r.slug)))],
    fixtureRows: fromFixture ? rows : null,
    warning: warning && warning.replace('articles are left out', 'articles are not prebuilt'),
  }
}
```

Keep the module's header comment. Update its second paragraph to say that the prerender and `scripts/build-seo-files.mjs` both read the list through `loadPublishedArticles`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/published-articles.test.ts`
Expected: PASS, including every pre-existing `planArticles` case unchanged. If a pre-existing case asserted the old warning wording, it still matches, because the `.replace` keeps "articles are not prebuilt".

- [ ] **Step 5: Run the full suite, lint and typecheck, then commit**

Run: `npm run lint && npm run typecheck && npm run test:vitest`
Expected: all green.

```bash
git add scripts/published-articles.mjs tests/unit/published-articles.test.ts tests/test-plan/01-std-unit.md
git commit -m "seo: read published articles in pages and refuse a cut-off list; one loader for every build step"
```

---

### Task 2: Pure builders for the sitemap, llms.txt and llms-full.txt

**Files:**
- Create: `scripts/seo-files.mjs`
- Create: `tests/unit/seo-files.test.ts`
- Modify: `tests/test-plan/01-std-unit.md`

**Interfaces:**
- Consumes: `articleRoute(slug)` from `scripts/published-articles.mjs`.
- Produces: `originFromSitemap(xml): string`; `lastmodOf(row): string | null`; `buildSitemap(templateXml, articles): string`; `buildLlms(template, origin, articles): string`; `buildLlmsFull(template, origin, faq, articles): string`. `articles` are rows with `slug`, `title`, `excerpt?`, `body?`, `updated_at?` (plus the fixture's `created_date`); `faq` is `{ q: string, a: string }[]`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/seo-files.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildLlms,
  buildLlmsFull,
  buildSitemap,
  lastmodOf,
  originFromSitemap,
  // @ts-expect-error — plain .mjs tooling, imported for its pure steps.
} from "../../scripts/seo-files.mjs";

const ORIGIN = "https://govari-fin.co.il";
const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${ORIGIN}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${ORIGIN}/blog</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>
`;
const LLMS = `# כותרת

> גילוי

## פרטי קשר

- טלפון

## מגבלות שחשוב לדעת עליהן

- אין ייעוץ

## דפים

- [דף הבית](${ORIGIN}/)

## הערה למנועי חיפוש ולסוכני AI

הערה.
`;
const A = { slug: "horadat-dmei-nihul", title: "הורדת דמי ניהול", excerpt: "איך מורידים.", body: "גוף המאמר.", updated_at: "2026-10-10T08:00:00Z" };
const B = { slug: "kesef-shenishkach", title: "כסף [שנשכח] & <אבוד>", excerpt: null, body: "שורה\nשנייה", updated_at: null, created_at: "2026-09-01T00:00:00Z" };

describe("originFromSitemap", () => {
  it("reads the host the site-url plugin already chose", () => {
    expect(originFromSitemap(SITEMAP)).toBe(ORIGIN);
  });
  it("refuses a sitemap with no https <loc>", () => {
    expect(() => originFromSitemap("<urlset></urlset>")).toThrow(/no <loc>/);
  });
});

describe("lastmodOf", () => {
  it("prefers updated_at, then the created dates, and normalises to ISO", () => {
    expect(lastmodOf(A)).toBe("2026-10-10T08:00:00.000Z");
    expect(lastmodOf(B)).toBe("2026-09-01T00:00:00.000Z");
    expect(lastmodOf({ created_date: "2026-10-01T09:00:00Z" })).toBe("2026-10-01T09:00:00.000Z");
  });
  it("is null when there is no usable date", () => {
    expect(lastmodOf({})).toBeNull();
    expect(lastmodOf({ updated_at: "not a date" })).toBeNull();
  });
});

describe("buildSitemap", () => {
  const xml = buildSitemap(SITEMAP, [A, B]);

  it("keeps the static routes without a lastmod", () => {
    expect(xml).toMatch(new RegExp(`<loc>${ORIGIN}/</loc>\\s*<changefreq>`));
  });
  it("dates /blog by its newest article", () => {
    expect(xml).toMatch(new RegExp(`<loc>${ORIGIN}/blog</loc>\\s*<lastmod>2026-10-10T08:00:00.000Z</lastmod>`));
  });
  it("adds every article at /blog/<slug> with its own lastmod", () => {
    expect(xml).toContain(`<loc>${ORIGIN}/blog/horadat-dmei-nihul</loc>\n    <lastmod>2026-10-10T08:00:00.000Z</lastmod>`);
    expect(xml).toContain(`<loc>${ORIGIN}/blog/kesef-shenishkach</loc>\n    <lastmod>2026-09-01T00:00:00.000Z</lastmod>`);
  });
  it("writes no empty lastmod for an article without a date", () => {
    const out = buildSitemap(SITEMAP, [{ slug: "no-date", title: "t" }]);
    expect(out).not.toContain("<lastmod></lastmod>");
    expect(out).toContain(`<loc>${ORIGIN}/blog/no-date</loc>\n    <changefreq>`);
  });
  it("stays one well-formed urlset", () => {
    expect(xml.match(/<urlset/g)).toHaveLength(1);
    expect(xml.trim().endsWith("</urlset>")).toBe(true);
    expect(xml.match(/<url>/g)).toHaveLength(4);
  });
  it("leaves /blog undated when there are no articles", () => {
    expect(buildSitemap(SITEMAP, [])).toBe(SITEMAP);
  });
});

describe("buildLlms", () => {
  const out = buildLlms(LLMS, ORIGIN, [A, B]);

  it("keeps everything before the pages list verbatim", () => {
    expect(out.startsWith(LLMS.slice(0, LLMS.indexOf("## דפים")))).toBe(true);
  });
  it("adds an articles section before the crawler note, one line per article", () => {
    const section = out.slice(out.indexOf("## מאמרים"), out.indexOf("## הערה למנועי חיפוש ולסוכני AI"));
    expect(section).toContain(`- [הורדת דמי ניהול](${ORIGIN}/blog/horadat-dmei-nihul) — איך מורידים.`);
    expect(section).toContain(`- [כסף (שנשכח) & <אבוד>](${ORIGIN}/blog/kesef-shenishkach)\n`);
    expect(section.split("\n").filter((l) => l.startsWith("- ["))).toHaveLength(2);
  });
  it("points at llms-full.txt from the crawler note", () => {
    expect(out).toContain(`${ORIGIN}/llms-full.txt`);
  });
  it("collapses a line break in an excerpt so the list stays a list", () => {
    const one = buildLlms(LLMS, ORIGIN, [{ ...A, excerpt: "שורה\nשנייה" }]);
    expect(one).toContain("— שורה שנייה");
  });
  it("refuses a template without the crawler note it inserts before", () => {
    expect(() => buildLlms("# x\n", ORIGIN, [A])).toThrow(/הערה למנועי חיפוש/);
  });
});

describe("buildLlmsFull", () => {
  const out = buildLlmsFull(LLMS, ORIGIN, [{ q: "מה זה?", a: "תשובה." }], [A, B]);

  it("opens with the identity, contact, disclosure and limitations, verbatim", () => {
    expect(out.startsWith(LLMS.slice(0, LLMS.indexOf("## דפים")))).toBe(true);
    expect(out).not.toContain("## דפים");
  });
  it("carries every question and answer under its own heading", () => {
    expect(out).toContain(`## שאלות ותשובות\n\nמקור: ${ORIGIN}/faq\n\n### מה זה?\n\nתשובה.\n`);
  });
  it("carries every article's text under its title and address", () => {
    expect(out).toContain(`### הורדת דמי ניהול\n\n${ORIGIN}/blog/horadat-dmei-nihul · עודכן 2026-10-10\n\nגוף המאמר.\n`);
    expect(out).toContain(`${ORIGIN}/blog/kesef-shenishkach · עודכן 2026-09-01\n\nשורה\nשנייה\n`);
  });
  it("refuses a template without the pages heading it cuts at", () => {
    expect(() => buildLlmsFull("# x\n", ORIGIN, [], [])).toThrow(/## דפים/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/seo-files.test.ts`
Expected: FAIL with "Failed to load url ../../scripts/seo-files.mjs".

- [ ] **Step 3: Implement `scripts/seo-files.mjs`**

```js
// The SEO files a build writes from the published articles: sitemap.xml,
// llms.txt and llms-full.txt. Pure string work, so it is tested without a
// build; scripts/build-seo-files.mjs does the reading and writing.
//
// The templates are the emitted copies of public/sitemap.xml and
// public/llms.txt, which the site-url plugin has already pointed at the
// configured host. Reading the host back from them means these files cannot
// name a different host from the rest of the build.

import { articleRoute } from './published-articles.mjs'

const PAGES_HEADING = '## דפים'
const CRAWLER_NOTE = '## הערה למנועי חיפוש ולסוכני AI'

const xmlEscape = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** One line of text: line breaks and runs of spaces become one space. */
const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

/** A link label: square brackets would end the Markdown link early, so they become parentheses. */
const linkLabel = (value) => oneLine(value).replace(/\[/g, '(').replace(/\]/g, ')')

/** The origin of the first https <loc> — the home page in public/sitemap.xml. */
export function originFromSitemap(xml) {
  const loc = /<loc>(https:\/\/[^<]+)<\/loc>/.exec(xml)
  if (!loc) throw new Error('sitemap.xml has no <loc> with an https URL to take the host from')
  return new URL(loc[1]).origin
}

/** An article's last change as an ISO timestamp, or null when it has no usable date. */
export function lastmodOf(row) {
  const raw = row?.updated_at ?? row?.updated_date ?? row?.created_at ?? row?.created_date
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * The template sitemap plus one entry per article. Static routes keep no
 * lastmod — there is no honest value for them; /blog takes its newest article's.
 */
export function buildSitemap(templateXml, articles) {
  if (articles.length === 0) return templateXml
  const origin = originFromSitemap(templateXml)
  const blogLoc = `<loc>${origin}/blog</loc>`
  if (!templateXml.includes(blogLoc)) throw new Error(`sitemap.xml template has no ${blogLoc}`)
  if (!templateXml.includes('</urlset>')) throw new Error('sitemap.xml template has no </urlset>')

  const newest = articles.map(lastmodOf).filter(Boolean).sort().at(-1)
  let xml = newest ? templateXml.replace(blogLoc, `${blogLoc}\n    <lastmod>${newest}</lastmod>`) : templateXml

  const entries = articles
    .map((article) => {
      const lastmod = lastmodOf(article)
      return (
        '  <url>\n' +
        `    <loc>${xmlEscape(origin + articleRoute(article.slug))}</loc>\n` +
        (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '') +
        '    <changefreq>monthly</changefreq>\n' +
        '    <priority>0.6</priority>\n' +
        '  </url>\n'
      )
    })
    .join('')
  return xml.replace('</urlset>', `${entries}</urlset>`)
}

/**
 * The template llms.txt with an "מאמרים" section before the crawler note, and
 * a pointer to llms-full.txt at the end of that note. Everything above the
 * inserted section is the template, byte for byte.
 */
export function buildLlms(template, origin, articles) {
  const at = template.indexOf(CRAWLER_NOTE)
  if (at === -1) throw new Error(`llms.txt template has no "${CRAWLER_NOTE}" heading`)
  const lines = articles.map((article) => {
    const excerpt = oneLine(article.excerpt)
    return `- [${linkLabel(article.title)}](${origin}${articleRoute(article.slug)})${excerpt ? ` — ${excerpt}` : ''}`
  })
  const section = articles.length ? `## מאמרים\n\n${lines.join('\n')}\n\n` : ''
  const full =
    `\nהטקסט המלא של השאלות והתשובות ושל כל המאמרים, בקובץ אחד: [llms-full.txt](${origin}/llms-full.txt).\n`
  return template.slice(0, at) + section + template.slice(at).replace(/\n*$/, '\n') + full
}

/**
 * The full text an assistant can read in one request: the template's header
 * (identity, contact, disclosure, limitations — everything before "## דפים"),
 * every question and answer, and every article's body under its title and
 * address.
 */
export function buildLlmsFull(template, origin, faq, articles) {
  const at = template.indexOf(PAGES_HEADING)
  if (at === -1) throw new Error(`llms.txt template has no "${PAGES_HEADING}" heading`)
  const parts = [template.slice(0, at).replace(/\n*$/, '\n\n')]

  parts.push(`## שאלות ותשובות\n\nמקור: ${origin}/faq\n\n`)
  for (const { q, a } of faq) parts.push(`### ${oneLine(q)}\n\n${String(a).trim()}\n\n`)

  if (articles.length) {
    parts.push('## מאמרים\n\n')
    for (const article of articles) {
      const lastmod = lastmodOf(article)
      const dated = lastmod ? ` · עודכן ${lastmod.slice(0, 10)}` : ''
      parts.push(
        `### ${oneLine(article.title)}\n\n${origin}${articleRoute(article.slug)}${dated}\n\n${String(article.body ?? '').trim()}\n\n`,
      )
    }
  }
  return parts.join('').replace(/\n+$/, '\n')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/seo-files.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite, then commit**

Run: `npm run lint && npm run typecheck && npm run test:vitest`

```bash
git add scripts/seo-files.mjs tests/unit/seo-files.test.ts tests/test-plan/01-std-unit.md
git commit -m "seo: pure builders for the sitemap, llms.txt and llms-full.txt"
```

---

### Task 3: Write the files after prerender; robots.txt names llms-full.txt; served-file checks

**Files:**
- Create: `scripts/build-seo-files.mjs`
- Modify: `package.json` (`build:prerender`)
- Modify: `public/robots.txt`
- Modify: `tests/contract/ai-surface.contract.test.ts` (robots names llms-full.txt; the build step is wired)
- Modify: `e2e/api/http-surface.spec.ts`
- Modify: `tests/test-plan/03-std-contract.md`, `tests/test-plan/05-std-api.md`

**Interfaces:**
- Consumes: `loadPublishedArticles` (Task 1); `buildSitemap`, `buildLlms`, `buildLlmsFull`, `originFromSitemap` (Task 2); `FAQ_ENTRIES` from `src/content/faq.ts` (`{ q, a }` fields).
- Produces: `dist/sitemap.xml`, `dist/llms.txt` and `dist/llms-full.txt` in every `build:prerender` output.

- [ ] **Step 1: Confirm Node can import the FAQ module directly**

Run: `node -e "import('./src/content/faq.ts').then((m) => console.log(m.FAQ_ENTRIES.length))"`
Expected: a number above 20, perhaps after a type-stripping warning. CI uses Node 22 (type stripping is on by default from 22.18) and Vercel Node 24. If this fails, stop and report BLOCKED with the error. Do not copy the FAQ into the script.

- [ ] **Step 2: Write the failing contract and e2e checks**

In `tests/contract/ai-surface.contract.test.ts`, inside `describe("robots.txt — who is allowed to read it", …)`:

```ts
  it("tells a crawler where the full text is", () => {
    expect(robots).toMatch(/^# .*\/llms-full\.txt/m);
  });
```

Add a new block at the end of the file:

```ts
describe("the SEO files are written by every prerendered build", () => {
  it("runs build-seo-files after the prerender, in the build Vercel and CI run", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["build:prerender"]).toBe(
      "vite build && node scripts/prerender.mjs && node scripts/build-seo-files.mjs",
    );
  });

  it("leaves the Base44 Builder's plain build alone", () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.build).toBe("vite build");
  });
});
```

Use the file's existing `robots`, `readFileSync`, `join` and `REPO_ROOT` names. Read the top of the file and adapt to what it actually calls them.

In `e2e/api/http-surface.spec.ts`, after the `llms.txt is published` test:

```ts
  test("the sitemap lists the prebuilt article", async ({ request }) => {
    const body = await test_step("GET /sitemap.xml", async () => (await request.get("/sitemap.xml")).text());
    await test_step("the fixture article is listed with a lastmod", async () => {
      expect(body).toMatch(/<loc>https:\/\/[^<]+\/blog\/bdikat-maslul-e2e<\/loc>\s*<lastmod>[^<]+<\/lastmod>/);
    });
  });

  test("llms.txt lists the articles and points at the full text", async ({ request }) => {
    const body = await test_step("GET /llms.txt", async () => (await request.get("/llms.txt")).text());
    await test_step("it has an articles section and the llms-full link", async () => {
      expect(body).toContain("## מאמרים");
      expect(body).toMatch(/\/blog\/bdikat-maslul-e2e\)/);
      expect(body).toContain("/llms-full.txt");
    });
  });

  test("llms-full.txt carries the questions and the articles as text", async ({ request }) => {
    const res = await test_step("GET /llms-full.txt", () => request.get("/llms-full.txt"));
    await test_step("it is served as plain text with both sections", async () => {
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/plain");
      const body = await res.text();
      expect(body).toContain("## שאלות ותשובות");
      expect(body).toContain("## מאמרים");
      expect(body).toContain("L-00107009");
    });
  });
```

- [ ] **Step 3: Run the contract test to verify it fails**

Run: `npx vitest run tests/contract/ai-surface.contract.test.ts`
Expected: FAIL on the two new checks.

- [ ] **Step 4: Implement**

`scripts/build-seo-files.mjs`:

```js
// After the prerender: sitemap.xml and llms.txt with every published article,
// and llms-full.txt with the FAQ and every article's text.
//
// Runs as the last step of `npm run build:prerender` (Vercel and CI). The
// Base44 Builder's `npm run build` does not run it and ships public/ as is.
//
// Templates are the dist/ copies, already pointed at the configured host by the
// site-url plugin (scripts/vite-site-url-plugin.mjs). The article list follows
// the prerender's rules (scripts/published-articles.mjs): production
// (PRERENDER_REQUIRED=1) fails without it; a preview warns and ships the
// static files.

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FAQ_ENTRIES } from '../src/content/faq.ts'
import { loadPublishedArticles } from './published-articles.mjs'
import { buildLlms, buildLlmsFull, buildSitemap, originFromSitemap } from './seo-files.mjs'

const DIST = join(process.cwd(), 'dist')
const COLUMNS = 'slug,title,excerpt,body,updated_at,created_at'

async function main() {
  let loaded
  try {
    loaded = await loadPublishedArticles(process.env, { columns: COLUMNS })
  } catch (err) {
    console.error(`\n::error::SEO files: ${err.message}`)
    process.exit(1)
  }
  if (loaded.warning) console.warn(`::warning::SEO files: ${loaded.warning}`)
  const articles = loaded.rows

  const sitemapTemplate = await readFile(join(DIST, 'sitemap.xml'), 'utf8')
  const llmsTemplate = await readFile(join(DIST, 'llms.txt'), 'utf8')
  const origin = originFromSitemap(sitemapTemplate)
  const faq = FAQ_ENTRIES.map(({ q, a }) => ({ q, a }))

  await writeFile(join(DIST, 'sitemap.xml'), buildSitemap(sitemapTemplate, articles), 'utf8')
  await writeFile(join(DIST, 'llms.txt'), buildLlms(llmsTemplate, origin, articles), 'utf8')
  await writeFile(join(DIST, 'llms-full.txt'), buildLlmsFull(llmsTemplate, origin, faq, articles), 'utf8')

  console.log(`SEO files: ${articles.length} articles and ${faq.length} questions on ${origin}.`)
}

main().catch((err) => {
  console.error(`\n::error::SEO files: ${err.stack ?? err.message}`)
  process.exit(1)
})
```

`package.json`: set `"build:prerender": "vite build && node scripts/prerender.mjs && node scripts/build-seo-files.mjs"`.

`public/robots.txt`: in the comment block about AI assistants, replace the sentence that says this is a client-rendered app and only `/llms.txt` can be read. It is out of date since PR 1. Use:

```
# JavaScript. The public pages and every article are served as prebuilt HTML;
# /llms.txt summarises the site, and /llms-full.txt carries the full text of
# the questions and answers and of every article, in one file.
```

Keep the line before it ("…Most of these crawlers do not run") reading naturally into it. Leave the `Sitemap:` line as it is; the site-url plugin rewrites its host.

- [ ] **Step 5: Run the checks and a real build**

Run: `npx vitest run tests/contract/ai-surface.contract.test.ts`
Expected: PASS.

Run the e2e build the way CI builds it, then check the files:

```bash
env -u VITE_SUPABASE_URL -u VITE_SUPABASE_PUBLISHABLE_KEY PRERENDER_ARTICLES_FIXTURE=e2e/fixtures/prerender-articles.json CI=1 npm run build:prerender
grep -c "<url>" dist/sitemap.xml        # 9 (8 static + the fixture article)
grep -c "bdikat-maslul-e2e" dist/llms.txt dist/llms-full.txt   # 1 each, at least
```

Run: `npx playwright test e2e/api/http-surface.spec.ts --project=web-chromium`
Expected: PASS. It serves the `dist/` you just built; see `playwright.config.ts` for how. `git checkout package-lock.json` if the build touched it.

- [ ] **Step 6: Full suite, update the test plan, commit**

Add rows to `tests/test-plan/03-std-contract.md` (the two contract checks plus the robots check) and `tests/test-plan/05-std-api.md` (the three e2e tests), in each file's existing ID style.

Run: `npm run lint && npm run typecheck && npm run test:vitest`

```bash
git add scripts/build-seo-files.mjs package.json public/robots.txt tests/contract/ai-surface.contract.test.ts e2e/api/http-surface.spec.ts tests/test-plan/03-std-contract.md tests/test-plan/05-std-api.md
git commit -m "seo: every prerendered build writes the sitemap, llms.txt and llms-full.txt with the published articles"
```

---

### Task 4: Search Console and Bing verification tags from the environment

**Files:**
- Modify: `scripts/vite-site-url-plugin.mjs`
- Create: `tests/unit/site-verification.test.ts`
- Modify: `tests/test-plan/01-std-unit.md`

**Interfaces:**
- Produces: `verificationTags(env): { tag: 'meta', attrs: { name: string, content: string }, injectTo: 'head' }[]`, exported from `scripts/vite-site-url-plugin.mjs`; the plugin gains `transformIndexHtml()` returning it.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs tooling.
import { siteUrl, verificationTags } from "../../scripts/vite-site-url-plugin.mjs";

describe("verification tags", () => {
  it("emits nothing when neither variable is set", () => {
    expect(verificationTags({})).toEqual([]);
  });

  it("emits Google's and Bing's tags from their variables", () => {
    expect(
      verificationTags({ VITE_GOOGLE_SITE_VERIFICATION: "abc_DEF-123456", VITE_BING_SITE_VERIFICATION: "0123456789ABCDEF" }),
    ).toEqual([
      { tag: "meta", attrs: { name: "google-site-verification", content: "abc_DEF-123456" }, injectTo: "head" },
      { tag: "meta", attrs: { name: "msvalidate.01", content: "0123456789ABCDEF" }, injectTo: "head" },
    ]);
  });

  it("ignores a variable that is set but blank", () => {
    expect(verificationTags({ VITE_BING_SITE_VERIFICATION: "  " })).toEqual([]);
  });

  it("refuses a whole pasted <meta> tag and says what to paste", () => {
    expect(() =>
      verificationTags({ VITE_GOOGLE_SITE_VERIFICATION: '<meta name="google-site-verification" content="abc" />' }),
    ).toThrow(/only the content value/);
  });

  it("is what the plugin injects into index.html", () => {
    const plugin = siteUrl({ env: { VITE_BING_SITE_VERIFICATION: "0123456789ABCDEF" } });
    plugin.configResolved({ env: {}, build: { outDir: "dist" } });
    expect(plugin.transformIndexHtml()).toEqual(verificationTags({ VITE_BING_SITE_VERIFICATION: "0123456789ABCDEF" }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/site-verification.test.ts`
Expected: FAIL. `verificationTags` is not exported.

- [ ] **Step 3: Implement**

In `scripts/vite-site-url-plugin.mjs`, add above `siteUrl`:

```js
/**
 * Search Console's and Bing Webmaster Tools' ownership tags, from the build's
 * env. Emitted as <meta> by Vite's HTML transform rather than written into
 * index.html, so a build without the variables carries no empty tag. They
 * are not scripts, so the enforced CSP is untouched. Every prerendered page is
 * a snapshot of this document and carries them too.
 */
const VERIFICATION = [
  ['VITE_GOOGLE_SITE_VERIFICATION', 'google-site-verification'],
  ['VITE_BING_SITE_VERIFICATION', 'msvalidate.01'],
]
const VERIFICATION_TOKEN = /^[A-Za-z0-9_-]{8,128}$/

export function verificationTags(env = {}) {
  const tags = []
  for (const [variable, name] of VERIFICATION) {
    const value = (env[variable] ?? '').trim()
    if (!value) continue
    if (!VERIFICATION_TOKEN.test(value)) {
      throw new Error(
        `${variable} must be only the content value of the verification tag (letters, digits, "_" and "-"), ` +
          'not the whole <meta> tag.',
      )
    }
    tags.push({ tag: 'meta', attrs: { name, content: value }, injectTo: 'head' })
  }
  return tags
}
```

Inside the returned plugin object, after `configResolved`:

```js
    transformIndexHtml() {
      return verificationTags(resolved ?? {})
    },
```

- [ ] **Step 4: Run, build once with a value, and check the output**

Run: `npx vitest run tests/unit/site-verification.test.ts`
Expected: PASS.

```bash
VITE_BING_SITE_VERIFICATION=0123456789ABCDEF npx vite build --outDir /tmp/seo-verify-check >/dev/null && grep -o '<meta name="msvalidate.01"[^>]*>' /tmp/seo-verify-check/index.html; rm -rf /tmp/seo-verify-check
```

Expected: one `<meta name="msvalidate.01" content="0123456789ABCDEF">`.

- [ ] **Step 5: Full suite and commit**

Run: `npm run lint && npm run typecheck && npm run test:vitest`

```bash
git add scripts/vite-site-url-plugin.mjs tests/unit/site-verification.test.ts tests/test-plan/01-std-unit.md
git commit -m "seo: Search Console and Bing verification tags from VITE_*_SITE_VERIFICATION"
```

---

### Task 5: IndexNow — key file, submission script, non-fatal post-deploy step

**Files:**
- Create: `public/871ea90b6bf1cbdeeb392aa9705d1246.txt` (content: the key, then a newline)
- Create: `scripts/indexnow.mjs`
- Create: `tests/unit/indexnow.test.ts`
- Create: `tests/contract/indexnow.contract.test.ts`
- Modify: `.github/workflows/ci.yml` (`deploy-vercel` job, after "Verify the deployment serves the app")
- Modify: `tests/test-plan/01-std-unit.md`, `tests/test-plan/03-std-contract.md`

**Interfaces:**
- Produces: `INDEXNOW_KEY`, `recentUrls(sitemapXml, now, hours = 48): string[]`, `indexNowBody(origin, urls)`, `submit({ origin, fetchImpl, now, log }): Promise<{ submitted: number }>`. `submit` never throws.

- [ ] **Step 1: Write the failing tests**

`tests/unit/indexnow.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error — plain .mjs tooling.
import { INDEXNOW_KEY, indexNowBody, recentUrls, submit } from "../../scripts/indexnow.mjs";

const ORIGIN = "https://govari-fin.co.il";
const NOW = new Date("2026-10-13T12:00:00Z");
const SITEMAP = `<urlset>
  <url><loc>${ORIGIN}/</loc><changefreq>weekly</changefreq></url>
  <url><loc>${ORIGIN}/blog</loc><lastmod>2026-10-13T08:00:00.000Z</lastmod></url>
  <url><loc>${ORIGIN}/blog/fresh</loc><lastmod>2026-10-13T08:00:00.000Z</lastmod></url>
  <url><loc>${ORIGIN}/blog/yesterday</loc><lastmod>2026-10-12T13:00:00.000Z</lastmod></url>
  <url><loc>${ORIGIN}/blog/old</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod></url>
</urlset>`;

describe("recentUrls", () => {
  it("returns only articles changed within the window", () => {
    expect(recentUrls(SITEMAP, NOW)).toEqual([`${ORIGIN}/blog/fresh`, `${ORIGIN}/blog/yesterday`]);
  });
  it("never submits static routes, even /blog with a fresh lastmod", () => {
    expect(recentUrls(SITEMAP, NOW)).not.toContain(`${ORIGIN}/blog`);
  });
  it("is empty when nothing changed", () => {
    expect(recentUrls(SITEMAP, new Date("2026-11-30T00:00:00Z"))).toEqual([]);
  });
});

describe("indexNowBody", () => {
  it("names the host, the key and where the key file is", () => {
    expect(indexNowBody(ORIGIN, ["u"])).toEqual({
      host: "govari-fin.co.il",
      key: INDEXNOW_KEY,
      keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`,
      urlList: ["u"],
    });
  });
});

describe("submit — never fails the deploy", () => {
  const sitemapThen = (indexnow: Response | Error) =>
    vi.fn(async (url: string) => {
      if (url.endsWith("/sitemap.xml")) return new Response(SITEMAP, { status: 200 });
      if (indexnow instanceof Error) throw indexnow;
      return indexnow;
    });
  const log = { info: vi.fn(), warn: vi.fn() };

  it("posts the recent articles to IndexNow", async () => {
    const fetchImpl = sitemapThen(new Response(null, { status: 202 }));
    await expect(submit({ origin: ORIGIN, fetchImpl, now: NOW, log })).resolves.toEqual({ submitted: 2 });
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://api.indexnow.org/indexnow");
    expect(JSON.parse(String(init.body)).urlList).toHaveLength(2);
  });

  it("submits nothing when no article changed", async () => {
    const fetchImpl = sitemapThen(new Response(null, { status: 200 }));
    await expect(
      submit({ origin: ORIGIN, fetchImpl, now: new Date("2026-11-30T00:00:00Z"), log }),
    ).resolves.toEqual({ submitted: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("warns and resolves on a refused submission", async () => {
    const warn = vi.fn();
    await expect(
      submit({ origin: ORIGIN, fetchImpl: sitemapThen(new Response("bad", { status: 422 })), now: NOW, log: { info: vi.fn(), warn } }),
    ).resolves.toEqual({ submitted: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("422"));
  });

  it("warns and resolves when IndexNow cannot be reached", async () => {
    const warn = vi.fn();
    await expect(
      submit({ origin: ORIGIN, fetchImpl: sitemapThen(new Error("ENOTFOUND")), now: NOW, log: { info: vi.fn(), warn } }),
    ).resolves.toEqual({ submitted: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ENOTFOUND"));
  });

  it("warns and resolves without an origin", async () => {
    const warn = vi.fn();
    await expect(submit({ origin: "", fetchImpl: vi.fn(), now: NOW, log: { info: vi.fn(), warn } })).resolves.toEqual({
      submitted: 0,
    });
    expect(warn).toHaveBeenCalled();
  });
});
```

`tests/contract/indexnow.contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs tooling.
import { INDEXNOW_KEY } from "../../scripts/indexnow.mjs";

const ROOT = join(__dirname, "../..");
const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const step = ci.slice(ci.indexOf("- name: Tell IndexNow about new and changed articles"));
const stepBlock = step.slice(0, step.indexOf("\n      - name:", 10) === -1 ? undefined : step.indexOf("\n      - name:", 10));

describe("IndexNow", () => {
  it("publishes the key file at the site root, holding the key", () => {
    expect(readFileSync(join(ROOT, "public", `${INDEXNOW_KEY}.txt`), "utf8").trim()).toBe(INDEXNOW_KEY);
  });

  it("is a step of the Vercel deploy job, for production only", () => {
    expect(step.length).toBeGreaterThan(0);
    expect(stepBlock).toContain("steps.target.outputs.env == 'production'");
    expect(stepBlock).toContain("node scripts/indexnow.mjs");
  });

  it("can never fail the deploy", () => {
    expect(stepBlock).toMatch(/continue-on-error:\s*true/);
    const source = readFileSync(join(ROOT, "scripts/indexnow.mjs"), "utf8");
    expect(source).not.toMatch(/process\.exit\(\s*[1-9]/);
    expect(source).not.toMatch(/process\.exitCode\s*=\s*[1-9]/);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/indexnow.test.ts tests/contract/indexnow.contract.test.ts`
Expected: FAIL. The module and the step don't exist yet.

- [ ] **Step 3: Implement**

`public/871ea90b6bf1cbdeeb392aa9705d1246.txt`:

```
871ea90b6bf1cbdeeb392aa9705d1246
```

`scripts/indexnow.mjs`:

```js
// Tell IndexNow (Bing, Yandex, Seznam, Naver…) which articles changed, right
// after a production deploy. Reads the live sitemap, so it submits exactly what
// is now served. Articles only: static routes are submitted once, by hand, from
// the launch checklist. Never fails the deploy — every problem is a ::warning::.
//
// The key is public by design: IndexNow proves ownership by fetching
// <origin>/<key>.txt, which is public/<key>.txt.

import { pathToFileURL } from 'node:url'

export const INDEXNOW_KEY = '871ea90b6bf1cbdeeb392aa9705d1246'
const ENDPOINT = 'https://api.indexnow.org/indexnow'

/** Article URLs (`/blog/<slug>`) whose lastmod falls within the last `hours`. */
export function recentUrls(sitemapXml, now = new Date(), hours = 48) {
  const since = now.getTime() - hours * 3600 * 1000
  const urls = []
  for (const [, block] of sitemapXml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(block)?.[1]
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(block)?.[1]
    if (!loc || !lastmod || !/\/blog\/[^/]+$/.test(loc)) continue
    const at = new Date(lastmod).getTime()
    if (!Number.isNaN(at) && at >= since) urls.push(loc)
  }
  return urls
}

export function indexNowBody(origin, urls) {
  return { host: new URL(origin).host, key: INDEXNOW_KEY, keyLocation: `${origin}/${INDEXNOW_KEY}.txt`, urlList: urls }
}

export async function submit({ origin, fetchImpl = fetch, now = new Date(), log = console }) {
  const site = String(origin ?? '').replace(/\/+$/, '')
  if (!site) {
    log.warn('::warning::IndexNow: PRODUCTION_URL is not set; nothing submitted.')
    return { submitted: 0 }
  }
  try {
    const sitemap = await fetchImpl(`${site}/sitemap.xml`)
    if (!sitemap.ok) {
      log.warn(`::warning::IndexNow: ${site}/sitemap.xml answered HTTP ${sitemap.status}; nothing submitted.`)
      return { submitted: 0 }
    }
    const urls = recentUrls(await sitemap.text(), now).filter((u) => u.startsWith(`${site}/`))
    if (urls.length === 0) {
      log.info('IndexNow: no article changed in the last 48 hours; nothing to submit.')
      return { submitted: 0 }
    }
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(indexNowBody(site, urls)),
    })
    if (res.status !== 200 && res.status !== 202) {
      log.warn(`::warning::IndexNow refused the submission: HTTP ${res.status} ${await res.text().catch(() => '')}`.trim())
      return { submitted: 0 }
    }
    log.info(`IndexNow: submitted ${urls.length} article URL(s).`)
    return { submitted: urls.length }
  } catch (err) {
    log.warn(`::warning::IndexNow could not be reached: ${err.message}`)
    return { submitted: 0 }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await submit({ origin: process.env.PRODUCTION_URL })
}
```

In `.github/workflows/ci.yml`, in the `deploy-vercel` job, directly after the "Verify the deployment serves the app" step, add:

```yaml
      # IndexNow: tell Bing and the other IndexNow engines which articles changed
      # in the last 48 hours, read from the sitemap now being served. Production
      # only, and it can never fail the deploy (scripts/indexnow.mjs warns instead).
      - name: Tell IndexNow about new and changed articles
        if: steps.creds.outputs.ready == 'true' && steps.target.outputs.env == 'production'
        continue-on-error: true
        env:
          PRODUCTION_URL: ${{ vars.PRODUCTION_URL }}
        run: node scripts/indexnow.mjs
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/indexnow.test.ts tests/contract/indexnow.contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite and commit**

Run: `npm run lint && npm run typecheck && npm run test:vitest`

```bash
git add public/871ea90b6bf1cbdeeb392aa9705d1246.txt scripts/indexnow.mjs tests/unit/indexnow.test.ts tests/contract/indexnow.contract.test.ts .github/workflows/ci.yml tests/test-plan/01-std-unit.md tests/test-plan/03-std-contract.md
git commit -m "seo: IndexNow key and a post-deploy submission of changed articles that cannot fail the deploy"
```

---

### Task 6: Documentation

**Files:**
- Modify: `README.md` (section "Search engines, and AI assistants", and "When an article's page is rebuilt")
- Modify: `public/llms.txt` only if the crawler note's sentence about the blog needs to point at the articles section. Keep every line the ai-surface contract checks.
- Modify: `tests/test-plan/11-std-seo.md` (a short paragraph pointing to the new unit, contract and api rows)

- [ ] **Step 1: README**

Add a subsection "### The sitemap, llms.txt and llms-full.txt" under "Search engines, and AI assistants". It should say:
- `npm run build:prerender` ends with `scripts/build-seo-files.mjs`, which rewrites `dist/sitemap.xml` and `dist/llms.txt` and writes `dist/llms-full.txt`;
- the templates are `public/sitemap.xml` and `public/llms.txt`;
- the article list is the prerender's (`loadPublishedArticles`): production fails without it, and a preview warns;
- the static routes carry no `lastmod`, `/blog` carries its newest article's, and each article its `updated_at`;
- the Base44 Builder's `npm run build` ships the templates unchanged.

Add "### IndexNow":
- what it is and which engines use it;
- the key file at `public/871ea90b6bf1cbdeeb392aa9705d1246.txt`;
- after each production deploy, CI submits the article URLs whose sitemap `lastmod` is within 48 h;
- it never fails the deploy;
- static routes are submitted by hand once.

Add "### Search Console and Bing verification":
- `VITE_GOOGLE_SITE_VERIFICATION` and `VITE_BING_SITE_VERIFICATION` on Vercel (Production; plain, not sensitive), set to only the `content` value;
- the Google domain property is already verified by the DNS TXT record, so the Google tag is optional;
- Bing can import the site from Search Console instead of using its tag;
- the sitemap to submit in both: `https://govari-fin.co.il/sitemap.xml`.

In "When an article's page is rebuilt", add one sentence: the same deploy refreshes the sitemap, `llms.txt` and `llms-full.txt`.

- [ ] **Step 2: Check and commit**

Run: `npm run lint && npm run test:vitest`

```bash
git add README.md tests/test-plan/11-std-seo.md public/llms.txt
git commit -m "docs: the generated SEO files, IndexNow, and the verification variables"
```

---

## After merge (for the user, not a task)

1. CI deploys production; the deploy's IndexNow step logs what it submitted.
2. `https://govari-fin.co.il/sitemap.xml` lists 30 URLs (8 static + 22 articles); `/llms-full.txt` answers 200.
3. Submit the sitemap in Google Search Console (domain property `govari-fin.co.il`) and in Bing Webmaster Tools (import from Search Console, or add the site and set `VITE_BING_SITE_VERIFICATION`).
