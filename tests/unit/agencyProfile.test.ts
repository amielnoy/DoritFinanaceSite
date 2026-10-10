import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { read } from "../helpers/source-scan";
import { AGENCY_PROFILE } from "@/config/agencyProfile";
import { CONTACT } from "@/config/contact";
import { LICENCE } from "@/config/compliance";
import { GA4_MEASUREMENT_ID } from "@/lib/analytics";

/**
 * Phase 0 of the multi-agent platform design: contact, licence and the GA4 id
 * now read from one profile instead of each declaring its own value. These
 * pin that nothing drifted apart during the move.
 */
describe("agencyProfile — one source, no drift", () => {
  it("CONTACT matches the profile", () => {
    expect(CONTACT).toEqual({
      phoneE164: AGENCY_PROFILE.phoneE164,
      phoneDisplay: AGENCY_PROFILE.phoneDisplay,
      whatsapp: AGENCY_PROFILE.whatsapp,
      email: AGENCY_PROFILE.email,
      defaultWhatsappMessage: AGENCY_PROFILE.defaultWhatsappMessage,
    });
  });

  it("LICENCE matches the profile", () => {
    expect(LICENCE).toEqual({
      entity: AGENCY_PROFILE.licenceEntity,
      number: AGENCY_PROFILE.licenceNumber,
      regulator: AGENCY_PROFILE.licenceRegulator,
    });
  });

  it("GA4_MEASUREMENT_ID matches the profile", () => {
    expect(GA4_MEASUREMENT_ID).toBe(AGENCY_PROFILE.ga4MeasurementId);
  });

  it("index.html's static tag still matches the profile", () => {
    // index.html is static markup, read before any JS runs, so it cannot
    // import the profile — it stays a literal until a later phase templates
    // it. This guards against the one way that literal could silently drift.
    const html = read(join(REPO_ROOT, "index.html"));
    const occurrences = html.match(/G-[A-Z0-9]+/g) ?? [];
    expect(occurrences.length, "index.html's GA4 id tag went missing").toBeGreaterThan(0);
    for (const id of occurrences) {
      expect(id).toBe(AGENCY_PROFILE.ga4MeasurementId);
    }
  });

  it("the tenant-schema migration's seed row matches the profile", () => {
    // The migration backfills `agency_profiles` for agency 1 with its own
    // copy of these values (Postgres cannot import a TS module). This is
    // the only thing stopping that copy from silently drifting — see A-34
    // in tests/test-plan/10-known-issues.md for what unchecked drift cost
    // before Phase 0.
    const migration = read(
      join(REPO_ROOT, "supabase/migrations/20261010000000_tenant_schema.sql"),
    );
    const insert = migration.match(
      /insert into public\.agency_profiles[\s\S]*?values\s*\(([\s\S]*?)\);/,
    );
    expect(insert, "no agency_profiles seed insert found in the migration").not.toBeNull();
    const values = [...insert![1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]);
    // Positional, matching the insert's own column list:
    // agency_id, display_name, phone_e164, phone_display, whatsapp, email,
    // default_whatsapp_message, licence_entity, licence_number, licence_regulator, ga4_measurement_id
    const [, , phoneE164, phoneDisplay, whatsapp, email, defaultWhatsappMessage, licenceEntity, licenceNumber, licenceRegulator, ga4MeasurementId] = values;
    expect({
      phoneE164, phoneDisplay, whatsapp, email, defaultWhatsappMessage,
      licenceEntity, licenceNumber, licenceRegulator, ga4MeasurementId,
    }).toEqual({
      phoneE164: AGENCY_PROFILE.phoneE164,
      phoneDisplay: AGENCY_PROFILE.phoneDisplay,
      whatsapp: AGENCY_PROFILE.whatsapp,
      email: AGENCY_PROFILE.email,
      defaultWhatsappMessage: AGENCY_PROFILE.defaultWhatsappMessage,
      licenceEntity: AGENCY_PROFILE.licenceEntity,
      licenceNumber: AGENCY_PROFILE.licenceNumber,
      licenceRegulator: AGENCY_PROFILE.licenceRegulator,
      ga4MeasurementId: AGENCY_PROFILE.ga4MeasurementId,
    });
  });

  it("the tenant-schema migration's agencies.name and membership-lookup email also match the profile", () => {
    // Two more literals in the same migration copy from AGENCY_PROFILE but
    // live outside the agency_profiles insert the test above checks:
    // agencies.name copies licenceEntity (the agency's own legal name is
    // also what the one fixed agency is called), and the membership
    // seed's `where email = ...` lookup copies email (it has to match the
    // same address agency_profiles was seeded with, or Dorit's own seed
    // membership insert silently finds nobody).
    const migration = read(
      join(REPO_ROOT, "supabase/migrations/20261010000000_tenant_schema.sql"),
    );
    const agenciesInsert = migration.match(
      /insert into public\.agencies[\s\S]*?values\s*\(([\s\S]*?)\);/,
    );
    expect(agenciesInsert, "no agencies seed insert found in the migration").not.toBeNull();
    const agenciesValues = [...agenciesInsert![1].matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]);
    // Positional, matching the insert's own column list: id, name, status.
    const [, name] = agenciesValues;
    expect(name).toBe(AGENCY_PROFILE.licenceEntity);

    const membershipLookup = migration.match(
      /from auth\.users where email = '((?:[^']|'')*)'/,
    );
    expect(
      membershipLookup,
      "no membership-lookup email found in the migration",
    ).not.toBeNull();
    expect(membershipLookup![1]).toBe(AGENCY_PROFILE.email);
  });
});
