import { describe, expect, it } from "vitest";
import type { FetchCall } from "../helpers/base44-function";
import { invokeEdge, SUPABASE_URL } from "../helpers/edge-function";

/**
 * content-admin: the Edge twin of base44/functions/contentAdmin, writing
 * Supabase only. Same gate (a Supabase session whose profile is `admin`), same
 * slug rules, same allowed fields — and no Base44 write at all.
 *
 * Supabase is faked here as a tiny in-memory store: auth answers by token,
 * PostgREST by table and filter. Ids are either a Supabase uuid (rows written
 * since this function) or a Base44 id (rows the dual-write era created), and
 * both must find their row.
 */
const ADMIN = "admin-token";
const MEMBER = "member-token";
const B44_ID = "0123456789abcdef01234567";
const UUID = "11111111-2222-4333-8444-555555555555";

type Row = Record<string, unknown>;

function fakeSupabase(seed: { posts?: Row[]; testimonials?: Row[]; profileStatus?: number } = {}) {
  const tables: Record<string, Row[]> = {
    blog_posts: (seed.posts ?? []).map((r) => ({ ...r })),
    testimonials: (seed.testimonials ?? []).map((r) => ({ ...r })),
  };
  let next = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  const matches = (row: Row, query: string) =>
    [...new URLSearchParams(query)].every(([col, cond]) => {
      if (col === "select" || col === "on_conflict") return true;
      return cond.startsWith("eq.") ? String(row[col]) === cond.slice(3) : true;
    });

  const upstream = (call: FetchCall): Response | undefined => {
    const url = new URL(call.url);
    if (!call.url.startsWith(SUPABASE_URL)) return undefined;

    if (url.pathname === "/auth/v1/user") {
      const token = String(call.headers.Authorization ?? "").replace(/^Bearer /, "");
      if (token === ADMIN) return json({ id: "user-admin" });
      if (token === MEMBER) return json({ id: "user-member" });
      return json({ msg: "invalid JWT" }, 401);
    }
    if (url.pathname === "/rest/v1/profiles") {
      if (seed.profileStatus) return json({}, seed.profileStatus);
      const id = url.searchParams.get("id")?.slice(3);
      return json([{ role: id === "user-admin" ? "admin" : "user" }]);
    }

    const table = url.pathname.replace("/rest/v1/", "");
    const rows = tables[table];
    if (!rows) return undefined;
    const query = url.search.slice(1);
    if (call.method === "GET") return json(rows.filter((r) => matches(r, query)));
    if (call.method === "POST") {
      const row = { id: `00000000-0000-4000-8000-00000000000${next++}`, ...(call.body as Row) };
      rows.push(row);
      return json([row], 201);
    }
    if (call.method === "PATCH") {
      const hit = rows.filter((r) => matches(r, query));
      for (const r of hit) Object.assign(r, call.body as Row);
      return json(hit);
    }
    if (call.method === "DELETE") {
      tables[table] = rows.filter((r) => !matches(r, query));
      return new Response(null, { status: 204 });
    }
    return undefined;
  };
  return { upstream, tables };
}

const call = (body: Record<string, unknown>, token: string | null, db = fakeSupabase()) =>
  invokeEdge("content-admin", body, {
    upstream: db.upstream,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

const draft = { title: "כותרת", excerpt: "תקציר", body: "גוף", image_url: "", tags: "פנסיה", published: false, slug: "my-post" };

describe("content-admin — the gate", () => {
  it("refuses a caller with no session with 401, before touching any table", async () => {
    const r = await call({ op: "createArticle", draft }, null);
    expect(r.status).toBe(401);
    expect(r.callsTo("/rest/v1/")).toEqual([]);
  });

  it("refuses a forged or expired token with 401", async () => {
    const r = await call({ op: "createArticle", draft }, "forged");
    expect(r.status).toBe(401);
    expect(r.callsTo("/rest/v1/blog_posts")).toEqual([]);
  });

  it("refuses a signed-in user who is not an admin with 403", async () => {
    const db = fakeSupabase();
    const r = await call({ op: "createArticle", draft }, MEMBER, db);
    expect(r.status).toBe(403);
    expect(db.tables.blog_posts).toEqual([]);
  });

  it("answers 500, not 403, when the role cannot be read", async () => {
    const r = await call({ op: "createArticle", draft }, ADMIN, fakeSupabase({ profileStatus: 503 }));
    expect(r.status).toBe(500);
  });

  it("answers the browser's preflight, and puts CORS on refusals too", async () => {
    const pre = await invokeEdge("content-admin", null, { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://govari-fin.co.il");
    const r = await call({ op: "createArticle", draft }, null);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://govari-fin.co.il");
    expect(r.json.rid).toEqual(expect.any(String));
  });

  it("refuses an unknown op with 400", async () => {
    const r = await call({ op: "dropTable" }, ADMIN);
    expect(r.status).toBe(400);
  });
});

describe("content-admin — articles, on Supabase only", () => {
  it("creates an article with its slug and only the allowed fields, and answers its id", async () => {
    const db = fakeSupabase();
    const r = await call({ op: "createArticle", draft: { ...draft, agency_id: null, base44_id: "x", id: "y" } }, ADMIN, db);
    expect(r.status).toBe(200);
    const [row] = db.tables.blog_posts;
    expect(r.json.id).toBe(row.id);
    const { id: _id, ...written } = row;
    expect(written).toEqual({ ...draft, published: false });
    // Nothing went to Base44: this function holds no Base44 credential at all.
    expect(r.fetches.every((f) => f.url.startsWith(SUPABASE_URL))).toBe(true);
  });

  it("refuses a missing, malformed or Base44-shaped slug with 400", async () => {
    for (const slug of [undefined, "", "Has Spaces", "a--b", B44_ID]) {
      const r = await call({ op: "createArticle", draft: { ...draft, slug } }, ADMIN);
      expect(r.status, String(slug)).toBe(400);
    }
  });

  it("refuses a slug another article has with 409, and writes nothing", async () => {
    const db = fakeSupabase({ posts: [{ id: UUID, base44_id: null, slug: "my-post" }] });
    const r = await call({ op: "createArticle", draft }, ADMIN, db);
    expect(r.status).toBe(409);
    expect(db.tables.blog_posts).toHaveLength(1);
  });

  it("updates a Base44-era article found by its Base44 id, with only what changed", async () => {
    const db = fakeSupabase({ posts: [{ id: UUID, base44_id: B44_ID, slug: "old", published: false }] });
    const r = await call({ op: "updateArticle", id: B44_ID, draft: { published: true } }, ADMIN, db);
    expect(r.status).toBe(200);
    const patch = r.callsTo("/rest/v1/blog_posts").find((f) => f.method === "PATCH")!;
    expect(patch.url).toContain(`base44_id=eq.${B44_ID}`);
    expect(patch.body).toEqual({ published: true });
    expect(db.tables.blog_posts[0]).toMatchObject({ published: true, slug: "old" });
  });

  it("updates an article written since, found by its Supabase id", async () => {
    const db = fakeSupabase({ posts: [{ id: UUID, base44_id: null, slug: "new" }] });
    const r = await call({ op: "updateArticle", id: UUID, draft: { title: "חדש" } }, ADMIN, db);
    expect(r.status).toBe(200);
    expect(r.callsTo("/rest/v1/blog_posts").find((f) => f.method === "PATCH")!.url).toContain(`id=eq.${UUID}`);
  });

  it("lets an article keep its own slug, and refuses one another article has", async () => {
    const db = fakeSupabase({
      posts: [
        { id: UUID, base44_id: null, slug: "mine" },
        { id: "99999999-2222-4333-8444-555555555555", base44_id: null, slug: "theirs" },
      ],
    });
    expect((await call({ op: "updateArticle", id: UUID, draft: { slug: "mine" } }, ADMIN, db)).status).toBe(200);
    expect((await call({ op: "updateArticle", id: UUID, draft: { slug: "theirs" } }, ADMIN, db)).status).toBe(409);
  });

  it("answers 404 when no article has that id, rather than reporting success", async () => {
    const r = await call({ op: "updateArticle", id: UUID, draft: { title: "x" } }, ADMIN);
    expect(r.status).toBe(404);
  });

  it("refuses an id that is neither a uuid nor a Base44 id with 400, before any write", async () => {
    for (const id of [undefined, "", "1 or 1=1", "abc&slug=eq.x"]) {
      const r = await call({ op: "removeArticle", id }, ADMIN);
      expect(r.status, String(id)).toBe(400);
      expect(r.callsTo("/rest/v1/blog_posts")).toEqual([]);
    }
  });

  it("removes an article, and a repeated remove still answers 200", async () => {
    const db = fakeSupabase({ posts: [{ id: UUID, base44_id: B44_ID, slug: "x" }] });
    expect((await call({ op: "removeArticle", id: B44_ID }, ADMIN, db)).status).toBe(200);
    expect(db.tables.blog_posts).toEqual([]);
    expect((await call({ op: "removeArticle", id: B44_ID }, ADMIN, db)).status).toBe(200);
  });
});

describe("content-admin — testimonials", () => {
  it("creates one with the allowed fields and the old defaults, and answers its id", async () => {
    const db = fakeSupabase();
    const r = await call(
      { op: "createTestimonial", draft: { name: "רות", role: "", quote: "מצוין", image_url: "", rating: "", source: "", agency_id: null } },
      ADMIN,
      db,
    );
    expect(r.status).toBe(200);
    const [row] = db.tables.testimonials;
    expect(r.json.id).toBe(row.id);
    const { id: _id, ...written } = row;
    expect(written).toEqual({ name: "רות", role: "", quote: "מצוין", image_url: "", rating: 5, source: "google" });
  });

  it("removes one by either id", async () => {
    const db = fakeSupabase({ testimonials: [{ id: UUID, base44_id: B44_ID }] });
    expect((await call({ op: "removeTestimonial", id: UUID }, ADMIN, db)).status).toBe(200);
    expect(db.tables.testimonials).toEqual([]);
  });
});
