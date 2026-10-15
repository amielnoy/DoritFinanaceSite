import { describe, expect, it, vi } from "vitest";
import { SupabaseAgencyService, type SupabaseAgencyClient } from "../../src/services/supabase/SupabaseAgencyService";
import { SupabaseUsersAdminService } from "../../src/services/supabase/SupabaseUsersAdminService";
import { tableFake } from "../helpers/supabase-table-fake";

/* Who the signed-in person is in their agencies, and the members screen's changes (agency roles). */

const A1 = "00000000-0000-0000-0000-000000000001";
const TRUST = "0abcfa0b-cc26-40f0-8971-54bd4d845139";

/** A client whose reads answer per table, with my_agency_role answering `role`. */
function client(tables: Record<string, unknown[]>, role: { data: unknown; error: { message: string } | null } = { data: null, error: null }, write = { data: [{ agency_id: A1 }] as unknown[] | null, error: null as { message: string } | null }) {
  const calls: unknown[][] = [];
  const rpc = vi.fn(async () => role);
  const c = {
    rpc,
    from(table: string) {
      const { client: fake, calls: inner } = tableFake({ data: tables[table] ?? [], error: null }, write);
      const t = fake.from(table);
      return {
        select: (cols: string) => (calls.push([table, "select", cols]), t.select(cols)),
        update: (values: Record<string, unknown>) => (calls.push([table, "update", values]), t.update(values)),
        delete: () => t.delete(),
        inner,
      };
    },
  };
  return { client: c as unknown as SupabaseAgencyClient, rpc, calls };
}

describe("SupabaseAgencyService", () => {
  it("lists the person's agencies with their roles, leaving out what they cannot read or do not know", async () => {
    const { client: c } = client({
      memberships: [
        { agency_id: TRUST, role: "owner" },
        { agency_id: A1, role: "user" },
        { agency_id: "suspended", role: "admin" },
        { agency_id: A1, role: "staff" },
      ],
      agencies: [{ id: A1, name: "דורית גוב ארי" }, { id: TRUST, name: "Trust" }],
    });
    const mine = await new SupabaseAgencyService(c).myAgencies("me");
    expect(mine).toHaveLength(2);
    expect(mine).toEqual(expect.arrayContaining([
      { id: TRUST, name: "Trust", role: "owner" },
      { id: A1, name: "דורית גוב ארי", role: "user" },
    ]));
  });

  it("asks my_agency_role for one agency, and reads anything but the three roles as none", async () => {
    const owner = client({}, { data: "owner", error: null });
    expect(await new SupabaseAgencyService(owner.client).myRole(A1)).toBe("owner");
    expect(owner.rpc).toHaveBeenCalledWith("my_agency_role", { p_agency_id: A1 });
    for (const data of ["staff", "agent", null, 1]) {
      expect(await new SupabaseAgencyService(client({}, { data, error: null }).client).myRole(A1)).toBeNull();
    }
  });

  it("fails rather than guessing when the role cannot be read", async () => {
    await expect(new SupabaseAgencyService(client({}, { data: null, error: { message: "boom" } }).client).myRole(A1)).rejects.toThrow();
  });

  it("maps the profile's columns, and writes back only the fields given, by their column names", async () => {
    const { client: c, calls } = client({
      agency_profiles: [{
        agency_id: A1, display_name: "דורית", phone_e164: "+972508311776", phone_display: "050", whatsapp: "972",
        email: "d@x.co.il", default_whatsapp_message: "שלום", licence_entity: "ד", licence_number: "L-1", licence_regulator: "ר",
      }],
    });
    const service = new SupabaseAgencyService(c);
    expect(await service.profile(A1)).toMatchObject({ agencyId: A1, displayName: "דורית", licenceNumber: "L-1" });
    await service.updateProfile(A1, { displayName: "חדש", licenceNumber: "L-2" });
    expect(calls).toContainEqual(["agency_profiles", "update", { display_name: "חדש", licence_number: "L-2" }]);
  });

  it("calls a save the policy filtered out an error — only the Owner may", async () => {
    const { client: c } = client({}, undefined, { data: [], error: null });
    await expect(new SupabaseAgencyService(c).updateProfile(A1, { displayName: "x" })).rejects.toThrow("רק בעלי הסוכנות");
  });
});

describe("SupabaseUsersAdminService — the members screen's changes", () => {
  const functions = () => {
    const invoke = vi.fn(async () => ({ data: { ok: true }, error: null }));
    return { client: { functions: { invoke } }, invoke };
  };
  const { client: table } = tableFake({ data: [], error: null });

  it.each([
    ["setRole", (s: SupabaseUsersAdminService) => s.setRole(A1, "u2", "admin"), { op: "setRole", agencyId: A1, userId: "u2", role: "admin" }],
    ["remove", (s: SupabaseUsersAdminService) => s.remove(A1, "u2"), { op: "remove", agencyId: A1, userId: "u2" }],
    ["leave", (s: SupabaseUsersAdminService) => s.leave(A1), { op: "leave", agencyId: A1 }],
    ["transferOwnership", (s: SupabaseUsersAdminService) => s.transferOwnership(A1, "u2"), { op: "transferOwnership", agencyId: A1, userId: "u2" }],
  ])("%s goes to member-admin as the person", async (_name, run, body) => {
    const f = functions();
    await run(new SupabaseUsersAdminService(table, f.client, async () => "session-token"));
    expect(f.invoke).toHaveBeenCalledWith("member-admin", { body, headers: { Authorization: "Bearer session-token" } });
  });

  it("says the function's refusal in its own words, and asks nothing without a session", async () => {
    const context = new Response(JSON.stringify({ error: "לארגון חייב להישאר בעלים אחד לפחות.", rid: "r" }), { status: 409 });
    const refusing = { functions: { invoke: vi.fn(async () => ({ data: null, error: { message: "non-2xx", context } })) } };
    await expect(new SupabaseUsersAdminService(table, refusing, async () => "t").leave(A1)).rejects.toThrow("בעלים אחד לפחות");
    const f = functions();
    await expect(new SupabaseUsersAdminService(table, f.client, async () => null).leave(A1)).rejects.toThrow("נדרשת התחברות");
    expect(f.invoke).not.toHaveBeenCalled();
  });
});
