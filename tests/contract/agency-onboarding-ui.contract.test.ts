import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { ONBOARDING_STEPS, submitRequiredKeys } from "@/config/onboarding";
import { FIELD_WIDGETS } from "@/components/dorit/onboarding/fields";
import { emptyDraft, missingKeys } from "@/lib/onboarding-draft";

/**
 * The wizard's screens (Rollout step 4) against src/config/onboarding.ts, read
 * as source: every field has a form, the forms come from that file and not
 * from the pages, and the screens stay behind VITE_AGENCY_ONBOARDING.
 */
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");
const KEYS = ONBOARDING_STEPS.flatMap((s) => s.fields.map((f) => f.key));

describe("the agency wizard's forms", () => {
  it("give every field in onboarding.ts a widget, and no field it does not name", () => {
    for (const key of KEYS) expect(FIELD_WIDGETS[key], `no widget for ${key}`).toBeDefined();
    expect(Object.keys(FIELD_WIDGETS).sort()).toEqual([...KEYS].sort());
  });

  it("render each step from onboarding.ts's own list, not a copy in the page", () => {
    const wizard = read("src/pages/AgencyOnboarding.tsx");
    expect(wizard).toContain("ONBOARDING_STEPS.filter((s) => s.number > 0)");
    expect(wizard).toContain("fieldsOf(current.fields)");
    const opening = read("src/pages/AgencyNew.tsx");
    expect(opening).toContain('ONBOARDING_STEPS.find((s) => s.id === "open")');
    expect(opening).toContain("OPEN.fields.map(");
    // No page spells a field key of its own beyond the ones it derives or offers defaults for.
    for (const key of KEYS.filter((k) => !["agents.full_name", "agents.professional_title", "agency_profiles.licence_entity", "agency_profiles.default_whatsapp_message", "agency_profiles.email", "agency_profiles.notify_emails", "agents.licence_number", "agents.licence_regulator", "agents.has_institutional_affiliation", "agency_profiles.display_name", "agents.grammatical_gender", "agents.photo_path", "agency_profiles.phone_e164", "agencies.name", "agencies.data_processing_agreement_date", "agency_profiles.onboarding.review.owner_email"].includes(k))) {
      expect(wizard, `${key} is spelled in the wizard page`).not.toContain(`"${key}"`);
    }
  });

  it("hold an empty draft to every key submit_agency_for_review does (bar the defaults the table gives)", () => {
    const missing = missingKeys(emptyDraft("a", "שם"));
    for (const key of submitRequiredKeys()) {
      if (["agents.affiliations", "agency_profiles.display_name", "agents.licence_regulator"].includes(key)) continue;
      expect(missing, key).toContain(key);
    }
  });

  it("route the screens only while VITE_AGENCY_ONBOARDING is on", () => {
    const app = read("src/App.jsx");
    for (const path of ["/admin/agencies/new", "/admin/agencies/:agencyId/review", "/admin/onboarding/:agencyId", 'path="/admin/agencies"']) {
      const at = app.indexOf(path);
      expect(at, path).toBeGreaterThan(-1);
      expect(app.lastIndexOf("{AGENCY_ONBOARDING ? (", at), `${path} is outside the switch`).toBeGreaterThan(app.lastIndexOf(") : null}", at));
    }
    expect(read("src/components/DraftOwnerRedirect.tsx")).toContain("if (!AGENCY_ONBOARDING");
    expect(read("src/components/dorit/admin/AdminLayout.tsx")).toContain('AGENCY_ONBOARDING && (status === "draft" || status === "pending_review")');
  });

  it("serve the wizard's paths as the app", () => {
    const vercel = read("vercel.json");
    for (const source of ["/admin/agencies/new", "/admin/agencies/:agencyId/review", "/admin/onboarding/:agencyId"]) expect(vercel).toContain(`"source": "${source}"`);
    expect(vercel).toMatch(/"\/admin\/:page\([^)]*\bagencies\b[^)]*\)"/);
  });

  it("invite the owner with the users screen's own invite-user call, as owner", () => {
    expect(read("src/pages/AgencyNew.tsx")).toContain('services.usersAdmin.invite({ email, orgId: id, role: "owner" })');
  });
});
