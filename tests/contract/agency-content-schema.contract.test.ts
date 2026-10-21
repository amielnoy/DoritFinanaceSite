import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TESTIMONIAL_COLUMNS } from "../../src/services/supabase/SupabaseContentService";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The new-agency wizard's read side (Rollout step 2), read as source.
 * supabase/tests/agency_content_check.sql proves the behaviour against a
 * database; this fails in CI the moment the testimonials' column grants
 * (review M-2) or the public views are widened.
 */
const DIR = join(REPO_ROOT, "supabase/migrations");
const FILE = "20261106100000_agency_content_read_side.sql";
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
const sql = existsSync(join(DIR, FILE)) ? strip(readFileSync(join(DIR, FILE), "utf8")) : "";
const flat = sql.replace(/\s+/g, " ");

/** What a visitor may read of a testimonial (docs/superpowers/plans/2026-10-21-agency-content-step2.md). */
const ANON_TESTIMONIAL_COLUMNS = [
  "id",
  "base44_id",
  "agency_id",
  "agent_id",
  "name",
  "role",
  "quote",
  "image_url",
  "rating",
  "source",
  "source_url",
  "sort_order",
  "created_at",
  "updated_at",
];
const SITE_COLUMNS = [
  "agency_id",
  "domain",
  "display_name",
  "phone_e164",
  "phone_display",
  "whatsapp",
  "email",
  "default_whatsapp_message",
  "service_area",
];

const testimonialGrants = () => flat.match(/grant [^;]+ on public\.testimonials\b[^;]*;/g) ?? [];
const columnsOf = (list: string) => list.split(",").map((c) => c.trim());

describe("agency content, read-side schema", () => {
  it("sorts after the onboarding migration and before the agency-1 seed (CTR-AGC-001)", () => {
    const all = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(all).toContain(FILE);
    expect(all.indexOf(FILE)).toBeGreaterThan(all.indexOf("20261106000000_agency_onboarding.sql"));
    expect(FILE < "20261107000000_seed_agency1_content.sql").toBe(true);
  });

  it("takes the table-level read of testimonials away from visitors and members (CTR-AGC-002)", () => {
    expect(flat).toContain("revoke select on public.testimonials from anon, authenticated;");
  });

  it("grants visitors exactly the public columns, never the consent stamp (CTR-AGC-003)", () => {
    const m = /grant select \(([^)]*)\) on public\.testimonials to anon, authenticated;/.exec(flat);
    expect(m, "no column grant to anon, authenticated").not.toBeNull();
    const granted = columnsOf(m![1]);
    expect(new Set(granted)).toEqual(new Set(ANON_TESTIMONIAL_COLUMNS));
    expect(granted).toHaveLength(ANON_TESTIMONIAL_COLUMNS.length);
    expect(granted).not.toContain("consent_confirmed_by");
    expect(granted).not.toContain("consent_confirmed_at");
    // Every reader keeps working: the site's own list, and the live smoke's base44_id.
    for (const col of [...TESTIMONIAL_COLUMNS.split(","), "base44_id"]) expect(granted, col).toContain(col);
  });

  it("lets a signed-in member read the consent date, and nothing else besides (CTR-AGC-004)", () => {
    const grants = testimonialGrants();
    const others = grants.filter((g) => !/^grant select \([^)]*\) on public\.testimonials to anon, authenticated;$/.test(g));
    expect(grants).toHaveLength(2);
    expect(others).toEqual(["grant select (consent_confirmed_at) on public.testimonials to authenticated;"]);
  });

  // An outside agency's public testimonials wait for Rollout 5, with an
  // agency_id filter on every reader in the same change.
  it("opens no other agency's testimonials to visitors (CTR-AGC-005)", () => {
    expect(flat).not.toMatch(/create policy \S+ on public\.testimonials\b/);
  });

  it("shows a site's contact details only for live agencies with a domain, through a definer view of nine columns (CTR-AGC-006)", () => {
    const view = /create view public\.public_agency_sites with \(security_invoker = false\) as([\s\S]*?);/.exec(sql)?.[1] ?? "";
    expect(view).not.toBe("");
    const select = /^\s*select([\s\S]*?)\bfrom\b/.exec(view)?.[1] ?? "";
    expect(columnsOf(select)).toEqual(SITE_COLUMNS.map((c) => `p.${c}`));
    expect(view).toMatch(/from public\.agency_profiles p\s+join public\.agencies a on a\.id = p\.agency_id\s+where a\.status = 'active'\s+and p\.domain is not null\s*$/);
    for (const banned of ["notify_emails", "mail_from", "onboarding", "consent_version", "ga4_measurement_id", "disclosures_", "licence_", "*"]) {
      expect(view, banned).not.toContain(banned);
    }
  });

  it("grants the view to visitors and members only to read (CTR-AGC-007)", () => {
    expect(flat).toContain("revoke all on public.public_agency_sites from anon, authenticated, service_role;");
    expect(flat).toContain("grant select on public.public_agency_sites to anon, authenticated;");
    const grants = flat.match(/grant [^;]+ on public\.public_agency_sites\b[^;]*;/g) ?? [];
    expect(grants).toEqual(["grant select on public.public_agency_sites to anon, authenticated;"]);
  });

  it("gives visitors no grant on agency_profiles, agencies or agents (CTR-AGC-008)", () => {
    const grants = flat.match(/grant [^;]+;/g) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      if (/public\.(agency_profiles|agencies|agents)\b/.test(grant)) expect(grant).not.toMatch(/\banon\b/);
    }
  });

  it("adds a success case's tag and estimate flag, and nothing else (CTR-AGC-009)", () => {
    const alters = flat.match(/alter table public\.success_cases [^;]+;/g) ?? [];
    expect(alters).toHaveLength(1);
    const added = [...alters[0].matchAll(/add column ([^,;]+)/g)].map((m) => m[1].trim());
    expect(added).toEqual([
      "tag text check (char_length(tag) <= 60)",
      "metric_is_estimate boolean not null default false",
    ]);
  });
});
