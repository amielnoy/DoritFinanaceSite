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
 */
const SUPABASE = "https://stub.supabase.co";
const env = { SUPABASE_URL: SUPABASE, SUPABASE_SERVICE_ROLE_KEY: "test-only-service-key" };
const headers = { "X-Supabase-Auth": "test-access-token" };
const asAdmin = [
  { match: "/auth/v1/user", status: 200, json: { id: "admin-1" } },
  { match: "/rest/v1/profiles", status: 200, json: [{ role: "admin" }] },
];
const mirrorDown = (table: string) => [...asAdmin, { match: `/rest/v1/${table}`, status: 500, text: "mirror down" }];
const draft = { title: "כותרת", body: "גוף", published: true };

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
    const r = await invokeFunction("contentAdmin", ops[0][1], { env, headers, routes: asAdmin });
    expect(r.status).toBe(200);
    const created = r.leads[0] as { id: string }; // the harness records every entity create here
    expect(r.json.id).toBe(created.id);
    const [mirror] = r.callsTo("/rest/v1/blog_posts");
    expect((mirror.body as { base44_id: string }).base44_id).toBe(created.id);
  });

  it.each(ops)("succeeds on %s when both stores take the write", async (_name, body) => {
    const r = await invokeFunction("contentAdmin", body, { env, headers, routes: asAdmin });
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
