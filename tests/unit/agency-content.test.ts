import { describe, expect, it } from "vitest";
import he from "../../src/i18n/locales/he/home.json";
import { agency1ContentRows } from "../../e2e/fixtures/agency1-seed";
import { AGENCY1_ID, AGENCY1_REVIEW_LINKS } from "@/config/agency1";
import { isAgencyContentOn } from "@/config/agency-content";
import { CONTACT } from "@/config/contact";
import { CAL_LINK } from "@/config/offers";
import {
  bundledAgencyContent,
  bundledSuccessCases,
  resolveAgencyContent,
  siteHost,
  type AgencyContent,
} from "@/lib/agency-content";
import { toSiteRecord } from "@/services/supabase/SupabaseAgencyContentService";
import type { AgencySiteRecord } from "@/services/ports";

const heT = (k: string): string => (he as Record<string, string>)[k];
const BASE = "https://p.supabase.co/storage/v1/object/public/agent-photos/";
const AGENCY_F = "ffffffff-0000-0000-0000-00000000000f";

function seededRecord(): AgencySiteRecord {
  const rows = agency1ContentRows();
  return toSiteRecord(rows.get("public_agency_sites")![0], rows.get("public_agent_cards")![0]);
}

const otherAgency = (): AgencySiteRecord => ({
  agencyId: AGENCY_F,
  contact: {
    phoneE164: "+972500000000",
    phoneDisplay: "050-000-0000",
    whatsapp: "972500000000",
    email: "yael@example.test",
    defaultWhatsappMessage: "שלום",
  },
  agent: {
    fullName: "יעל כהן",
    professionalTitle: null,
    photoPath: null,
    photoAlt: null,
    licenceNumber: "L-1",
    bio: { headline: "כותרת" },
    stats: [],
    bookingUrl: null,
    reviewLinks: { google: "https://g.example/yael" },
  },
});

describe("isAgencyContentOn", () => {
  it("UNIT-AGC-001: on only for exactly \"true\", like isStaffLeadsOn", () => {
    expect(isAgencyContentOn("true")).toBe(true);
    expect(isAgencyContentOn(" true ")).toBe(true);
    for (const v of ["", undefined, "1", "TRUE ", "false", "yes"]) expect(isAgencyContentOn(v)).toBe(false);
  });
});

describe("siteHost", () => {
  it("UNIT-AGC-002: normalizes the host and drops one leading www.", () => {
    expect(siteHost("WWW.Govari-Fin.co.il.")).toBe("govari-fin.co.il");
    expect(siteHost("localhost")).toBe("localhost");
    expect(siteHost("www.www.x.co")).toBe("www.x.co");
    expect(siteHost("")).toBe("");
  });
});

describe("bundledAgencyContent", () => {
  it("UNIT-AGC-003: is agency 1 as the site shows it today", () => {
    const c = bundledAgencyContent(heT);
    expect(c.agencyId).toBe(AGENCY1_ID);
    expect(c.source).toBe("bundled");
    expect(c.contact).toEqual(CONTACT);
    expect(c.agent.byline).toBe(he["hero.byline"]);
    expect(c.agent.licenceNumber).toBe("L-00107009");
    expect(c.agent.portrait).toEqual({ kind: "bundled", alt: he["hero.portraitAlt"] });
    expect(c.agent.bio.headline).toBe(he["hero.lead"]);
    expect(c.agent.bio.insight).toBe(he["about.insight"]);
    expect(c.agent.stats).toHaveLength(3);
    expect(c.agent.stats[0]).toEqual({ num: "30", label: "שנות ניסיון" });
    expect(c.agent.bookingUrl).toBe(CAL_LINK);
    expect(c.agent.reviewLinks).toEqual(AGENCY1_REVIEW_LINKS);
  });
});

describe("bundledSuccessCases", () => {
  it("UNIT-AGC-004: are the seven proof cases, c2 an estimate", () => {
    const cases = bundledSuccessCases(heT);
    expect(cases).toHaveLength(7);
    expect(cases[1].estimate).toBe(true);
    expect(cases[0].tag).toBe(he["proof.c1.tag"]);
    expect(cases[0]).toEqual({
      tag: he["proof.c1.tag"],
      title: he["proof.c1.title"],
      body: he["proof.c1.body"],
      metric: he["proof.c1.metric"],
      estimate: false,
    });
  });
});

describe("resolveAgencyContent", () => {
  it("UNIT-AGC-005: the seeded record resolves to exactly the bundled content (R9, object level)", () => {
    const bundled = bundledAgencyContent(heT);
    const resolved = resolveAgencyContent(seededRecord(), bundled, BASE);
    expect(resolved.source).toBe("database");
    expect({ ...resolved, source: "bundled" }).toEqual(bundled);
  });

  it("UNIT-AGC-006: another agency without a booking link does not borrow agency 1's", () => {
    const bundled: AgencyContent = bundledAgencyContent(heT);
    const withCal = { ...bundled, agent: { ...bundled.agent, bookingUrl: "https://cal.com/dorit/15min" } };
    const c = resolveAgencyContent(otherAgency(), withCal, BASE);
    expect(c.agencyId).toBe(AGENCY_F);
    expect(c.agent.bookingUrl).toBeNull();
    expect(c.agent.portrait).toEqual({ kind: "monogram", initials: "יכ", alt: "יעל כהן — דיוקן מקצועי" });
  });

  it("UNIT-AGC-007: no professional title → the byline is the name; a missing review link is null", () => {
    const c = resolveAgencyContent(otherAgency(), bundledAgencyContent(heT), BASE);
    expect(c.agent.byline).toBe("יעל כהן");
    expect(c.agent.reviewLinks).toEqual({ google: "https://g.example/yael", midrag: null });
  });

  it("UNIT-AGC-008: lets no undefined out — missing bio texts are null", () => {
    const c = resolveAgencyContent(otherAgency(), bundledAgencyContent(heT), null);
    expect(c.agent.bio).toEqual({
      headline: "כותרת",
      family: null,
      credentials: null,
      career: null,
      insight: null,
      unique: null,
      signature: null,
    });
    const walk = (v: unknown): void => {
      expect(v).not.toBeUndefined();
      if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
    };
    walk(c);
  });
});
