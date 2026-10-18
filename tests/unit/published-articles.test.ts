import { describe, expect, it, vi } from "vitest";
import { E2E_SUPABASE_PUBLISHABLE_KEY, E2E_SUPABASE_URL } from "../../e2e/build-env";
import { answerRestRead } from "../../e2e/fixtures/supabase-fake";
import {
  articleRoute,
  duplicateTitles,
  fetchPublishedArticles,
  isValidSlug,
  loadPublishedArticles,
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
/** The e2e build's Supabase: the fake host only the e2e fixture and the prerender answer. */
const E2E_ENV = { VITE_SUPABASE_URL: E2E_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: E2E_SUPABASE_PUBLISHABLE_KEY };
const FIXTURE = [
  {
    id: "e2e00000-0000-4000-8000-000000000001",
    base44_id: null,
    slug: "bdikat-maslul-e2e",
    title: "t",
    body: "b",
    published: true,
    created_at: "2026-10-01T09:00:00+00:00",
  },
];

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
      { ...E2E_ENV, PRERENDER_ARTICLES_FIXTURE: "e2e/fixtures/prerender-articles.json", PRERENDER_REQUIRED: "1" },
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
        planArticles({ ...E2E_ENV, PRERENDER_ARTICLES_FIXTURE: "f.json", ...vercel }, { readFileImpl: readFixture(FIXTURE) }),
      ).rejects.toThrow(/Vercel build/);
    },
  );

  it.each([
    ["a real project", URL_],
    ["the fake host with a trailing slash", `${E2E_SUPABASE_URL}/`],
    ["a look-alike host", "https://supabase.e2e.invalid.example.com"],
  ])("refuses the fixture in a bundle that reads %s", async (_what, url) => {
    const readFileImpl = readFixture(FIXTURE);
    await expect(
      planArticles(
        { PRERENDER_ARTICLES_FIXTURE: "f.json", VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: KEY },
        { readFileImpl },
      ),
    ).rejects.toThrow(/answers the e2e build's reads at https:\/\/supabase\.e2e\.invalid/);
    expect(readFileImpl).not.toHaveBeenCalled();
  });

  it("refuses the fixture in a bundle that reads no Supabase (the Base44 path)", async () => {
    await expect(
      planArticles({ PRERENDER_ARTICLES_FIXTURE: "f.json" }, { readFileImpl: readFixture(FIXTURE) }),
    ).rejects.toThrow(/this bundle reads no Supabase/);
  });

  it("reads the real table in a production build: a real project and no fixture", async () => {
    // The production build: no fixture, a real URL — the live list, by fetch.
    const fetchImpl = answer([{ slug: "live" }]);
    const plan = await planArticles({ ...SUPABASE_ENV, PRERENDER_REQUIRED: "1" }, { fetchImpl });
    expect(plan).toEqual({ routes: ["/blog/live"], fixtureRows: null, warning: null });
    expect(new URL(fetchImpl.mock.calls[0][0]).origin).toBe(URL_);
  });

  it("refuses the fake host without its fixture, rather than asking a host that never answers", async () => {
    const fetchImpl = answer([]);
    await expect(planArticles(E2E_ENV, { fetchImpl })).rejects.toThrow(/fake Supabase host/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a fixture article with an unusable slug", async () => {
    await expect(
      planArticles({ ...E2E_ENV, PRERENDER_ARTICLES_FIXTURE: "f.json" }, { readFileImpl: readFixture([{ slug: "Bad" }]) }),
    ).rejects.toThrow(/unusable slug/);
  });
});

/**
 * The PostgREST subset the e2e fake answers (e2e/fixtures/supabase-fake.ts) —
 * shared by the e2e fixture and the prerender, so it is pinned once here.
 */
describe("answerRestRead (the e2e Supabase fake)", () => {
  const rows = [
    { id: "1", slug: "a", base44_id: null, published: true, created_at: "2026-01-01" },
    { id: "2", slug: "b", base44_id: "68b0c0ffee0000000000bb02", published: false, created_at: "2026-03-01" },
    { id: "3", slug: "c", base44_id: null, published: true, created_at: "2026-02-01" },
  ];
  const tables = new Map([["blog_posts", rows]]);
  const read = (query: string) => answerRestRead(new URL(`${E2E_SUPABASE_URL}/rest/v1/blog_posts?${query}`), tables);
  const slugs = (query: string) => (read(query).body as Array<{ slug: string }>).map((r) => r.slug);

  it("filters with eq., orders and limits, as the blog list asks", () => {
    expect(slugs("select=id,slug&published=eq.true&order=created_at.desc&limit=50")).toEqual(["c", "a"]);
    expect(slugs("order=created_at.asc&limit=2")).toEqual(["a", "c"]);
  });

  it("answers an or=() over slug and base44_id, as one article's read asks", () => {
    expect(slugs("or=(slug.eq.b,base44_id.eq.b)&limit=3")).toEqual(["b"]);
    expect(slugs("or=(slug.eq.68b0c0ffee0000000000bb02,base44_id.eq.68b0c0ffee0000000000bb02)")).toEqual(["b"]);
    expect(slugs("or=(slug.eq.none,base44_id.eq.none)")).toEqual([]);
  });

  it("answers is.null and not.is.null", () => {
    expect(slugs("base44_id=is.null&order=slug.asc")).toEqual(["a", "c"]);
    expect(slugs("base44_id=not.is.null")).toEqual(["b"]);
  });

  it("refuses a table nobody seeded, and a filter outside the subset, loudly", () => {
    const missing = answerRestRead(new URL(`${E2E_SUPABASE_URL}/rest/v1/agencies?select=*`), tables);
    expect(missing.status).toBe(404);
    expect((missing.body as { code: string }).code).toBe("PGRST205");
    const unsupported = read("title=ilike.*x*");
    expect(unsupported.status).toBe(400);
    expect((unsupported.body as { code: string }).code).toBe("PGRST100");
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
      { ...E2E_ENV, PRERENDER_ARTICLES_FIXTURE: "f.json" },
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
