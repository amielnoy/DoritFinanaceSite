import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * allow_submission for windows longer than a day (20261114000000), read as
 * source; supabase/tests/submission_limits_long_windows_check.sql proves it
 * against Postgres. The day-only version refused longer windows, and
 * withinLimit reads a refusal as "allow", so a long limit silently never held.
 */
const sql = readFileSync(join(REPO_ROOT, "supabase/migrations/20261114000000_submission_limits_long_windows.sql"), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .replace(/\s+/g, " ");

const windowsAsked = () => {
  const found: number[] = [];
  const dir = join(REPO_ROOT, "supabase/functions");
  for (const fn of readdirSync(dir)) {
    let src = "";
    try {
      src = readFileSync(join(dir, fn, "handler.ts"), "utf8");
    } catch {
      continue;
    }
    const consts = Object.fromEntries(
      [...src.matchAll(/const ([A-Z_]+) = ([\d\s*]+);/g)].map((m) => [m[1], m[2].split("*").reduce((a, b) => a * Number(b.trim()), 1)]),
    );
    for (const m of src.matchAll(/withinLimit\(log, rid, [^,]+, ([A-Z_]+|\d+)/g)) {
      found.push(/^\d+$/.test(m[1]) ? Number(m[1]) : consts[m[1]]);
    }
  }
  return found;
};

describe("allow_submission keeps each row for its own window", () => {
  it("records an expiry per row and prunes by it, not by a fixed day", () => {
    expect(sql).toContain("add column expires_at timestamptz not null");
    expect(sql).toContain("delete from public.submission_limits where expires_at < now();");
    expect(sql).not.toMatch(/where at < now\(\) - interval '1 day'/);
    expect(sql).toContain("values (p_key, now() + make_interval(secs => p_window_seconds))");
  });

  it("takes windows up to 366 days, and every window a function asks for", () => {
    expect(sql).toContain("if p_window_seconds not between 1 and 31622400 or p_max < 1 then");
    const asked = windowsAsked();
    expect(asked.length).toBeGreaterThan(10);
    for (const w of asked) expect(w, String(w)).toBeLessThanOrEqual(31622400);
  });

  it("stays the service role's alone", () => {
    expect(sql).toContain("revoke execute on function public.allow_submission(text, integer, integer) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.allow_submission(text, integer, integer) to service_role;");
  });
});
