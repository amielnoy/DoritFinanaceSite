import { describe, expect, it } from "vitest";
import {
  defaultLicenceEntity,
  defaultWhatsappMessage,
  disclosurePreview,
  emptyDraft,
  getField,
  isMobile,
  missingKeys,
  phoneFields,
  setField,
  type OnboardingDraft,
} from "@/lib/onboarding-draft";
import { submitRequiredKeys } from "@/config/onboarding";

const AGENCY = "aaaaaaaa-0000-4000-8000-000000000001";

/** A draft with every required field filled. */
function complete(): OnboardingDraft {
  let d = emptyDraft(AGENCY, "סוכנות רחל");
  const set = (key: string, value: unknown) => (d = setField(d, key, value));
  set("agents.full_name", "רחל לוי");
  set("agents.grammatical_gender", "f");
  set("agents.professional_title", "סוכנת ביטוח");
  set("agency_profiles.display_name", "רחל לוי");
  set("agents.licence_number", "L-12345");
  set("agents.licence_types", ["pension_agent"]);
  set("agents.licence_regulator", "רשות שוק ההון, ביטוח וחיסכון");
  set("agents.has_institutional_affiliation", false);
  set("agency_profiles.licence_entity", "רחל לוי");
  d = { ...d, agency_profiles: { ...d.agency_profiles, ...phoneFields("0521234567") } };
  set("agency_profiles.email", "rachel@example.com");
  set("agency_profiles.default_whatsapp_message", "שלום רחל");
  set("agency_profiles.notify_emails", ["rachel@example.com"]);
  set("agents.bio.headline", "תכנון בלי אותיות קטנות");
  set("agents.bio.career", "15 שנה בתחום");
  return d;
}

describe("getField / setField", () => {
  it("reads and writes a column and a jsonb path by the key onboarding.ts names", () => {
    let d = emptyDraft(AGENCY, "שם");
    d = setField(d, "agents.full_name", "רחל");
    d = setField(d, "agents.bio.headline", "פתיחה");
    d = setField(d, "agency_profiles.onboarding.review.owner_email", "o@example.com");
    expect(getField(d, "agents.full_name")).toBe("רחל");
    expect(getField(d, "agents.bio.headline")).toBe("פתיחה");
    expect(getField(d, "agency_profiles.onboarding.review.owner_email")).toBe("o@example.com");
    expect(getField(d, "agencies.name")).toBe("שם");
  });

  it("never changes the draft it was given", () => {
    const d = emptyDraft(AGENCY, "שם");
    setField(d, "agents.bio.career", "x");
    expect(getField(d, "agents.bio.career")).toBeUndefined();
  });
});

describe("missingKeys — the browser's copy of onboarding_missing", () => {
  it("lists every submit-required key on an empty draft, in onboarding.ts order", () => {
    const missing = missingKeys(emptyDraft(AGENCY, "שם"));
    // Not affiliations: required only once "יש זיקה" is answered yes. display_name is filled from the agency's name.
    const expected = submitRequiredKeys().filter((k) => k !== "agents.affiliations" && k !== "agency_profiles.display_name");
    // licence_regulator has a default, as the column does.
    expect(missing).toEqual(expected.filter((k) => k !== "agents.licence_regulator"));
  });

  it("is empty for a complete draft", () => {
    expect(missingKeys(complete())).toEqual([]);
  });

  it("asks for the institutional bodies only when an affiliation is declared", () => {
    const d = setField(complete(), "agents.has_institutional_affiliation", true);
    expect(missingKeys(d)).toEqual(["agents.affiliations"]);
    expect(missingKeys(setField(d, "agents.affiliations", ["הראל"]))).toEqual([]);
  });

  it("treats blank text, an empty list and an unanswered yes/no as missing", () => {
    let d = setField(complete(), "agents.bio.career", "   ");
    d = setField(d, "agency_profiles.notify_emails", []);
    d = setField(d, "agents.has_institutional_affiliation", null);
    expect(missingKeys(d)).toEqual([
      "agents.has_institutional_affiliation",
      "agency_profiles.notify_emails",
      "agents.bio.career",
    ]);
  });
});

describe("phone", () => {
  it("accepts an Israeli mobile in any spelling", () => {
    expect(isMobile("052-123-4567")).toBe(true);
    expect(isMobile("+972 52 1234567")).toBe(true);
    expect(isMobile("03-1234567")).toBe(false);
    expect(isMobile("0521234")).toBe(false);
  });

  it("writes the one number to e164, display and WhatsApp", () => {
    expect(phoneFields("052-1234567")).toEqual({
      phone_e164: "+972521234567",
      phone_display: "052-123-4567",
      whatsapp: "972521234567",
    });
  });
});

describe("the licensee's wording", () => {
  it("pre-fills the licence line from the name and the title", () => {
    expect(defaultLicenceEntity("רחל לוי", "סוכנת ביטוח")).toBe("רחל לוי — סוכנת ביטוח");
    expect(defaultLicenceEntity("רחל לוי", "")).toBe("רחל לוי");
  });

  it("opens the visitor's WhatsApp message with the first name", () => {
    expect(defaultWhatsappMessage("רחל לוי")).toBe("שלום רחל, אשמח/ה לשמוע פרטים נוספים על תכנון פיננסי וביטוחי.");
  });

  it("builds the disclosure sentences in the licensee's grammatical gender", () => {
    const f = disclosurePreview({ entity: "רחל לוי", gender: "f", regulator: "רשות שוק ההון, ביטוח וחיסכון", number: "L-12345", affiliated: true, displayName: "רחל לוי" });
    expect(f.licence).toBe("רחל לוי בעלת רישיון סוכן מרשות שוק ההון, ביטוח וחיסכון מס' L-12345, ולה זיקה לגופים מוסדיים. הפעילות היא שיווק פנסיוני ולא ייעוץ פנסיוני אובייקטיבי.");
    expect(f.bot).toBe("זהו עוזר אוטומטי (בינה מלאכותית) של רחל לוי — לא רחל לוי עצמה ולא בעלת רישיון.");
    const m = disclosurePreview({ entity: "דן כהן", gender: "m", regulator: "רשות שוק ההון, ביטוח וחיסכון", number: "L-1", affiliated: false, displayName: "דן כהן" });
    expect(m.licence).toBe("דן כהן בעל רישיון סוכן מרשות שוק ההון, ביטוח וחיסכון מס' L-1, ואין לו זיקה לגופים מוסדיים.");
    expect(m.bot).toBe("זהו עוזר אוטומטי (בינה מלאכותית) של דן כהן — לא דן כהן עצמו ולא בעל רישיון.");
  });

  it("matches Dorit's live disclosure word for word", async () => {
    const { PENSION_MARKETING_DISCLOSURE, LICENCE } = await import("@/config/compliance");
    const d = disclosurePreview({ entity: LICENCE.entity, gender: "f", regulator: LICENCE.regulator, number: LICENCE.number, affiliated: true, displayName: "דורית גוב ארי" });
    expect(d.licence).toBe(PENSION_MARKETING_DISCLOSURE);
  });
});

describe("stepPatches — a step writes only what it changed", async () => {
  const { stepPatches, fieldProblem } = await import("@/lib/onboarding-draft");

  it("writes changed columns, and a jsonb path's whole object", () => {
    const saved = complete();
    let draft = setField(saved, "agents.bio.headline", "חדש");
    draft = setField(draft, "agency_profiles.email", "new@example.com");
    const p = stepPatches(["agents.bio.headline", "agents.bio.career", "agency_profiles.email", "agency_profiles.service_area"], draft, saved);
    expect(p.agency_profiles).toEqual({ email: "new@example.com" });
    expect(p.agents).toEqual({ bio: { headline: "חדש", career: "15 שנה בתחום" } });
  });

  it("writes nothing when nothing changed, and never the operator's agencies row", () => {
    const saved = complete();
    const draft = setField(saved, "agencies.name", "שם אחר");
    expect(stepPatches(["agencies.name", "agents.full_name"], draft, saved)).toEqual({ agency_profiles: {}, agents: {} });
  });

  it("refuses badly formed addresses and links, and lets empty ones wait for the checklist", () => {
    expect(fieldProblem("agency_profiles.email", "not-an-email")).toBe("כתובת הדוא״ל אינה תקינה.");
    expect(fieldProblem("agency_profiles.email", "")).toBeNull();
    expect(fieldProblem("agency_profiles.notify_emails", ["a@b.co", "bad"])).toBe("הכתובת bad אינה תקינה.");
    expect(fieldProblem("agents.booking_url", "http://cal.com/x")).toBe("הקישור צריך להתחיל ב-https://");
    expect(fieldProblem("agents.review_links", { google: "https://g.page/x" })).toBeNull();
    expect(fieldProblem("agents.review_links", { midrag: "midrag.co.il/x" })).toBe("הקישורים צריכים להתחיל ב-https://");
  });
});
