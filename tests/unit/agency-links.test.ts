import { describe, expect, it } from "vitest";
import { agencyLinkProblem, isAgencyLink, NO_AGENCY_LINKS, toAgencyLinks } from "@/lib/agency-links";
import { fieldProblem } from "@/lib/onboarding-draft";

/** An agency's website, WhatsApp group and Facebook group (src/lib/agency-links.ts). */
describe("agency links", () => {
  it.each([
    ["website_url", "https://www.example.co.il"],
    ["website_url", "https://example.com/about?x=1"],
    ["whatsapp_group_url", "https://chat.whatsapp.com/AbC123xyz"],
    ["facebook_group_url", "https://www.facebook.com/groups/12345"],
    ["facebook_group_url", "https://facebook.com/agency.page"],
    ["facebook_group_url", "https://m.facebook.com/groups/x"],
  ])("UNIT-ALK-001: %s accepts %s", (column, value) => {
    expect(isAgencyLink(column, value)).toBe(true);
    expect(agencyLinkProblem(column, value)).toBeNull();
  });

  it.each([
    ["website_url", "http://www.example.co.il"],
    ["website_url", "https://localhost"],
    ["website_url", "javascript:alert(1)"],
    ["website_url", "https://exa mple.com"],
    ["whatsapp_group_url", "https://wa.me/972500000000"],
    ["whatsapp_group_url", "https://chat.whatsapp.com/"],
    ["whatsapp_group_url", "https://chat.whatsapp.com.evil.example/x"],
    ["facebook_group_url", "https://facebook.com.evil.example/groups/x"],
    ["facebook_group_url", "https://www.instagram.com/x"],
    ["facebook_group_url", "http://www.facebook.com/groups/x"],
  ])("UNIT-ALK-002: %s refuses %s", (column, value) => {
    expect(isAgencyLink(column, value)).toBe(false);
    expect(agencyLinkProblem(column, value)).toEqual(expect.any(String));
  });

  it("UNIT-ALK-003: every link is optional, and an over-long one is refused", () => {
    for (const column of ["website_url", "whatsapp_group_url", "facebook_group_url"]) {
      expect(agencyLinkProblem(column, "")).toBeNull();
      expect(agencyLinkProblem(column, null)).toBeNull();
      expect(agencyLinkProblem(column, "   ")).toBeNull();
    }
    expect(agencyLinkProblem("website_url", `https://example.com/${"a".repeat(500)}`)).toBe("הקישור ארוך מדי.");
    expect(agencyLinkProblem("email", "anything")).toBeNull();
  });

  it("UNIT-ALK-004: the wizard's fieldProblem asks the same rules by field key", () => {
    expect(fieldProblem("agency_profiles.whatsapp_group_url", "https://wa.me/1")).toMatch(/chat\.whatsapp\.com/);
    expect(fieldProblem("agency_profiles.facebook_group_url", "https://www.facebook.com/groups/1")).toBeNull();
    expect(fieldProblem("agency_profiles.website_url", "")).toBeNull();
  });

  it("UNIT-ALK-005: a site row's links come out null unless they pass, never a hostile href", () => {
    expect(toAgencyLinks({})).toEqual(NO_AGENCY_LINKS);
    expect(
      toAgencyLinks({
        website_url: "javascript:alert(1)",
        whatsapp_group_url: "https://chat.whatsapp.com/abc",
        facebook_group_url: 7,
      }),
    ).toEqual({ website: null, whatsappGroup: "https://chat.whatsapp.com/abc", facebookGroup: null });
  });
});
