import { beforeEach, describe, expect, it, vi } from "vitest";
import { tableFake } from "../helpers/supabase-table-fake";

/**
 * Which adapter the composition root picks, with and without a Supabase client.
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
  const { services } = await import("@/services");
  return {
    services,
    SupabaseContentService: (await import("@/services/supabase/SupabaseContentService")).SupabaseContentService,
    SupabaseLeadAdminService: (await import("@/services/supabase/SupabaseLeadAdminService")).SupabaseLeadAdminService,
    Base44ContentService: (await import("@/services/base44/Base44ContentService")).Base44ContentService,
    Base44LeadAdminService: (await import("@/services/base44/Base44LeadAdminService")).Base44LeadAdminService,
  };
}

describe("composition root", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reads content and leads from Supabase when a client is configured", async () => {
    const fake = tableFake({ data: [], error: null });
    // Only `from` is exercised; `auth` and `storage` are there because other
    // ports are built from the same client at load time.
    const supabase = {
      ...fake.client,
      auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      storage: { from: () => ({}) },
      rpc: async () => ({ data: [], error: null }),
    };
    const m = await load(supabase, base44Fake().client);
    expect(m.services.content).toBeInstanceOf(m.SupabaseContentService);
    expect(m.services.leadsAdmin).toBeInstanceOf(m.SupabaseLeadAdminService);

    await m.services.contentAdmin.listArticles();
    expect(fake.calls).toContainEqual(["from", "blog_posts"]);
    expect(fake.calls.filter((c) => c[0] === "eq")).toEqual([]); // admin list: drafts included
  });

  it("falls back to Base44 when Supabase is not configured", async () => {
    const b = base44Fake();
    const m = await load(null, b.client);
    expect(m.services.content).toBeInstanceOf(m.Base44ContentService);
    expect(m.services.leadsAdmin).toBeInstanceOf(m.Base44LeadAdminService);

    await m.services.contentAdmin.listArticles();
    expect(b.blogList).toHaveBeenCalled();
  });
});
