import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * Publishing a snapshot to the client (phase 4), read as source. The
 * behaviour is proved by supabase/tests/clearinghouse_publish_check.sql
 * against a local Supabase; this fails in CI the moment the client's view
 * grows a field, or a grant opens.
 */
const DIR = join(REPO_ROOT, "supabase/migrations");
const FILE = "20261024000000_clearinghouse_publish.sql";
const code = readFileSync(join(DIR, FILE), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

const fn = (name: string) => {
  const start = code.indexOf(`create function public.${name}(`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  return code.slice(start, code.indexOf("$$;", start));
};

describe("the clearinghouse publish migration", () => {
  it("sorts after every migration already applied", () => {
    const all = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(all.at(-1)).toBe(FILE);
  });

  it("shows the client exactly four fields, and each recommendation exactly six", () => {
    const body = fn("snapshot_for");
    const top = [...body.matchAll(/^\s*'(\w+)', (?:s|coalesce)/gm)].map((m) => m[1]);
    expect(top.sort()).toEqual(["data", "items", "published_at", "taken_at"]);
    const item = body.slice(body.indexOf("jsonb_build_object(\n                      'id'"));
    const itemKeys = [...item.matchAll(/'(\w+)', i\.\w+/g)].map((m) => m[1]);
    expect(itemKeys.sort()).toEqual(["body", "client_note", "client_status", "id", "priority", "title"]);
    // Never who published it, the address, or Dorit's seen-marks.
    for (const hidden of ["client_email", "published_by", "staff_seen_at", "client_updated_at"]) {
      expect(body).not.toMatch(new RegExp(`'${hidden}'`));
    }
  });

  it("answers only for the signed-in user's verified address, and only published snapshots", () => {
    expect(fn("my_snapshot")).toMatch(/public\.snapshot_for\(public\.my_email\(\)\)/);
    expect(fn("snapshot_for")).toMatch(/s\.published_at is not null/);
    const respond = fn("respond_to_recommendation");
    expect(respond).toMatch(/v_email text := public\.my_email\(\)/);
    expect(respond).toMatch(/s\.client_email = v_email/);
    expect(respond).toMatch(/s\.published_at is not null/);
  });

  it("lets only the service role call snapshot_for, and nobody anonymous call anything", () => {
    expect(code).toMatch(/grant execute on function public\.snapshot_for\(text\)\s+to service_role;/);
    for (const grant of code.match(/grant [^;]+;/gi) ?? []) expect(grant, grant).not.toMatch(/\banon\b/);
    expect(code).not.toMatch(/grant execute on function public\.snapshot_for\(text\)\s+to authenticated/);
  });

  it("lets staff publish only their own agency's snapshots, and never write the items directly", () => {
    for (const name of ["clearinghouse_publish", "clearinghouse_unpublish", "clearinghouse_mark_answers_seen"]) {
      expect(fn(name), name).toMatch(/public\.can_see\(v_agency\) or public\.is_admin\(\)/);
    }
    expect(code).toMatch(/revoke all on public\.clearinghouse_published_items from anon, authenticated;/);
    expect(code).toMatch(/grant select on public\.clearinghouse_published_items to authenticated;/);
    expect(code).not.toMatch(/grant (insert|update|delete)[^;]*on public\.clearinghouse_published_items/);
  });
});
