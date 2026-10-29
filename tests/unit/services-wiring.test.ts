import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tableFake } from "../helpers/supabase-table-fake";

/**
 * Which adapter the composition root (`@/services/composition`) picks, with and
 * without a Supabase client.
 *
 * Each case re-imports the composition root under its own mock, because the
 * choice is made once, at module load.
 */
async function load(supabase: unknown) {
  vi.resetModules();
  vi.doMock("@/api/supabaseClient", () => ({ supabase }));
  // The composition root, not `@/services`: that is a lazy front which loads
  // this module on a port's first real call (see src/services/index.ts).
  const { services } = await import("@/services/composition");
  return {
    services,
    SupabaseContentService: (await import("@/services/supabase/SupabaseContentService")).SupabaseContentService,
    SupabaseLeadService: (await import("@/services/supabase/SupabaseLeadService")).SupabaseLeadService,
    SupabaseSupportService: (await import("@/services/supabase/SupabaseSupportService")).SupabaseSupportService,
    SupabaseImageUploadService: (await import("@/services/supabase/SupabaseImageUploadService")).SupabaseImageUploadService,
    SupabaseUploadService: (await import("@/services/supabase/SupabaseUploadService")).SupabaseUploadService,
    EdgeContentAdminService: (await import("@/services/supabase/EdgeContentAdminService")).EdgeContentAdminService,
    SupabaseLeadAdminService: (await import("@/services/supabase/SupabaseLeadAdminService")).SupabaseLeadAdminService,
    SupabaseAgentService: (await import("@/services/supabase/SupabaseAgentService")).SupabaseAgentService,
    SupabaseMaslekaService: (await import("@/services/supabase/SupabaseMaslekaService")).SupabaseMaslekaService,
    UnconfiguredContentService: (await import("@/services/unconfigured/UnconfiguredContentService")).UnconfiguredContentService,
    UnconfiguredLeadService: (await import("@/services/unconfigured/UnconfiguredLeadService")).UnconfiguredLeadService,
    UnconfiguredSupportService: (await import("@/services/unconfigured/UnconfiguredSupportService")).UnconfiguredSupportService,
    UnconfiguredUploadService: (await import("@/services/unconfigured/UnconfiguredUploadService")).UnconfiguredUploadService,
    UnconfiguredContentAdminService: (await import("@/services/unconfigured/UnconfiguredContentAdminService")).UnconfiguredContentAdminService,
    UnconfiguredLeadAdminService: (await import("@/services/unconfigured/UnconfiguredLeadAdminService")).UnconfiguredLeadAdminService,
    UnconfiguredAgentService: (await import("@/services/unconfigured/UnconfiguredAgentService")).UnconfiguredAgentService,
    UnconfiguredMaslekaService: (await import("@/services/unconfigured/UnconfiguredMaslekaService")).UnconfiguredMaslekaService,
    AgentUnavailableError: (await import("@/services/agent-errors")).AgentUnavailableError,
  };
}

/** A Supabase client with every surface the ports are built from at load time. */
const supabaseFake = () => {
  const fake = tableFake({ data: [], error: null });
  return {
    fake,
    client: {
      ...fake.client,
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      storage: { from: () => ({}) },
      rpc: vi.fn(async () => ({ data: [], error: null })),
      functions: { invoke: vi.fn(async () => ({ data: { ok: true }, error: null })) },
    },
  };
};

const LEAD = { name: "דנה", phone: "0501234567", source: "consultation" as const };
const NO_DATABASE = "אין חיבור למאגר.";

describe("composition root", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  describe("with a Supabase client", () => {
    it("wires every port to its Supabase adapter", async () => {
      const m = await load(supabaseFake().client);
      expect(m.services.content).toBeInstanceOf(m.SupabaseContentService);
      expect(m.services.leads).toBeInstanceOf(m.SupabaseLeadService);
      expect(m.services.support).toBeInstanceOf(m.SupabaseSupportService);
      expect(m.services.uploads).toBeInstanceOf(m.SupabaseImageUploadService);
      expect(m.services.claimDocuments).toBeInstanceOf(m.SupabaseUploadService);
      expect(m.services.contentAdmin).toBeInstanceOf(m.EdgeContentAdminService);
      expect(m.services.leadsAdmin).toBeInstanceOf(m.SupabaseLeadAdminService);
      expect(m.services.agents).toBeInstanceOf(m.SupabaseAgentService);
    });

    it("sends a lead to submit-lead, which fills in interviews", async () => {
      const supabase = supabaseFake().client;
      const m = await load(supabase);
      await m.services.leads.submitLead(LEAD);
      expect(supabase.functions.invoke).toHaveBeenCalledWith("submit-lead", expect.anything());
      expect(m.services.leads.updatesInterviews).toBe(true);
    });

    it("reads the admin's articles from the table, drafts included", async () => {
      const { fake, client } = supabaseFake();
      const m = await load(client);
      await m.services.contentAdmin.listArticles();
      expect(fake.calls).toContainEqual(["from", "blog_posts"]);
      expect(fake.calls.filter((c) => c[0] === "eq")).toEqual([]);
    });
  });

  describe("without one", () => {
    it("gives every port its stand-in", async () => {
      const m = await load(null);
      expect(m.services.content).toBeInstanceOf(m.UnconfiguredContentService);
      expect(m.services.leads).toBeInstanceOf(m.UnconfiguredLeadService);
      expect(m.services.support).toBeInstanceOf(m.UnconfiguredSupportService);
      expect(m.services.uploads).toBeInstanceOf(m.UnconfiguredUploadService);
      expect(m.services.claimDocuments).toBeInstanceOf(m.UnconfiguredUploadService);
      expect(m.services.contentAdmin).toBeInstanceOf(m.UnconfiguredContentAdminService);
      expect(m.services.leadsAdmin).toBeInstanceOf(m.UnconfiguredLeadAdminService);
      expect(m.services.agents).toBeInstanceOf(m.UnconfiguredAgentService);
      expect(m.services.masleka).toBeInstanceOf(m.UnconfiguredMaslekaService);
    });

    it("reads nothing and refuses every write", async () => {
      const { services } = await load(null);
      await expect(services.leads.submitLead(LEAD)).rejects.toThrow(NO_DATABASE);
      await expect(services.leads.submitClaim({ name: "a", phone: "050" })).rejects.toThrow(NO_DATABASE);
      await expect(services.leads.submitInterview({ name: "a", phone: "050" })).rejects.toThrow(NO_DATABASE);
      expect(services.leads.updatesInterviews).toBeFalsy();
      await expect(services.content.listArticles()).resolves.toEqual([]);
      await expect(services.content.listTestimonials()).resolves.toEqual([]);
      await expect(services.content.getArticle("a-slug")).rejects.toMatchObject({ status: 404 });
      await expect(services.uploads.upload(new File(["x"], "a.png"))).rejects.toThrow(NO_DATABASE);
      await expect(services.claimDocuments.upload(new File(["x"], "a.pdf"))).rejects.toThrow(NO_DATABASE);
      await expect(services.contentAdmin.listArticles()).resolves.toEqual([]);
      await expect(services.contentAdmin.listTestimonials()).resolves.toEqual([]);
      await expect(services.contentAdmin.createArticle({ title: "t", body: "b", published: false })).rejects.toThrow(NO_DATABASE);
      await expect(services.contentAdmin.removeTestimonial("t1")).rejects.toThrow(NO_DATABASE);
    });

    it("still hands a visitor who asked for a person the direct channels", async () => {
      const { services } = await load(null);
      const receipt = await services.support.escalate({ reason: "user_request", summary: "רוצה לדבר עם דורית" });
      expect(receipt.ok).toBe(false);
      expect(receipt.contact.phoneE164).toBeTruthy();
    });

    it("answers the admin's lead screens empty and refuses their writes", async () => {
      const { services } = await load(null);
      const admin = services.leadsAdmin;
      await expect(admin.list()).resolves.toEqual([]);
      await expect(admin.leadEvents("l1")).resolves.toEqual([]);
      await expect(admin.briefing("l1")).resolves.toBeNull();
      await expect(admin.transcript("l1")).resolves.toEqual([]);
      await expect(admin.transcriptLeadIds()).resolves.toEqual([]);
      await expect(admin.meetings("l1")).resolves.toEqual([]);
      await expect(admin.agencyMeetings("a1")).resolves.toEqual([]);
      await expect(admin.countNew()).resolves.toBe(0);
      await expect(admin.countUnassigned()).resolves.toBe(0);
      await expect(admin.countOpenMeetingRequests()).resolves.toBe(0);
      await expect(admin.setStatus("l1", "contacted")).rejects.toThrow(NO_DATABASE);
      await expect(admin.remove("l1")).rejects.toThrow(NO_DATABASE);
      await expect(admin.mergeLeads("l1", ["l2"])).rejects.toThrow(NO_DATABASE);
      await expect(admin.addLeadNote("l1", "note")).rejects.toThrow(NO_DATABASE);
      await expect(admin.generateBriefing("l1")).rejects.toThrow(NO_DATABASE);
      await expect(admin.assign("l1", null)).rejects.toThrow(NO_DATABASE);
      await expect(admin.documentLink("ref", "l1")).rejects.toThrow(NO_DATABASE);
      await expect(admin.handleMeetingRequest("r1")).rejects.toThrow(NO_DATABASE);
    });

    it("tells the chat panel the agent is unavailable", async () => {
      const m = await load(null);
      await expect(m.services.agents.start("needs_interview")).rejects.toBeInstanceOf(m.AgentUnavailableError);
      await expect(m.services.agents.send({ id: "c1" }, "היי")).rejects.toBeInstanceOf(m.AgentUnavailableError);
      expect(() => m.services.agents.subscribe("c1", () => undefined)()).not.toThrow();
    });

    it("keeps the Supabase-only ports on their stand-ins", async () => {
      const { services } = await load(null);
      await expect(services.campaigns.list("a1")).resolves.toEqual([]);
      await expect(services.campaigns.create({ agencyId: "a1", name: "n", message: "m" })).rejects.toThrow(NO_DATABASE);
      await expect(services.onboarding.listInProgress()).resolves.toEqual([]);
      await expect(services.onboarding.role("a1")).resolves.toBeNull();
      await expect(services.onboarding.load("a1")).rejects.toThrow(NO_DATABASE);
      await expect(services.agencyContent.siteContent("example.co.il")).rejects.toMatchObject({ name: "AgencyContentError" });
      await expect(services.agencyContent.successCases("a1")).rejects.toMatchObject({ name: "AgencyContentError" });
    });
  });

  const maslekaSupabase = () => ({
    ...supabaseFake().client,
    rpc: vi.fn(async () => ({ data: "staff", error: null })),
  });

  it("uses the Supabase clearinghouse adapter only when the switch is on and a client exists", async () => {
    vi.stubEnv("VITE_MASLEKA_ENABLED", "true");
    const m = await load(maslekaSupabase());
    expect(m.services.masleka).toBeInstanceOf(m.SupabaseMaslekaService);
  });

  it("ships dark: with the switch off and a client, no masleka-* function or staff RPC is ever called", async () => {
    vi.stubEnv("VITE_MASLEKA_ENABLED", "");
    const supabase = maslekaSupabase();
    const m = await load(supabase);
    expect(m.services.masleka).toBeInstanceOf(m.UnconfiguredMaslekaService);
    const port = m.services.masleka;
    await port.submitCode("t", "c", "i").catch(() => {});
    await port.list().catch(() => {});
    await port.create({ clientName: "x", sendInvite: false }).catch(() => {});
    await port.relink("r").catch(() => {});
    await port.reveal("r", "code").catch(() => {});
    await port.markSubmitted("r").catch(() => {});
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
