import { describe, expect, it, vi } from "vitest";
import { invokeEdge, SUPABASE_URL, type EdgeOptions } from "../helpers/edge-function";

/**
 * The nightly purge of claim documents past two months
 * (supabase/functions/claim-documents-purge): the cron secret, the batches,
 * and the deletion through the Storage API — never in SQL.
 */
const SECRET = "cron-secret-for-tests-0123456789";
const AUTH = { headers: { "x-site-cron": SECRET }, envPatch: { MASLEKA_CRON_SECRET: SECRET } };

/** Storage and the rpc, faked: `due` is what claim_documents_expired holds, oldest first. */
function storage(due: string[], opts: { failDelete?: number } = {}) {
  const left = [...due];
  const deleted: string[][] = [];
  const upstream: EdgeOptions["upstream"] = (call) => {
    if (call.url === `${SUPABASE_URL}/rest/v1/rpc/claim_documents_expired`) {
      const limit = (call.body as { p_limit: number }).p_limit;
      return Response.json(left.slice(0, limit));
    }
    if (call.url === `${SUPABASE_URL}/storage/v1/object/claim-documents` && call.method === "DELETE") {
      if (opts.failDelete) return new Response("no", { status: opts.failDelete });
      const names = (call.body as { prefixes: string[] }).prefixes;
      deleted.push(names);
      for (const n of names) left.splice(left.indexOf(n), 1);
      return Response.json(names.map((name) => ({ name })));
    }
    return undefined;
  };
  return { upstream, deleted, left };
}

const files = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-0000-0000-000000000001/claim-${i}.pdf`);

describe("claim-documents-purge — two months, then the files go", () => {
  it("refuses a call without the cron secret, and one when no secret is configured", async () => {
    const s = storage(files(3));
    const wrong = await invokeEdge("claim-documents-purge", {}, { ...AUTH, headers: { "x-site-cron": "nope" }, upstream: s.upstream });
    expect(wrong.status).toBe(401);
    const unset = await invokeEdge("claim-documents-purge", {}, { headers: AUTH.headers, envPatch: { MASLEKA_CRON_SECRET: null }, upstream: s.upstream });
    expect(unset.status).toBe(503);
    expect(s.deleted).toEqual([]);
  });

  it("deletes what is past retention through the Storage API, and says how many", async () => {
    const s = storage(files(3));
    const res = await invokeEdge("claim-documents-purge", {}, { ...AUTH, upstream: s.upstream });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, deleted: 3, batches: 1 });
    expect(s.deleted).toEqual([files(3)]);
    const del = res.fetches.find((f) => f.method === "DELETE")!;
    expect(del.url).toBe(`${SUPABASE_URL}/storage/v1/object/claim-documents`);
  });

  it("drains a backlog in batches of 500, and stops at ten a night", async () => {
    const s = storage(files(1200));
    const res = await invokeEdge("claim-documents-purge", {}, { ...AUTH, upstream: s.upstream });
    expect(res.json).toMatchObject({ deleted: 1200, batches: 3 });
    expect(s.deleted.map((b) => b.length)).toEqual([500, 500, 200]);

    const huge = storage(files(6000));
    const capped = await invokeEdge("claim-documents-purge", {}, { ...AUTH, upstream: huge.upstream });
    expect(capped.json).toMatchObject({ deleted: 5000, batches: 10 });
    expect(huge.left).toHaveLength(1000);
  });

  it("does nothing when nothing is due", async () => {
    const s = storage([]);
    const res = await invokeEdge("claim-documents-purge", {}, { ...AUTH, upstream: s.upstream });
    expect(res.json).toMatchObject({ ok: true, deleted: 0, batches: 0 });
    expect(res.fetches.some((f) => f.method === "DELETE")).toBe(false);
  });

  it("reports a refused delete as a failure, and never logs a file's name", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = storage(files(2), { failDelete: 403 });
    const res = await invokeEdge("claim-documents-purge", {}, { ...AUTH, upstream: s.upstream });
    expect(res.status).toBe(500);
    const written = [...logs.mock.calls, ...errors.mock.calls].flat().map(String).join("\n");
    expect(written).not.toContain("claim-0.pdf");
    logs.mockRestore();
    errors.mockRestore();
  });
});
