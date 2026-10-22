import { describe, expect, it } from "vitest";
import {
  ACTIVATION_GATES,
  ONBOARDING_STEPS,
  isLicenceNumber,
  missingByStep,
  stepOfKey,
  submitRequiredKeys,
} from "@/config/onboarding";

/* src/config/onboarding.ts: the wizard's steps and fields as data. The RPC side is the contract test's. */

describe("the wizard's steps", () => {
  it("runs 0 to 7, operator's step first, review last", () => {
    expect(ONBOARDING_STEPS.map((s) => s.number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(ONBOARDING_STEPS[0].id).toBe("open");
    expect(ONBOARDING_STEPS.at(-1)?.id).toBe("review");
  });

  it("names every column once, under a table the wizard writes", () => {
    const keys = ONBOARDING_STEPS.flatMap((s) => s.fields.flatMap((f) => [f.key, ...(f.alsoWrites ?? [])]));
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^(agencies|agency_profiles|agents)\.[a-z0-9_]+(\.[a-z0-9_]+)*$/);
  });

  it("keeps the photo, testimonials, booking and the personal line optional", () => {
    const required = submitRequiredKeys();
    for (const key of ["agents.photo_path", "agents.booking_url", "agents.bio.family", "agents.review_links", "agency_profiles.service_area"]) {
      expect(required, key).not.toContain(key);
    }
  });
});

describe("submitRequiredKeys", () => {
  it("lists the typed-once phone's three columns, and the conditional bodies", () => {
    const required = submitRequiredKeys();
    expect(required).toEqual(expect.arrayContaining([
      "agency_profiles.phone_e164", "agency_profiles.phone_display", "agency_profiles.whatsapp", "agents.affiliations",
    ]));
    expect(required).not.toContain("agencies.name");
    expect(required).not.toContain("agencies.data_processing_agreement_date");
  });
});

describe("stepOfKey and missingByStep", () => {
  it("sends each reported key back to its step", () => {
    expect(stepOfKey("agents.bio.headline")).toBe("about");
    expect(stepOfKey("agency_profiles.whatsapp")).toBe("contact");
    expect(stepOfKey("agents.licence_number")).toBe("licence");
    expect(stepOfKey("agents.nope")).toBeNull();
  });

  it("groups an RPC's detail by step, in step order, and keeps keys it does not know", () => {
    expect(missingByStep("agents.bio.career, agency_profiles.email,agents.full_name,agents.future_field,")).toEqual([
      { step: "licensee", keys: ["agents.full_name"] },
      { step: "contact", keys: ["agency_profiles.email"] },
      { step: "about", keys: ["agents.bio.career"] },
      { step: "review", keys: ["agents.future_field"] },
    ]);
    expect(missingByStep("")).toEqual([]);
  });
});

describe("isLicenceNumber", () => {
  it("accepts L- and digits loosely, and refuses what is plainly not a number", () => {
    for (const ok of ["L-00107009", "l-123", "L00107009", " L-1 "]) expect(isLicenceNumber(ok), ok).toBe(true);
    for (const bad of ["", "L-", "00107009", "L-12a", "X-123", "L-1234567890123"]) expect(isLicenceNumber(bad), bad).toBe(false);
  });
});

describe("ACTIVATION_GATES", () => {
  it("is the spec's three gates", () => {
    expect(ACTIVATION_GATES.map((g) => g.key)).toEqual([
      "agents.licence_verified_at",
      "agencies.data_processing_agreement_date",
      "agency_profiles.disclosures_approved_at",
    ]);
  });
});
