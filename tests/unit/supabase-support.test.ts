import { describe, expect, it, vi } from "vitest";
import { SupabaseSupportService } from "@/services/supabase/SupabaseSupportService";
import { escalationBody } from "@/services/lead-bodies";

const request = { reason: "complex_case", summary: "רוצה לדבר עם דורית", name: "דנה", phone: "0501234567" };

describe("SupabaseSupportService", () => {
  it("hands off through escalate-to-human with the body Base44 would have had", async () => {
    const receipt = { ok: true, contact: { phoneDisplay: "050" }, acknowledgement: "x", warnings: [] };
    const invoke = vi.fn().mockResolvedValue({ data: receipt, error: null });
    const svc = new SupabaseSupportService({ functions: { invoke } });
    expect(await svc.escalate(request)).toEqual(receipt);
    expect(invoke).toHaveBeenCalledWith("escalate-to-human", { body: escalationBody(request) });
  });

  it("never rejects: a failure becomes the direct channels, as the Base44 adapter does", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { message: "down" } });
    const out = await new SupabaseSupportService({ functions: { invoke } }).escalate(request);
    expect(out.ok).toBe(false);
    expect(out.contact).toBeTruthy();
    expect(out.warnings).toContain("escalation_call_failed");
  });
});
