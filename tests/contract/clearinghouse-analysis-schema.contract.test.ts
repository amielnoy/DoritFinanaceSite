import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * Snapshots and review decisions, read as source.
 * `supabase/tests/clearinghouse_analysis_check.sql` proves the behaviour
 * against a local Supabase; this runs in CI and fails the moment a grant, a
 * policy or the purge is edited away.
 */
const DIR = join(REPO_ROOT, "supabase/migrations");
const FILE = "20261021000000_clearinghouse_analysis.sql";
const code = readFileSync(join(DIR, FILE), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

const columnsOf = (grant: RegExpMatchArray | null) => grant![1].split(",").map((c) => c.trim());

describe("the clearinghouse analysis migration", () => {
  it("sorts after the clearinghouse pipeline's migrations", () => {
    const all = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(all.indexOf(FILE)).toBeGreaterThan(all.indexOf("20261019000000_masleka_wipe_notice.sql"));
  });

  it("turns row-level security on for both tables, and grants anon nothing", () => {
    expect(code).toMatch(/alter table public\.clearinghouse_snapshots\s+enable row level security;/);
    expect(code).toMatch(/alter table public\.clearinghouse_reviews\s+enable row level security;/);
    for (const grant of code.match(/grant [^;]+;/gi) ?? []) expect(grant, grant).not.toMatch(/\banon\b/);
  });

  it("scopes both tables to the snapshot's agency", () => {
    const policies = code.match(/create policy[\s\S]+?;/g) ?? [];
    expect(policies).toHaveLength(2);
    for (const p of policies) expect(p).toMatch(/can_see\((s\.)?agency_id\)/);
  });

  it("never lets the browser edit a snapshot, set its retention or say who wrote it", () => {
    expect(code).not.toMatch(/grant [^;]*update[^;]*on public\.clearinghouse_snapshots/i);
    const insert = columnsOf(code.match(/grant insert \(([^)]+)\)\s+on public\.clearinghouse_snapshots to authenticated;/));
    for (const kept of ["delete_after", "created_by", "created_at", "id"]) expect(insert).not.toContain(kept);
    expect(code).not.toMatch(/grant [^;(]*insert[^;(]*on public\.clearinghouse_snapshots/i);
  });

  it("lets the browser change a decision's status and wording only — the database stamps who and when", () => {
    const update = columnsOf(code.match(/grant update \(([^)]+)\) on public\.clearinghouse_reviews to authenticated;/));
    expect(update.sort()).toEqual(["final_text", "status"]);
    expect(code).toMatch(/new\.reviewed_by := auth\.uid\(\);/);
    expect(code).toMatch(/before insert or update on public\.clearinghouse_reviews/);
  });

  it("purges snapshots past retention nightly, their decisions with them, and only the service role may run it", () => {
    expect(code).toMatch(/delete from public\.clearinghouse_snapshots where delete_after <= now\(\)/);
    expect(code).toMatch(/references public\.clearinghouse_snapshots\(id\) on delete cascade/);
    expect(code).toMatch(/revoke execute on function public\.clearinghouse_purge\(\) from public, anon, authenticated;/);
    expect(code).toMatch(/cron\.schedule\('clearinghouse-purge'/);
  });

  it("stores the report as an object, capped in size, and no raw file anywhere", () => {
    expect(code).toMatch(/jsonb_typeof\(data\) = 'object'/);
    expect(code).toMatch(/pg_column_size\(data\) < 262144/);
    expect(code).not.toMatch(/storage\.buckets|bytea|\bxml\b/i);
  });
});
