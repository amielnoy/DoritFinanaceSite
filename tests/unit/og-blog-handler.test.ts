import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SITE_URL } from "@/lib/seo";

// The shell is read from disk (bundled with the function), so the reader is
// what the tests control — never a network call.
const shellFile = vi.hoisted(() => ({ html: null as string | null }));
const readFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:fs/promises", () => ({ readFile: readFileMock }));

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
  readFileMock.mockReset();
  shellFile.html = SHELL;
  readFileMock.mockImplementation(async () => {
    if (shellFile.html === null) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return shellFile.html;
  });
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

  it("reads the shell once from the bundled dist/app.html and reuses it — never over HTTP", async () => {
    rows = [article()];
    const handler = await loadHandler();

    await handler({ method: "GET", query: { id: SLUG } }, makeRes().res);
    await handler({ method: "GET", query: { id: SLUG }, headers: { host: "attacker.example" } } as never, makeRes().res);

    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(String(readFileMock.mock.calls[0][0])).toMatch(/dist[\\/]app\.html$/);
    expect(fetchMock().mock.calls.every(([u]) => String(u).startsWith(SUPABASE))).toBe(true);
  });

  it("answers 502 + noindex, not a crash, when the shell file is missing", async () => {
    rows = [article()];
    shellFile.html = null;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: { id: SLUG } }, res);

    expect(state.status).toBe(502);
    expect(state.headers["X-Robots-Tag"]).toBe("noindex");
    expect(state.body).toContain("noindex");
    spy.mockRestore();
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

  it("still answers 404 + noindex when the shell file is missing, and logs the read once", async () => {
    shellFile.html = null;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = await loadHandler();
    for (let i = 0; i < 2; i++) {
      const { res, state } = makeRes();
      await handler({ method: "GET", query: { id: "missing" } }, res);
      expect(state.status).toBe(404);
      expect(state.headers["X-Robots-Tag"]).toBe("noindex");
      expect(state.body).toContain("noindex");
    }
    expect(spy.mock.calls.filter(([m]) => String(m).includes("cannot read the app shell"))).toHaveLength(1);
    spy.mockRestore();
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
    expect(state.headers["X-Robots-Tag"]).toBe("noindex");
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
