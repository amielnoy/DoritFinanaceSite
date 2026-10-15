import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The leads sheet keeps what the database keeps (Architecture N-02). The rule
 * is proved by supabase/tests/lead_sheet_retention_check.sql in a scratch
 * Postgres and the job by sheet-retention.integration.test.ts; this fails in
 * CI the moment the rule, the cells it empties or its grants drift.
 */
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const stripSql = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const MIGRATION = "20261026000000_lead_sheet_retention.sql";
const sql = stripSql(read(`supabase/migrations/${MIGRATION}`));
const retention = stripSql(read("supabase/migrations/20261025000000_lead_retention.sql"));
const fn = read("supabase/functions/sheet-retention/handler.ts");
const config = read("supabase/config.toml");
const policy = read("src/pages/PrivacyPolicy.tsx");

const listed = (name: string) => {
  const m = new RegExp(`export const ${name} = \\[([^\\]]+)\\]`).exec(fn);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
};

describe("the leads sheet — the database's retention, row by row", () => {
  it("sorts after the lead retention it follows", () => {
    const files = readdirSync(join(REPO_ROOT, "supabase/migrations")).sort();
    expect(files.indexOf(MIGRATION)).toBeGreaterThan(files.indexOf("20261025000000_lead_retention.sql"));
  });

  it("counts a lead live only while it exists and is not anonymized, by either id", () => {
    expect(sql).toMatch(/l\.anonymized_at is null/);
    expect(sql).toMatch(/l\.base44_id = x/);
    expect(sql).toMatch(/l\.id = \(case when x ~\* '\^\[0-9a-f\]\{8\}/);
    // The anonymization it follows never touches a client, so a client's row is never emptied either.
    expect(retention).toMatch(/status <> 'client'/);
  });

  it("empties the visitor's details and keeps what the database keeps", () => {
    expect(listed("EVENTS_PERSONAL")).toEqual(["מועד מבוקש", "שם", "טלפון", "אימייל", "תקציר", "שלב חיים", "יעד עיקרי", "דאגה מרכזית", "מסלקה"]);
    for (const kept of ["מועד", "מקור", "נושא", "מזהה רשומה", "שלמות"]) expect(listed("EVENTS_PERSONAL")).not.toContain(kept);
    expect(listed("SUPPORT_PERSONAL")).toEqual(["טלפון", "תמלול"]);
  });

  it("keeps an unlinked Events row 24 months and a Support row 12, as promised", () => {
    expect(fn).toMatch(/export const EVENTS_MONTHS = 24;/);
    expect(fn).toMatch(/export const SUPPORT_MONTHS = 12;/);
    expect(policy).toMatch(/24 חודשים/);
  });

  it("lets only the service role ask or start it", () => {
    expect(sql).toMatch(/revoke execute on function public\.lead_sheet_live\(text\[\]\)\s+from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke execute on function public\.lead_sheet_call_retention\(\)\s+from public, anon, authenticated;/);
    for (const grant of sql.match(/grant execute[^;]+;/g) ?? []) expect(grant).toMatch(/to service_role;$/);
  });

  it("runs nightly after the anonymization, and the function checks the cron secret rather than a JWT", () => {
    expect(retention).toMatch(/cron\.schedule\(\s*'leads-retention',\s*'45 3 \* \* \*'/);
    expect(sql).toMatch(/cron\.schedule\('lead-sheet-retention', '30 4 \* \* \*'/);
    expect(config).toMatch(/\[functions\.sheet-retention\]\nverify_jwt = false/);
    expect(fn).toMatch(/req\.headers\.get\('x-site-cron'\)/);
    expect(sql).toMatch(/'x-site-cron', secret/);
  });
});
