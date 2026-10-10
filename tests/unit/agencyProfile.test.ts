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
});
