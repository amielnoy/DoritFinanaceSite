import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOTIFY_EMAILS } from "../../supabase/functions/_shared/recipients";
import { AGENCY1_AGENT_ID, AGENCY1_CASES, AGENCY1_ID, AGENCY1_REVIEW_LINKS } from "../../src/config/agency1";
import { AGENCY_PROFILE } from "../../src/config/agencyProfile";
import { CONSENT, CONSENT_VERSION } from "../../src/config/compliance";
import { resolveSiteUrl } from "../../src/lib/seo";
import he from "../../src/i18n/locales/he/home.json";
import { agency1ContentRows, readAgency1Seed, SEED_FILE } from "../../e2e/fixtures/agency1-seed";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * Step 2 of the new-agency rollout seeds Dorit as agency 1 from the strings
 * the site bundles (docs/superpowers/plans/2026-10-21-agency-content-step2.md).
 * VITE_AGENCY_CONTENT shows the database's copy instead of the bundle's; this
 * is what keeps the two the same, so the flag can be turned on without a
 * visitor seeing a different site. CTR-AGC-010…017.
 */
const strings = he as Record<string, string>;
const raw = readFileSync(SEED_FILE, "utf8");
const seed = readAgency1Seed(raw);
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
const code = strip(raw).replace(/\$json\$[\s\S]*?\$json\$/, "$json$$json$");
const tenant = readFileSync(join(REPO_ROOT, "supabase/migrations/20261010000000_tenant_schema.sql"), "utf8");

describe("agency 1 seed", () => {
  it("CTR-AGC-010: the ids are the ones the code and the tenant migration use", () => {
    expect(seed.agency_id).toBe(AGENCY1_ID);
    expect(tenant).toContain(`insert into public.agencies (id, name, status, data_processing_agreement_date)\nvalues ('${AGENCY1_ID}'`);
    expect(seed.agent.id).toBe(AGENCY1_AGENT_ID);
  });

  it("CTR-AGC-011: the agent's identity is the bundled one", () => {
    const a = seed.agent;
    expect(a.full_name).toBe(AGENCY_PROFILE.displayName);
    expect(`${a.full_name} · ${a.professional_title}`).toBe(strings["hero.byline"]);
    expect(`${a.full_name} — ${a.professional_title}`).toBe(AGENCY_PROFILE.licenceEntity);
    expect(a.photo_alt).toBe(strings["hero.portraitAlt"]);
    expect(a.licence_number).toBe(AGENCY_PROFILE.licenceNumber);
    expect(a.licence_regulator).toBe(AGENCY_PROFILE.licenceRegulator);
    expect(a.grammatical_gender).toBe("f");
    expect(a.has_institutional_affiliation).toBe(true);
    expect(CONSENT.points[1]).toContain("ולה זיקה לגופים מוסדיים");
  });

  it("CTR-AGC-012: the bio, the stats and the review links are the about section's", () => {
    expect(seed.agent.bio).toEqual({
      headline: strings["hero.lead"],
      family: strings["about.family"],
      credentials: strings["about.credentials"],
      career: strings["about.career"],
      insight: strings["about.insight"],
      unique: strings["about.unique"],
      signature: strings["about.signature"],
    });
    expect(seed.agent.stats).toEqual(
      [1, 2, 3].map((n) => ({ num: strings[`about.stat${n}Num`], label: strings[`about.stat${n}`] })),
    );
    expect(seed.agent.review_links).toEqual(AGENCY1_REVIEW_LINKS);
  });

  it("CTR-AGC-013: the seven success cases are proof.c1…c7", () => {
    expect(seed.success_cases).toHaveLength(7);
    AGENCY1_CASES.forEach((c, i) => {
      expect(seed.success_cases[i]).toEqual({
        id: `00000000-0000-0000-0000-0000000005c${i + 1}`,
        sort_order: i + 1,
        tag: strings[`proof.${c.key}.tag`],
        title: strings[`proof.${c.key}.title`],
        body: strings[`proof.${c.key}.body`],
        metric: strings[`proof.${c.key}.metric`],
        metric_is_estimate: c.estimate,
      });
    });
  });

  it("CTR-AGC-014: the profile is what the site notifies, serves and consents under", () => {
    expect(seed.profile.notify_emails).toEqual([...NOTIFY_EMAILS]);
    expect(seed.profile.domain).toBe(new URL(resolveSiteUrl(undefined, undefined)).hostname);
    expect(seed.profile.consent_version).toBe(CONSENT_VERSION);
  });

  it("CTR-AGC-015: guard first, the agent, the cases, and the profile last (review N-1)", () => {
    const guard = code.indexOf("if exists (select 1 from public.agents where id =");
    const agent = code.indexOf("insert into public.agents");
    const cases = code.indexOf("insert into public.success_cases");
    const profile = code.indexOf("update public.agency_profiles");
    expect(guard).toBeGreaterThan(-1);
    for (const m of code.matchAll(/\binsert into\b/g)) expect(guard).toBeLessThan(m.index ?? 0);
    expect(agent).toBeGreaterThan(guard);
    expect(cases).toBeGreaterThan(agent);
    expect(profile).toBeGreaterThan(cases);
    // agents_after_change moves consent_version on an insert, so nothing that
    // writes may follow the profile.
    expect(code.slice(code.indexOf(";", profile))).not.toMatch(/\b(insert into|update|delete from)\b/);
    const update = code.slice(profile, code.indexOf(";", profile));
    for (const column of ["consent_version", "disclosures_approved_at", "notify_emails", "domain"]) {
      expect(update).toContain(column);
    }
  });

  it("CTR-AGC-016: the tenant migration's agency profile literals are AGENCY_PROFILE's", () => {
    const row = tenant.slice(tenant.indexOf("insert into public.agency_profiles"));
    const values = row.slice(row.indexOf("values (")).split(");")[0];
    for (const literal of [
      AGENCY_PROFILE.displayName,
      AGENCY_PROFILE.phoneE164,
      AGENCY_PROFILE.phoneDisplay,
      AGENCY_PROFILE.whatsapp,
      AGENCY_PROFILE.email,
      AGENCY_PROFILE.defaultWhatsappMessage,
    ]) {
      expect(values).toContain(`'${literal}'`);
    }
  });

  it("CTR-AGC-017: the e2e fixture serves the seed under the views' columns", () => {
    const rows = agency1ContentRows();
    expect(rows.get("public_agent_cards")).toHaveLength(1);
    expect(rows.get("public_agent_cards")?.[0]).toMatchObject({
      id: AGENCY1_AGENT_ID,
      licence_number: seed.agent.licence_number,
      photo_path: null,
      licence_types: [],
      affiliations: [],
    });
    expect(rows.get("public_agency_sites")?.[0]).toMatchObject({ domain: seed.profile.domain });
    expect(rows.get("success_cases")).toHaveLength(7);
  });
});
