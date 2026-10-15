import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lead retention (20261025000000_lead_retention.sql) against what it must agree
 * with: the statuses everywhere a lead's status is spelled out, and the period
 * and the remedy the privacy policy promises.
 */
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const migration = read("supabase/migrations/20261025000000_lead_retention.sql");
const quoted = (s: string) => [...s.matchAll(/['"]([a-z_]+)['"]/g)].map((m) => m[1]).sort();

describe("lead retention", () => {
  it("sorts after every migration already applied", () => {
    const all = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(all.indexOf("20261025000000_lead_retention.sql")).toBeGreaterThan(all.indexOf("20261024000000_clearinghouse_publish.sql"));
  });

  const dbStatuses = quoted(/check \(status in \(([^)]*)\)\)/.exec(migration)![1]);

  it("allows the same statuses in the database, the Base44 entity and adminLead", () => {
    expect(dbStatuses).toEqual(["client", "closed", "contacted", "escalated", "new", "partial"]);
    const entity = read("base44/entities/Lead.jsonc");
    const statusEnum = /"status":\s*\{[^}]*"enum":\s*\[([^\]]*)\]/s.exec(entity)![1];
    expect(quoted(statusEnum)).toEqual(dbStatuses);
    const adminLead = /const STATUSES = \[([^\]]*)\]/.exec(read("base44/functions/adminLead/entry.ts"))![1];
    expect(quoted(adminLead)).toEqual(dbStatuses);
  });

  it("lets an admin set every status the type names, client included, and each one exists in the database", () => {
    const type = /export type LeadStatus = ([^;]*);/.exec(read("src/services/ports.ts"))![1];
    const settable = quoted(type);
    expect(settable).toContain("client");
    for (const s of settable) expect(dbStatuses).toContain(s);
  });

  it("keeps the privacy policy's promise: 24 months from the last contact, then deleted or anonymized", () => {
    const policy = read("src/pages/PrivacyPolicy.tsx");
    expect(policy).toMatch(/פנייה שלא הבשילה להתקשרות נשמרת עד 24 חודשים ממועד הקשר\s+האחרון/);
    expect(policy).toMatch(/נמחק או עובר\s+אנונימיזציה/);
    expect(migration).toMatch(/cutoff constant timestamptz := p_now - interval '24 months'/);
    expect(migration).toMatch(/greatest\(l\.created_at, l\.updated_at, coalesce\(m\.scheduled_at, l\.created_at\)\) < cutoff/);
  });

  it("never touches a client, and anonymizes what identifies the person", () => {
    expect(migration).toMatch(/where l\.status <> 'client'/);
    for (const field of ["name = 'נמחק'", "phone = ''", "email = null", "message = null", "summary = null", "profile = null", "notes = null"]) {
      expect(migration, field).toContain(field);
    }
  });

  it("runs nightly and only as the database itself", () => {
    expect(migration).toMatch(/revoke execute on function public\.anonymize_stale_leads\(timestamptz\) from public, anon, authenticated/);
    expect(migration).toMatch(/cron\.schedule\(\s*'leads-retention',\s*'45 3 \* \* \*',\s*\$\$select public\.anonymize_stale_leads\(\)\$\$/);
  });
});
