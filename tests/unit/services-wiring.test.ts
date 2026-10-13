import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tableFake } from "../helpers/supabase-table-fake";

/**
 * Which adapter the composition root (`@/services/composition`) picks, with and
 * without a Supabase client.
 *
 * Each case re-imports `@/services` under its own mocks, because the choice is
 * made once, at module load.
 */
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

const base44Fake = () => {
  const blogList = vi.fn(async () => []);
  const entities = new Proxy(
    {},
    { get: () => ({ list: blogList, filter: vi.fn(async () => []), get: vi.fn(async () => ({})) }) },
  );
  return { client: { entities, functions: { invoke: vi.fn(), fetch: vi.fn() } }, blogList };
};

async function load(supabase: unknown, base44: unknown) {
  vi.resetModules();
  vi.doMock("@/api/base44Client", () => ({ base44 }));
  vi.doMock("@/api/supabaseClient", () => ({ supabase }));
  // The composition root, not `@/services`: that is a lazy front which loads
  // this module on a port's first real call (see src/services/index.ts).
  const { services } = await import("@/services/composition");
  return {
    services,
    SupabaseContentService: (await import("@/services/supabase/SupabaseContentService")).SupabaseContentService,
    SupabaseLeadAdminService: (await import("@/services/supabase/SupabaseLeadAdminService")).SupabaseLeadAdminService,
    Base44ContentService: (await import("@/services/base44/Base44ContentService")).Base44ContentService,
    Base44LeadAdminService: (await import("@/services/base44/Base44LeadAdminService")).Base44LeadAdminService,
    SupabaseLeadService: (await import("@/services/supabase/SupabaseLeadService")).SupabaseLeadService,
    Base44LeadService: (await import("@/services/base44/Base44LeadService")).Base44LeadService,
    SupabaseMaslekaService: (await import("@/services/supabase/SupabaseMaslekaService")).SupabaseMaslekaService,
    UnconfiguredMaslekaService: (await import("@/services/unconfigured/UnconfiguredMaslekaService")).UnconfiguredMaslekaService,
  };
}

describe("composition root", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("reads content and leads from Supabase when a client is configured", async () => {
    const fake = tableFake({ data: [], error: null });
    // Only `from` is exercised; `auth` and `storage` are there because other
    // ports are built from the same client at load time.
    const supabase = {
      ...fake.client,
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      storage: { from: () => ({}) },
      rpc: async () => ({ data: [], error: null }),
      functions: { invoke: vi.fn() },
    };
    const m = await load(supabase, base44Fake().client);
    expect(m.services.content).toBeInstanceOf(m.SupabaseContentService);
    expect(m.services.leadsAdmin).toBeInstanceOf(m.SupabaseLeadAdminService);
    expect(m.services.leads).toBeInstanceOf(m.SupabaseLeadService);

    await m.services.contentAdmin.listArticles();
    expect(fake.calls).toContainEqual(["from", "blog_posts"]);
    expect(fake.calls.filter((c) => c[0] === "eq")).toEqual([]); // admin list: drafts included
  });

  it("falls back to Base44 when Supabase is not configured", async () => {
    const b = base44Fake();
    const m = await load(null, b.client);
    expect(m.services.content).toBeInstanceOf(m.Base44ContentService);
    expect(m.services.leadsAdmin).toBeInstanceOf(m.Base44LeadAdminService);
    expect(m.services.leads).toBeInstanceOf(m.Base44LeadService);
    expect(m.services.masleka).toBeInstanceOf(m.UnconfiguredMaslekaService);

    await m.services.contentAdmin.listArticles();
    expect(b.blogList).toHaveBeenCalled();
  });

  const maslekaSupabase = () => ({
    ...tableFake({ data: [], error: null }).client,
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    storage: { from: () => ({}) },
    rpc: vi.fn(async () => ({ data: "staff", error: null })),
    functions: { invoke: vi.fn(async () => ({ data: { ok: true }, error: null })) },
  });

  it("uses the Supabase clearinghouse adapter only when the switch is on and a client exists", async () => {
    vi.stubEnv("VITE_MASLEKA_ENABLED", "true");
    const m = await load(maslekaSupabase(), base44Fake().client);
    expect(m.services.masleka).toBeInstanceOf(m.SupabaseMaslekaService);
  });

  it("ships dark: with the switch off and a client, no masleka-* function or staff RPC is ever called", async () => {
    vi.stubEnv("VITE_MASLEKA_ENABLED", "");
    const supabase = maslekaSupabase();
    const m = await load(supabase, base44Fake().client);
    expect(m.services.masleka).toBeInstanceOf(m.UnconfiguredMaslekaService);
    const port = m.services.masleka;
    await port.submitCode("t", "c", "i").catch(() => {});
    await port.list().catch(() => {});
    await port.create({ clientName: "x", sendInvite: false }).catch(() => {});
    await port.relink("r").catch(() => {});
    await port.reveal("r", "code").catch(() => {});
    await port.markSubmitted("r").catch(() => {});
    expect(await port.myRole()).toBeNull();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
