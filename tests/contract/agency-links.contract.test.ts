import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ONBOARDING_STEPS } from "../../src/config/onboarding";
import { FIELD_WIDGETS } from "../../src/components/dorit/onboarding/fields";
import { AGENCY_LINK_COLUMNS, AGENCY_LINK_MAX_LENGTH, AGENCY_LINK_PATTERNS } from "../../src/lib/agency-links";
import { SITE_COLUMNS } from "../../src/services/supabase/agency-content-tables";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * An agency's own links (supabase/migrations/20261115000000_agency_links.sql),
 * read as source: the CHECKs and src/lib/agency-links.ts must say the same
 * thing, and the public view may grow by these three columns and nothing else.
 */
const DIR = join(REPO_ROOT, "supabase/migrations");
const FILE = "20261115000000_agency_links.sql";
const sql = readFileSync(join(DIR, FILE), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const flat = sql.replace(/\s+/g, " ");

/** The view's columns before this migration (CTR-AGC-006), in order. */
const ORIGINAL_SITE_COLUMNS = [
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
const LINK_COLUMNS = Object.values(AGENCY_LINK_COLUMNS);

describe("agency links, schema", () => {
  it("CTR-ALK-001: sorts after every migration it builds on", () => {
    const all = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(all.indexOf(FILE)).toBeGreaterThan(all.indexOf("20261106100000_agency_content_read_side.sql"));
  });

  it.each(LINK_COLUMNS)("CTR-ALK-002: %s is a nullable text column whose CHECK is agency-links.ts's pattern", (column) => {
    const m = new RegExp(`add column ${column} text check \\(([^;]*?)\\)(?:,|;)`).exec(flat);
    expect(m, `no add column ${column}`).not.toBeNull();
    const check = m![1];
    expect(check).not.toMatch(/not null/);
    expect(check).toContain(`char_length(${column}) <= ${AGENCY_LINK_MAX_LENGTH}`);
    expect(check).toContain(`${column} ~ '${AGENCY_LINK_PATTERNS[column]}'`);
  });

  it("CTR-ALK-003: the public view appends exactly the three links, and keeps its filters and grants", () => {
    const view = /create or replace view public\.public_agency_sites with \(security_invoker = false\) as([\s\S]*?);/.exec(sql)?.[1] ?? "";
    const select = /select([\s\S]*?)\bfrom\b/.exec(view)?.[1] ?? "";
    expect(select.split(",").map((c) => c.trim())).toEqual([...ORIGINAL_SITE_COLUMNS, ...LINK_COLUMNS].map((c) => `p.${c}`));
    expect(view.replace(/\s+/g, " ")).toContain("where a.status = 'active' and p.domain is not null");
    const grants = flat.match(/grant [^;]+ on public\.public_agency_sites\b[^;]*;/g) ?? [];
    expect(grants).toEqual(["grant select on public.public_agency_sites to anon, authenticated;"]);
  });

  it("CTR-ALK-004: touches no policy, grant or guard on agency_profiles", () => {
    expect(flat).not.toMatch(/\b(create|drop|alter) policy\b/);
    expect(flat).not.toMatch(/\bon public\.agency_profiles\b/);
    expect(flat).not.toMatch(/agency_profiles_guard/);
  });
});

describe("agency links, wizard and site", () => {
  const contact = ONBOARDING_STEPS.find((s) => s.id === "contact")!;

  it.each(LINK_COLUMNS)("CTR-ALK-005: %s is an optional url field of step 3, and the site reads it", (column) => {
    const key = `agency_profiles.${column}`;
    expect(contact.fields.find((f) => f.key === key)?.required).toBe("optional");
    expect(FIELD_WIDGETS[key]?.kind).toBe("url");
    expect(SITE_COLUMNS.split(",")).toContain(column);
  });

  it("CTR-ALK-006: the footer renders the links from the agency's content", () => {
    const footer = readFileSync(join(REPO_ROOT, "src/components/dorit/layout/Footer.tsx"), "utf8");
    expect(footer).toMatch(/const \{[^}]*\blinks\b[^}]*\} = useAgencyContent\(\)/);
    for (const name of Object.keys(AGENCY_LINK_COLUMNS)) expect(footer).toContain(`name: "${name}"`);
  });
});
