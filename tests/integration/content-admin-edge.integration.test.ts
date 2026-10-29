import { describe, expect, it } from "vitest";
import { invokeEdge, SUPABASE_URL, type FetchCall } from "../helpers/edge-function";

/** The harness's default env carries this legacy service key (tests/helpers/edge-function.ts). */
const serviceKeyOf = (f: FetchCall) => String(f.headers.apikey ?? "");

/**
 * content-admin: the admin's article and testimonial writes, on Supabase. The
 * gate is a Supabase session whose profile is `admin`.
 *
 * Supabase is faked here as a tiny in-memory store: auth answers by token,
 * PostgREST by table and filter. Ids are either a Supabase uuid (rows written
 * since this function) or a Base44 id (rows from before the move), and
 * both must find their row.
 */
// Session tokens as long as real ones: _shared/staff.ts's bearer() wants 20+ characters.
// ADMIN is the platform operator; USER and AGENCY_ADMIN hold those roles in agency 1;
// MEMBER is signed in with no role.
const ADMIN = "admin-session-token-0123456789";
const MEMBER = "member-session-token-0123456789";
const USER = "user-session-token-0123456789";
const AGENCY_ADMIN = "agency-admin-session-token-0123456789";
const AGENCY_1 = "00000000-0000-0000-0000-000000000001";
const B44_ID = "0123456789abcdef01234567";
const UUID = "11111111-2222-4333-8444-555555555555";

type Row = Record<string, unknown>;

function fakeSupabase(
  seed: {
    posts?: Row[];
    testimonials?: Row[];
    profileStatus?: number;
    /** Auth answers this instead of looking at the token: a status and body. */
    auth?: { status: number; body: unknown };
    /** The slug lookup sees none of the rows — a second save racing the first. */
    staleSlugLookup?: boolean;
  } = {},
) {
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
      if (seed.auth) return json(seed.auth.body, seed.auth.status);
      const token = String(call.headers.Authorization ?? "").replace(/^Bearer /, "");
      if (token === ADMIN) return json({ id: "user-admin" });
      if (token === MEMBER) return json({ id: "user-member" });
      if (token === USER) return json({ id: "user-user" });
      if (token === AGENCY_ADMIN) return json({ id: "user-agency-admin" });
      // Auth's own refusal carries an error_code; the gateway's "Invalid API key" does not.
      return json({ code: 403, error_code: "bad_jwt", msg: "invalid JWT" }, 403);
    }
    if (url.pathname === "/rest/v1/profiles") {
      if (seed.profileStatus) return json({}, seed.profileStatus);
      const id = url.searchParams.get("id")?.slice(3);
      return json([{ role: id === "user-admin" ? "admin" : "user" }]);
    }
    if (url.pathname === "/rest/v1/rpc/staff_role") {
      const { p_user_id, p_agency_id } = call.body as { p_user_id: string; p_agency_id: string };
      const roles: Record<string, string> = { "user-user": "user", "user-agency-admin": "admin" };
      return json(p_agency_id === AGENCY_1 ? (roles[p_user_id] ?? null) : null);
    }

    const table = url.pathname.replace("/rest/v1/", "");
    const rows = tables[table];
    if (!rows) return undefined;
    const query = url.search.slice(1);
    if (call.method === "GET") return json(seed.staleSlugLookup ? [] : rows.filter((r) => matches(r, query)));
    if (call.method === "POST") {
      const slug = (call.body as Row).slug;
      if (slug !== undefined && rows.some((r) => r.slug === slug)) {
        return json({ code: "23505", message: `duplicate key value violates unique constraint "blog_posts_slug_key"` }, 409);
      }
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

  const OPS: Record<string, unknown>[] = [
    { op: "createArticle", draft },
    { op: "updateArticle", id: UUID, draft: { title: "x" } },
    { op: "removeArticle", id: UUID },
    { op: "createTestimonial", draft: { name: "n", quote: "q" } },
    { op: "removeTestimonial", id: UUID },
  ];
  const CALLERS: [string, string | null, number][] = [
    ["no session", null, 401],
    ["a forged token", "forged", 401],
    ["a signed-in non-admin", MEMBER, 403],
  ];

  it.each(OPS.flatMap((body) => CALLERS.map(([who, token, status]) => [body.op, who, token, status, body] as const)))(
    "%s from %s is refused with %s, and nothing is written",
    async (_op, _who, token, status, body) => {
      const db = fakeSupabase({ posts: [{ id: UUID, base44_id: null, slug: "s", agency_id: AGENCY_1 }], testimonials: [{ id: UUID, agency_id: AGENCY_1 }] });
      const r = await call(body as Record<string, unknown>, token as string | null, db);
      expect(r.status).toBe(status);
      // An edit or delete reads its row's agency to know whose Admin may act;
      // nothing past that read.
      const writes = r.fetches.filter((f) => /\/rest\/v1\/(blog_posts|testimonials)/.test(f.url) && f.method !== "GET");
      expect(writes).toEqual([]);
      if (token === null || status === 401) expect(r.callsTo("/rest/v1/")).toEqual([]);
      expect(db.tables.blog_posts).toHaveLength(1);
      expect(db.tables.testimonials).toHaveLength(1);
    },
  );

  it("asks Auth with the service key on apikey and the caller's token on Authorization", async () => {
    const r = await call({ op: "createArticle", draft }, ADMIN);
    const [auth] = r.callsTo("/auth/v1/user");
    expect(auth.headers.Authorization).toBe(`Bearer ${ADMIN}`);
    expect(serviceKeyOf(auth)).not.toBe("");
    expect(serviceKeyOf(auth)).not.toBe(ADMIN);
  });

  it.each([
    ["a revoked or wrong-project service key (the gateway's 401, no error_code)", { status: 401, body: { message: "Invalid API key" } }],
    ["an Auth outage", { status: 503, body: { message: "upstream" } }],
    ["a 200 that names no user", { status: 200, body: {} }],
  ])("answers 500, not 'session expired', for %s", async (_name, auth) => {
    const r = await call({ op: "createArticle", draft }, ADMIN, fakeSupabase({ auth }));
    expect(r.status).toBe(500);
    expect(r.callsTo("/rest/v1/blog_posts")).toEqual([]);
  });

  it("answers 401 for Auth's own refusal, on 401 as on 403", async () => {
    const r = await call({ op: "createArticle", draft }, ADMIN, fakeSupabase({ auth: { status: 401, body: { error_code: "session_not_found" } } }));
    expect(r.status).toBe(401);
  });

  it("refuses an unknown op with 400", async () => {
    const r = await call({ op: "dropTable" }, ADMIN);
    expect(r.status).toBe(400);
  });
});

describe("content-admin — per action, by agency role", () => {
  const post = (over: Row = {}) => ({ id: UUID, base44_id: null, slug: "s", agency_id: AGENCY_1, published: false, ...over });
  const writes = (r: Awaited<ReturnType<typeof call>>) =>
    r.fetches.filter((f) => /\/rest\/v1\/(blog_posts|testimonials)/.test(f.url) && f.method !== "GET");

  it("lets a User write a draft and edit it, asking the role in agency 1", async () => {
    const db = fakeSupabase({ posts: [post()] });
    expect((await call({ op: "createArticle", draft }, USER, db)).status).toBe(200);
    const r = await call({ op: "updateArticle", id: UUID, draft: { title: "חדש" } }, USER, db);
    expect(r.status).toBe(200);
    expect(r.callsTo("/rpc/staff_role")[0].body).toEqual({ p_user_id: "user-user", p_agency_id: AGENCY_1 });
  });

  it.each([
    ["publish a new article", { op: "createArticle", draft: { ...draft, published: true } }, [post()]],
    ["publish a draft", { op: "updateArticle", id: UUID, draft: { published: true } }, [post()]],
    ["edit a live article", { op: "updateArticle", id: UUID, draft: { title: "x" } }, [post({ published: true })]],
    ["unpublish one", { op: "updateArticle", id: UUID, draft: { published: false } }, [post({ published: true })]],
    ["delete an article", { op: "removeArticle", id: UUID }, [post()]],
    ["add a testimonial", { op: "createTestimonial", draft: { name: "n", quote: "q" } }, []],
    ["delete a testimonial", { op: "removeTestimonial", id: UUID }, []],
  ])("refuses a User who would %s, writing nothing", async (_what, body, posts) => {
    const db = fakeSupabase({ posts: posts as Row[], testimonials: [{ id: UUID, agency_id: AGENCY_1 }] });
    const r = await call(body as Record<string, unknown>, USER, db);
    expect(r.status).toBe(403);
    expect(writes(r)).toEqual([]);
  });

  it("refuses a publish value that is not a boolean, before the gate could misread it as a draft edit", async () => {
    for (const published of ["true", 1, "yes", null]) {
      const db = fakeSupabase({ posts: [post()] });
      const r = await call({ op: "updateArticle", id: UUID, draft: { published } }, USER, db);
      expect(r.status).toBe(400);
      expect(writes(r)).toEqual([]);
      expect(db.tables.blog_posts[0].published).toBe(false);
    }
  });

  it("lets an agency Admin publish, unpublish, delete and manage testimonials", async () => {
    const db = fakeSupabase({ posts: [post()], testimonials: [{ id: UUID, agency_id: AGENCY_1 }] });
    expect((await call({ op: "updateArticle", id: UUID, draft: { published: true } }, AGENCY_ADMIN, db)).status).toBe(200);
    expect((await call({ op: "updateArticle", id: UUID, draft: { published: false } }, AGENCY_ADMIN, db)).status).toBe(200);
    expect((await call({ op: "createTestimonial", draft: { name: "n", quote: "q" } }, AGENCY_ADMIN, db)).status).toBe(200);
    expect((await call({ op: "removeTestimonial", id: UUID }, AGENCY_ADMIN, db)).status).toBe(200);
    expect((await call({ op: "removeArticle", id: UUID }, AGENCY_ADMIN, db)).status).toBe(200);
  });

  it("keeps a shared-library article (no agency) the platform operator's alone", async () => {
    const shared = () => fakeSupabase({ posts: [post({ agency_id: null })] });
    expect((await call({ op: "updateArticle", id: UUID, draft: { title: "x" } }, AGENCY_ADMIN, shared())).status).toBe(403);
    expect((await call({ op: "updateArticle", id: UUID, draft: { title: "x" } }, ADMIN, shared())).status).toBe(200);
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
    // Nothing went anywhere but Supabase.
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

  it("answers 409, not 500, when a racing save took the slug between the check and the insert", async () => {
    const db = fakeSupabase({ posts: [{ id: UUID, base44_id: null, slug: "my-post" }], staleSlugLookup: true });
    const r = await call({ op: "createArticle", draft }, ADMIN, db);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("הכתובת כבר בשימוש במאמר אחר.");
  });

  it("updates only the allowed fields: ids, agency and unknown keys fall away", async () => {
    const db = fakeSupabase({ posts: [{ id: UUID, base44_id: null, slug: "s", title: "old" }] });
    const r = await call(
      { op: "updateArticle", id: UUID, draft: { title: "new", agency_id: null, id: "x", base44_id: "y", created_at: "z", role: "admin" } },
      ADMIN,
      db,
    );
    expect(r.status).toBe(200);
    expect(r.callsTo("/rest/v1/blog_posts").find((f) => f.method === "PATCH")!.body).toEqual({ title: "new" });
  });

  it("refuses a null or empty slug on update with 400, rather than nulling the column", async () => {
    for (const slug of [null, ""]) {
      const r = await call({ op: "updateArticle", id: UUID, draft: { slug } }, ADMIN, fakeSupabase({ posts: [{ id: UUID, slug: "s" }] }));
      expect(r.status, String(slug)).toBe(400);
    }
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
