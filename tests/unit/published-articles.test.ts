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
