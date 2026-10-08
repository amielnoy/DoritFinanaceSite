import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

let getImpl: (id: string) => Promise<unknown> = async () => {
  throw new Error("getImpl not configured for this test");
};

vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string) => {
    if (!url.endsWith("/app.html")) throw new Error(`unexpected fetch: ${url}`);
    return { ok: true, status: 200, text: async () => SHELL } as Response;
  })
);
vi.mock("@base44/sdk", () => ({
  createClient: vi.fn(() => ({
    entities: { BlogPost: { get: (id: string) => getImpl(id) } },
  })),
}));

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
  const mod = await import("../../api/og/blog/[id].ts");
  return mod.default;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.VITE_BASE44_APP_ID = "test-app";
  delete process.env.VITE_BASE44_APP_BASE_URL;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("api/og/blog/[id] handler", () => {
  it("renders the post's SEO into the shell on success", async () => {
    getImpl = async (id) => ({
      id,
      title: "איך לבחור קרן פנסיה",
      body: "פסקה על פנסיה.",
      tags: "פנסיה",
      image_url: "https://cdn.example/post-1.jpg",
      created_date: "2026-01-01T00:00:00Z",
    });
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: { id: "post-1" }, headers: { host: "example.test" } }, res);

    expect(state.status).toBe(200);
    expect(state.headers["Content-Type"]).toContain("text/html");
    expect(state.headers["Cache-Control"]).toContain("s-maxage=600");
    expect(state.body).toContain("איך לבחור קרן פנסיה");
    expect(state.body).toContain("https://cdn.example/post-1.jpg");
  });

  it("returns 404 and noindex when Base44 has no such post", async () => {
    getImpl = async () => {
      throw Object.assign(new Error("Entity not found"), { status: 404 });
    };
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: { id: "missing" }, headers: { host: "example.test" } }, res);

    expect(state.status).toBe(404);
    expect(state.headers["X-Robots-Tag"]).toBe("noindex");
    expect(state.body).toContain("המאמר לא נמצא");
  });

  it("returns 502 and noindex when the backend call fails for another reason", async () => {
    getImpl = async () => {
      throw new Error("simulated network failure");
    };
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: { id: "post-1" }, headers: { host: "example.test" } }, res);

    expect(state.status).toBe(502);
    expect(state.headers["X-Robots-Tag"]).toBe("noindex");
  });

  it("answers 500 without calling Base44 when the app id is not configured", async () => {
    delete process.env.VITE_BASE44_APP_ID;
    getImpl = async () => {
      throw new Error("should not be called");
    };
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: { id: "post-1" }, headers: { host: "example.test" } }, res);

    expect(state.status).toBe(500);
    expect(state.headers["Cache-Control"]).toBe("no-store");
  });

  it("answers 500 when the route is hit without an id", async () => {
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "GET", query: {}, headers: { host: "example.test" } }, res);

    expect(state.status).toBe(500);
  });

  it("rejects non-GET methods", async () => {
    const handler = await loadHandler();
    const { res, state } = makeRes();

    await handler({ method: "POST", query: { id: "post-1" }, headers: { host: "example.test" } }, res);

    expect(state.status).toBe(405);
  });
});
