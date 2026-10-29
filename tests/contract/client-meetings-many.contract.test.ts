import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * Many meetings per lead (20261104000000_client_meetings_many.sql, rollout 3 of
 * docs/superpowers/specs/2026-10-17-client-meetings-design.md). The key it
 * drops is the one an upsert on lead_id needs; a writer that came back to that
 * upsert would fail in production with "no unique constraint matching".
 */
const DIR = join(REPO_ROOT, "supabase/migrations");
const FILE = "20261104000000_client_meetings_many.sql";
const code = readFileSync(join(DIR, FILE), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

/** Every source file under these roots, tests and dependencies aside. */
function sources(...roots: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx|js|jsx|mjs|sql)$/.test(name)) out.push(path);
    }
  };
  for (const root of roots) walk(join(REPO_ROOT, root));
  return out;
}

describe("many meetings per lead", () => {
  it("sorts after the additive migration it depends on", () => {
    const all = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(all.indexOf(FILE)).toBeGreaterThan(all.indexOf("20261103000000_client_meetings.sql"));
  });

  it("drops the one-meeting key and indexes a lead's meetings by time", () => {
    expect(code).toMatch(/alter table public\.meetings drop constraint meetings_lead_id_key;/);
    expect(code).toMatch(/create index meetings_lead_id_scheduled on public\.meetings \(lead_id, scheduled_at\);/);
  });

  it("leaves no writer upserting meetings on lead_id", () => {
    // Code, not comments: this migration's own header explains the upsert it retires.
    const code = (file: string) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(--|\/\/|\*|\/\*)/.test(l))
        .join("\n");
    const offenders = sources("supabase/functions", "src", "api", "scripts", "supabase/migrations").filter((file) =>
      /on_conflict=lead_id|onConflict:?\s*["']lead_id|on conflict \(lead_id\)|upsertRow\(\s*["']meetings/.test(code(file)),
    );
    expect(offenders).toEqual([]);
  });
});
