import { describe, expect, it, vi } from "vitest";
import { SupabaseLeadService, type SupabaseFunctionsClient } from "@/services/supabase/SupabaseLeadService";
import type { LeadPort } from "@/services/ports";
import { leadBody } from "@/services/lead-bodies";

const report = { name: "רונית", phone: "0536667788", claimType: "תאונת דרכים", documents: ["https://x/a.pdf"] };

const rest = (): LeadPort => ({
  submitLead: vi.fn(async () => ({ ok: true, rid: "b44" })),
  submitClaim: vi.fn(async () => ({ ok: true })),
  requestConsultationEvent: vi.fn(async () => {}),
  submitInterview: vi.fn(async () => ({ ok: true, rid: "b44" })),
});

type InvokeResult = Awaited<ReturnType<SupabaseFunctionsClient["functions"]["invoke"]>>;

const functionsClient = (result: InvokeResult) => {
  const invoke = vi.fn(async () => result);
  return { client: { functions: { invoke } } as SupabaseFunctionsClient, invoke };
};

describe("SupabaseLeadService.submitClaim", () => {
  it("invokes submit-claim with the body the Base44 adapter sends, blanks filled", async () => {
    const { client, invoke } = functionsClient({ data: { ok: true, rid: "r1", leadId: "uuid-1", warnings: [] }, error: null });
    await new SupabaseLeadService(client, rest()).submitClaim(report);
    expect(invoke).toHaveBeenCalledWith("submit-claim", {
      body: {
        name: "רונית",
        phone: "0536667788",
        email: "",
        claimType: "תאונת דרכים",
        eventDate: "",
        policyNumber: "",
        description: "",
        documents: ["https://x/a.pdf"],
        channel: "",
        campaign: "",
        landingPath: "",
      },
    });
  });

  it("returns the function's receipt", async () => {
    const { client } = functionsClient({ data: { ok: true, rid: "r1", leadId: "uuid-1", warnings: [] }, error: null });
    await expect(new SupabaseLeadService(client, rest()).submitClaim(report)).resolves.toEqual({
      ok: true,
      rid: "r1",
      leadId: "uuid-1",
      warnings: [],
    });
  });

  it("throws on a refusal, carrying the function's message and rid", async () => {
    const context = new Response(
      JSON.stringify({ error: "לא הצלחנו לשמור את הדיווח. נסו שוב או צרו קשר ישירות.", rid: "ab12cd34" }),
      { status: 500 },
    );
    const { client } = functionsClient({ data: null, error: { message: "Edge Function returned a non-2xx status code", context } });
    await expect(new SupabaseLeadService(client, rest()).submitClaim(report)).rejects.toThrow(/לא הצלחנו לשמור.*rid ab12cd34/);
  });

  it("throws on a network failure, which has no response to read", async () => {
    const { client } = functionsClient({ data: null, error: { message: "Failed to send a request to the Edge Function" } });
    await expect(new SupabaseLeadService(client, rest()).submitClaim(report)).rejects.toThrow(/Failed to send a request/);
  });
});

describe("SupabaseLeadService — everything else stays on Base44", () => {
  it("passes submitLead, submitInterview and requestConsultationEvent to the Base44 adapter untouched", async () => {
    const r = rest();
    const { client, invoke } = functionsClient({ data: null, error: null });
    const service = new SupabaseLeadService(client, r);
    const lead = { name: "a", phone: "050" } as never;
    const summary = { name: "a", phone: "050" } as never;
    await service.submitLead(lead);
    await service.submitInterview(summary);
    await service.requestConsultationEvent(lead);
    expect(r.submitLead).toHaveBeenCalledWith(lead);
    expect(r.submitInterview).toHaveBeenCalledWith(summary);
    expect(r.requestConsultationEvent).toHaveBeenCalledWith(lead);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("SupabaseLeadService — with the Edge lead functions switched on", () => {
  const lead = { name: "דנה", phone: "0501234567", source: "consultation" as const, topic: "פנסיה" };

  it("sends a lead to submit-lead with the body Base44 would have had", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, rid: "r1" }, error: null });
    const rest = { submitLead: vi.fn(), submitInterview: vi.fn(), requestConsultationEvent: vi.fn(), submitClaim: vi.fn() };
    const svc = new SupabaseLeadService({ functions: { invoke } }, rest, true);
    await svc.submitLead(lead);
    expect(invoke).toHaveBeenCalledWith("submit-lead", { body: leadBody(lead) });
    expect(rest.submitLead).not.toHaveBeenCalled();
  });

  it("sends an interview to submit-lead as a complete stage", async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true }, error: null });
    const svc = new SupabaseLeadService({ functions: { invoke } }, {} as never, true);
    await svc.submitInterview({ name: "דנה", phone: "0501234567", track: "pension" });
    expect(invoke.mock.calls[0][1].body).toMatchObject({ source: "interview", stage: "complete", track: "pension" });
  });

  it("stays on Base44 when switched off", async () => {
    const invoke = vi.fn();
    const rest = { submitLead: vi.fn().mockResolvedValue({ ok: true }), submitInterview: vi.fn(), requestConsultationEvent: vi.fn(), submitClaim: vi.fn() };
    await new SupabaseLeadService({ functions: { invoke } }, rest, false).submitLead(lead);
    expect(invoke).not.toHaveBeenCalled();
    expect(rest.submitLead).toHaveBeenCalled();
  });

  it("throws with the function's message and rid when submit-lead refuses", async () => {
    const res = new Response(JSON.stringify({ error: "נדרשים שם וטלפון", rid: "ab12" }), { status: 400 });
    const invoke = vi.fn().mockResolvedValue({ data: null, error: { message: "non-2xx", context: res } });
    await expect(new SupabaseLeadService({ functions: { invoke } }, {} as never, true).submitLead(lead))
      .rejects.toThrow("submit-lead failed: נדרשים שם וטלפון (rid ab12)");
  });
});
