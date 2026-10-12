import { describe, expect, it, vi } from "vitest";
import { RestTableClient } from "@/services/supabase/RestTableClient";

/**
 * The plain-fetch PostgREST client behind the home page's public reads.
 *
 * It replaces supabase-js on the anonymous path, so what matters is that it
 * asks exactly what the SDK asked — same URL, same role — and that a failure
 * still reaches `fetchRows` as `{ error }`, never as an empty list.
 */

const URL_ = "https://project-ref.supabase.co";
const KEY = "sb_publishable_test";

function client(response: Response | Error) {
  const fetchImpl = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { rest: new RestTableClient(URL_, KEY, fetchImpl as unknown as typeof fetch), fetchImpl };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("RestTableClient — the request", () => {
  it("builds select, eq, order and limit into PostgREST's query string, in call order", async () => {
    const { rest, fetchImpl } = client(ok([]));
    await rest
      .from("blog_posts")
      .select("base44_id,title,created_at")
      .eq("published", true)
      .order("created_at", { ascending: false })
      .limit(12);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe(`${URL_}/rest/v1/blog_posts`);
    expect([...url.searchParams.entries()]).toEqual([
      ["select", "base44_id,title,created_at"],
      ["published", "eq.true"],
      ["order", "created_at.desc"],
      ["limit", "12"],
    ]);
  });

  it("orders ascending when asked", async () => {
    const { rest, fetchImpl } = client(ok([]));
    await rest.from("testimonials").select("*").order("created_at", { ascending: true });
    expect(new URL(String(fetchImpl.mock.calls[0][0])).searchParams.get("order")).toBe("created_at.asc");
  });

  it("encodes a filter value that has characters of its own", async () => {
    const { rest, fetchImpl } = client(ok([]));
    await rest.from("blog_posts").select("*").eq("base44_id", "a b&c=d");
    const raw = String(fetchImpl.mock.calls[0][0]);
    expect(raw).not.toContain("a b&c=d");
    expect(new URL(raw).searchParams.get("base44_id")).toBe("eq.a b&c=d");
  });

  it("does not double the slash when the project URL ends with one", async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    await new RestTableClient(`${URL_}/`, KEY, fetchImpl as unknown as typeof fetch).from("testimonials").select("*");
    expect(String(fetchImpl.mock.calls[0][0])).toMatch(/^https:\/\/project-ref\.supabase\.co\/rest\/v1\/testimonials\?/);
  });

  it("sends the publishable key as apikey and as the bearer — the anonymous role, as supabase-js does", async () => {
    const { rest, fetchImpl } = client(ok([]));
    await rest.from("testimonials").select("*");
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.method ?? "GET").toBe("GET");
    expect(init.headers).toMatchObject({ apikey: KEY, Authorization: `Bearer ${KEY}` });
  });

  it("is immutable: a branch of a query does not change the query it came from", async () => {
    const { rest, fetchImpl } = client(ok([]));
    const base = rest.from("blog_posts").select("*");
    await base.limit(1);
    await base;
    expect(new URL(String(fetchImpl.mock.calls[1][0])).searchParams.has("limit")).toBe(false);
  });
});

describe("RestTableClient — the answer", () => {
  it("returns the rows", async () => {
    const { rest } = client(ok([{ id: 1 }, { id: 2 }]));
    await expect(rest.from("testimonials").select("*")).resolves.toEqual({ data: [{ id: 1 }, { id: 2 }], error: null });
  });

  it("maps a PostgREST refusal to its message and code", async () => {
    const { rest } = client(
      new Response(JSON.stringify({ code: "42501", message: "permission denied for table leads" }), { status: 401 }),
    );
    await expect(rest.from("leads").select("*")).resolves.toEqual({
      data: null,
      error: { message: "permission denied for table leads", code: "42501" },
    });
  });

  it("names the HTTP status when the error body is not JSON", async () => {
    const { rest } = client(new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(rest.from("testimonials").select("*")).resolves.toEqual({
      data: null,
      error: { message: "HTTP 502", code: undefined },
    });
  });

  it("turns a network failure into an error rather than a rejection", async () => {
    const { rest } = client(new TypeError("Failed to fetch"));
    await expect(rest.from("testimonials").select("*")).resolves.toEqual({
      data: null,
      error: { message: "Failed to fetch" },
    });
  });

  it("reports a 200 that is not a list as an error, not as no rows", async () => {
    // "No articles" looks like content; an answer it could not read must not.
    const { rest } = client(ok({ unexpected: true }));
    const result = await rest.from("testimonials").select("*");
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/unexpected/i);
  });
});

describe("RestTableClient — the same request supabase-js makes", () => {
  it("asks for the same URL with the same anonymous credentials", async () => {
    // Recorded rather than remembered: if a supabase-js upgrade changes how a
    // query is encoded or authorised, this fails instead of the home page.
    const { createClient } = await import("@supabase/supabase-js");
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const record = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((v, k) => (headers[k] = v));
      seen.push({ url: String(input), headers });
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const sdk = createClient(URL_, KEY, {
      global: { fetch: record },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    await sdk.from("testimonials").select("id,name").eq("published", true).order("created_at", { ascending: false }).limit(5);
    await new RestTableClient(URL_, KEY, record)
      .from("testimonials")
      .select("id,name")
      .eq("published", true)
      .order("created_at", { ascending: false })
      .limit(5);

    const [fromSdk, fromRest] = seen;
    expect(fromRest.url).toBe(fromSdk.url);
    expect(fromRest.headers.apikey).toBe(fromSdk.headers.apikey);
    expect(fromRest.headers.authorization).toBe(fromSdk.headers.authorization);
    // The SDK also names the schema; `public` is PostgREST's default, so leaving it out reads the same rows.
    expect(fromSdk.headers["accept-profile"] ?? "public").toBe("public");
  });
});
