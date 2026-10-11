import { describe, expect, it, vi } from "vitest";
import { SupabaseLeadAdminService } from "@/services/supabase/SupabaseLeadAdminService";
import { tableFake } from "../helpers/supabase-table-fake";

const leadRow = (over: Record<string, unknown> = {}) => ({
  id: "6f1c0e3a-0000-4000-8000-0000000000aa",
  base44_id: "b44-lead-1",
  name: "דנה",
  phone: "050-0000000",
  email: null,
  source: "consultation",
  topic: "פנסיה",
  timing: null,
  message: null,
  status: "new",
  created_at: "2026-10-10T08:00:00+00:00",
  ...over,
});

const writes = () => ({ setStatus: vi.fn(async () => {}), remove: vi.fn(async () => {}) });

describe("SupabaseLeadAdminService.list", () => {
  it("reads leads newest first, up to 500 by default", async () => {
    const { client, calls } = tableFake({ data: [], error: null });
    await new SupabaseLeadAdminService(client, writes()).list();
    expect(calls[0]).toEqual(["from", "leads"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 500]);
  });

  it("asks for the port's columns only, not the whole row", async () => {
    const { client, calls } = tableFake({ data: [], error: null });
    await new SupabaseLeadAdminService(client, writes()).list();
    const select = calls.find((c) => c[0] === "select")!;
    expect(select[1]).not.toBe("*");
    expect(String(select[1]).split(",")).toEqual(
      expect.arrayContaining(["base44_id", "name", "phone", "status", "created_at"]),
    );
  });

  it("returns leads under their Base44 id, which is what adminLead acts on", async () => {
    const { client } = tableFake({ data: [leadRow()], error: null });
    const [lead] = await new SupabaseLeadAdminService(client, writes()).list();
    expect(lead).toMatchObject({ id: "b44-lead-1", name: "דנה", status: "new", created_date: "2026-10-10T08:00:00+00:00" });
    expect(lead).not.toHaveProperty("email");
  });

  it("still lists a lead that has no Base44 id, rather than dropping someone's enquiry", async () => {
    const { client } = tableFake({ data: [leadRow({ base44_id: null })], error: null });
    const leads = await new SupabaseLeadAdminService(client, writes()).list();
    expect(leads).toHaveLength(1);
    expect(leads[0].id).toBe("6f1c0e3a-0000-4000-8000-0000000000aa");
  });

  it("throws on a failed read rather than showing an empty inbox", async () => {
    const { client } = tableFake({ data: null, error: { message: "permission denied for table leads", code: "42501" } });
    await expect(new SupabaseLeadAdminService(client, writes()).list()).rejects.toThrow(/leads read failed/);
  });
});

describe("SupabaseLeadAdminService writes", () => {
  it("hands setStatus to the adminLead-backed writer unchanged", async () => {
    const w = writes();
    await new SupabaseLeadAdminService(tableFake({ data: [], error: null }).client, w).setStatus("b44-lead-1", "contacted");
    expect(w.setStatus).toHaveBeenCalledWith("b44-lead-1", "contacted");
  });

  it("hands remove to the adminLead-backed writer unchanged", async () => {
    const w = writes();
    await new SupabaseLeadAdminService(tableFake({ data: [], error: null }).client, w).remove("b44-lead-1");
    expect(w.remove).toHaveBeenCalledWith("b44-lead-1");
  });

  it("lets a refused write fail the call", async () => {
    const w = { setStatus: vi.fn(async () => { throw new Error("adminLead did not confirm the write"); }), remove: vi.fn() };
    const service = new SupabaseLeadAdminService(tableFake({ data: [], error: null }).client, w);
    await expect(service.setStatus("x", "closed")).rejects.toThrow("adminLead did not confirm the write");
  });
});
