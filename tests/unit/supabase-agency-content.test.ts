import { describe, expect, it } from "vitest";
import { AGENCY1_ID } from "@/config/agency1";
import {
  CARD_COLUMNS,
  SITE_COLUMNS,
  SUCCESS_CASE_COLUMNS,
} from "@/services/supabase/agency-content-tables";
import {
  AgencyContentError,
  HOST_PATTERN,
  SupabaseAgencyContentService,
} from "@/services/supabase/SupabaseAgencyContentService";
import type { SupabaseReadResult, SupabaseTableClient } from "@/services/supabase/SupabaseTableClient";
import { tableFake, type Call } from "../helpers/supabase-table-fake";

const AGENCY_F = "ffffffff-0000-0000-0000-00000000000f";
const ok = (data: unknown[]): SupabaseReadResult => ({ data, error: null });

const siteRow = (over: Record<string, unknown> = {}) => ({
  agency_id: AGENCY1_ID,
  domain: "govari-fin.co.il",
  display_name: "דורית גוב ארי",
  phone_e164: "+972508311776",
  phone_display: "050-831-1776",
  whatsapp: "972508311776",
  email: "dorit@govari-fin.co.il",
  default_whatsapp_message: "שלום דורית",
  ...over,
});

const cardRow = (over: Record<string, unknown> = {}) => ({
  id: "00000000-0000-0000-0000-0000000000a1",
  agency_id: AGENCY1_ID,
  full_name: "דורית גוב ארי",
  professional_title: "מתכננת פיננסית וסוכנת ביטוח",
  photo_path: null,
  photo_alt: "דורית גוב ארי — דיוקן מקצועי",
  licence_number: "L-00107009",
  bio: { headline: "כותרת", insight: "תובנה" },
  stats: [{ num: "30", label: "שנות ניסיון" }],
  booking_url: null,
  review_links: { google: "https://g.example/d", midrag: "https://www.midrag.co.il/" },
  ...over,
});

/** One table fake per table, behind one `from(table)`; each table's calls recorded apart. */
function tables(answers: Record<string, SupabaseReadResult>) {
  const fakes = Object.fromEntries(Object.entries(answers).map(([t, r]) => [t, tableFake(r)]));
  const client: SupabaseTableClient = {
    from(table) {
      const fake = fakes[table];
      if (!fake) throw new Error(`unexpected table ${table}`);
      return fake.client.from(table);
    },
  };
  const calls = (table: string): Call[] => fakes[table]?.calls ?? [];
  return { service: new SupabaseAgencyContentService(client), calls };
}

const errorCode = (p: Promise<unknown>) => p.then(() => "resolved", (e: unknown) => (e instanceof AgencyContentError ? e.code : e));

describe("SupabaseAgencyContentService.siteContent", () => {
  it("UNIT-AGC-009: a known host asks for its domain or agency 1, then the agency's first agent", async () => {
    const { service, calls } = tables({ public_agency_sites: ok([siteRow()]), public_agent_cards: ok([cardRow()]) });
    const record = await service.siteContent("govari-fin.co.il");
    expect(calls("public_agency_sites")).toEqual([
      ["from", "public_agency_sites"],
      ["select", SITE_COLUMNS],
      ["or", `domain.eq.govari-fin.co.il,agency_id.eq.${AGENCY1_ID}`],
      ["limit", 2],
    ]);
    expect(calls("public_agent_cards")).toEqual([
      ["from", "public_agent_cards"],
      ["select", CARD_COLUMNS],
      ["eq", "agency_id", AGENCY1_ID],
      ["order", "id", { ascending: true }],
      ["limit", 1],
    ]);
    expect(record.agencyId).toBe(AGENCY1_ID);
    expect(record.contact).toEqual({
      phoneE164: "+972508311776",
      phoneDisplay: "050-831-1776",
      whatsapp: "972508311776",
      email: "dorit@govari-fin.co.il",
      defaultWhatsappMessage: "שלום דורית",
    });
    expect(record.agent).toEqual({
      fullName: "דורית גוב ארי",
      professionalTitle: "מתכננת פיננסית וסוכנת ביטוח",
      photoPath: null,
      photoAlt: "דורית גוב ארי — דיוקן מקצועי",
      licenceNumber: "L-00107009",
      bio: { headline: "כותרת", insight: "תובנה" },
      stats: [{ num: "30", label: "שנות ניסיון" }],
      bookingUrl: null,
      reviewLinks: { google: "https://g.example/d", midrag: "https://www.midrag.co.il/" },
    });
  });

  it("UNIT-AGC-010: the agency that claims the host wins over the agency-1 fallback", async () => {
    const { service, calls } = tables({
      public_agency_sites: ok([siteRow(), siteRow({ agency_id: AGENCY_F, domain: "yael.example.co.il" })]),
      public_agent_cards: ok([cardRow({ agency_id: AGENCY_F })]),
    });
    const record = await service.siteContent("yael.example.co.il");
    expect(record.agencyId).toBe(AGENCY_F);
    expect(calls("public_agent_cards")).toContainEqual(["eq", "agency_id", AGENCY_F]);
  });

  it("UNIT-AGC-011: an unknown host gets agency 1", async () => {
    const { service } = tables({ public_agency_sites: ok([siteRow()]), public_agent_cards: ok([cardRow()]) });
    expect((await service.siteContent("preview-abc.vercel.app")).agencyId).toBe(AGENCY1_ID);
  });

  it.each(["x),agency_id.eq.ffffffff-0000-0000-0000-00000000000f", "", "Govari-Fin.co.il", "a b", "a,b"])(
    "UNIT-AGC-012: the hostile or malformed host %j is never put in the filter",
    async (host) => {
      expect(HOST_PATTERN.test(host)).toBe(false);
      const { service, calls } = tables({ public_agency_sites: ok([siteRow()]), public_agent_cards: ok([cardRow()]) });
      await service.siteContent(host);
      expect(calls("public_agency_sites")).toContainEqual(["or", `agency_id.eq.${AGENCY1_ID}`]);
      expect(calls("public_agency_sites").filter(([m]) => m === "or")).toHaveLength(1);
    },
  );

  it("UNIT-AGC-013: no site, no agent, incomplete rows and failed reads each fail loudly", async () => {
    const run = (site: SupabaseReadResult, card: SupabaseReadResult = ok([cardRow()])) =>
      errorCode(tables({ public_agency_sites: site, public_agent_cards: card }).service.siteContent("govari-fin.co.il"));

    expect(await run(ok([]))).toBe("no_site");
    expect(await run(ok([siteRow({ agency_id: AGENCY_F, domain: "other.co.il" })]))).toBe("no_site");
    expect(await run(ok([siteRow()]), ok([]))).toBe("no_agent");
    for (const column of ["phone_e164", "email", "whatsapp"]) {
      expect(await run(ok([siteRow({ [column]: null })]))).toBe("incomplete");
    }
    expect(await run(ok([siteRow()]), ok([cardRow({ bio: { insight: "רק תובנה" } })]))).toBe("incomplete");
    expect(await run(ok([siteRow()]), ok([cardRow({ bio: null })]))).toBe("incomplete");
    expect(await run(ok([siteRow()]), ok([cardRow({ licence_number: null })]))).toBe("incomplete");

    const siteFailure = await run({ data: null, error: { message: "boom" } });
    expect(siteFailure).toBeInstanceOf(Error);
    expect(siteFailure).not.toBeInstanceOf(AgencyContentError);
    expect((siteFailure as Error).message).toMatch(/public_agency_sites read failed: boom/);
    const cardFailure = await run(ok([siteRow()]), { data: null, error: { message: "nope" } });
    expect((cardFailure as Error).message).toMatch(/public_agent_cards read failed: nope/);
  });

  it("UNIT-AGC-014: stats must be {num,label} strings; a review link must be https", async () => {
    const run = (card: Record<string, unknown>) =>
      tables({ public_agency_sites: ok([siteRow()]), public_agent_cards: ok([cardRow(card)]) }).service.siteContent(
        "govari-fin.co.il",
      );
    for (const stats of [null, {}, [{ num: 30, label: "שנים" }], [{ num: "30" }], ["30"]]) {
      expect(await errorCode(run({ stats }))).toBe("incomplete");
    }
    const record = await run({
      review_links: { google: "javascript:alert(1)", midrag: "https://www.midrag.co.il/x" },
      booking_url: "http://cal.com/x",
      bio: { headline: "כותרת", family: 7, career: "קריירה" },
    });
    expect(record.agent.reviewLinks).toEqual({ midrag: "https://www.midrag.co.il/x" });
    expect(record.agent.bookingUrl).toBeNull();
    expect(record.agent.bio).toEqual({ headline: "כותרת", career: "קריירה" });
  });
});

describe("SupabaseAgencyContentService.successCases", () => {
  it("UNIT-AGC-015: reads the agency's published cases in order and maps the estimate flag", async () => {
    const row = {
      id: "00000000-0000-0000-0000-0000000005c2",
      tag: "תכנון פנסיה",
      title: "כותרת",
      body: "גוף",
      metric: "פי 2 בתחזית",
      metric_is_estimate: true,
      sort_order: 2,
    };
    const { service, calls } = tables({ success_cases: ok([row, { ...row, tag: null, metric: null, metric_is_estimate: false }]) });
    const cases = await service.successCases(AGENCY_F);
    expect(calls("success_cases")).toEqual([
      ["from", "success_cases"],
      ["select", SUCCESS_CASE_COLUMNS],
      ["eq", "agency_id", AGENCY_F],
      ["eq", "published", true],
      ["order", "sort_order", { ascending: true }],
      ["limit", 20],
    ]);
    expect(cases).toEqual([
      { tag: "תכנון פנסיה", title: "כותרת", body: "גוף", metric: "פי 2 בתחזית", estimate: true },
      { tag: null, title: "כותרת", body: "גוף", metric: null, estimate: false },
    ]);
  });

  it("UNIT-AGC-015b: a failed read is rethrown, a case without a title is incomplete", async () => {
    const failed = tables({ success_cases: { data: null, error: { message: "boom" } } });
    await expect(failed.service.successCases(AGENCY_F)).rejects.toThrow(/success_cases read failed/);
    const broken = tables({ success_cases: ok([{ id: "x", title: null, body: "b", metric_is_estimate: false }]) });
    expect(await errorCode(broken.service.successCases(AGENCY_F))).toBe("incomplete");
  });
});
