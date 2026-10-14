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

describe("contentAdmin — rows only Supabase has (written while VITE_CONTENT_WRITES=supabase)", () => {
  const uuid = "11111111-2222-4333-8444-555555555555";
  it.each([
    ["updateArticle", { op: "updateArticle", id: uuid, draft: { title: "x" } }],
    ["removeArticle", { op: "removeArticle", id: uuid }],
    ["removeTestimonial", { op: "removeTestimonial", id: uuid }],
  ])("%s on a Supabase uuid is refused with 409, touching neither store", async (_name, body) => {
    const r = await invokeFunction("contentAdmin", body, { env, headers, routes: asAdminWithBlog });
    expect(r.status).toBe(409);
    expect(r.callsTo("/rest/v1/blog_posts")).toHaveLength(0);
    expect(r.callsTo("/rest/v1/testimonials")).toHaveLength(0);
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

  it("never sends a null or empty slug to the mirror: no slug in the draft means no slug key", async () => {
    // A `slug: null` would make the fill trigger overwrite a real slug with
    // post-<id> on insert, and violate NOT NULL on a PATCH.
    const update = await invokeFunction(
      "contentAdmin",
      { op: "updateArticle", id: "post-1", draft: { title: "חדש" } },
      { env, headers, routes: asAdminWithBlog },
    );
    expect(update.status).toBe(200);
    const [patch] = update.callsTo("/rest/v1/blog_posts?base44_id=eq.post-1");
    expect(patch.body as object).not.toHaveProperty("slug");

    // A null or empty slug on update is refused, never passed through.
    for (const slug of [null, ""]) {
      const r = await invokeFunction(
        "contentAdmin",
        { op: "updateArticle", id: "post-1", draft: { title: "חדש", slug } },
        { env, headers, routes: asAdminWithBlog },
      );
      expect(r.status).toBe(400);
      expect(r.leadUpdates).toHaveLength(0);
      expect(r.callsTo("/rest/v1/blog_posts?base44_id=eq.")).toHaveLength(0);
    }

    // A create always carries the validated slug.
    const create = await invokeFunction("contentAdmin", ops[0][1], { env, headers, routes: asAdminWithBlog });
    const post = create.callsTo("/rest/v1/blog_posts").find((c) => c.method === "POST")!;
    expect((post.body as { slug: unknown }).slug).toBe("koteret");
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
