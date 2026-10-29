import { describe, expect, it, vi } from "vitest";
import { SupabaseLeadService, type SupabaseFunctionsClient } from "@/services/supabase/SupabaseLeadService";
import { interviewBody, leadBody } from "@/services/lead-bodies";

const report = { name: "רונית", phone: "0536667788", claimType: "תאונת דרכים", documents: ["https://x/a.pdf"] };

type InvokeResult = Awaited<ReturnType<SupabaseFunctionsClient["functions"]["invoke"]>>;

const functionsClient = (result: InvokeResult) => {
  const invoke = vi.fn(async () => result);
  return { client: { functions: { invoke } } as SupabaseFunctionsClient, invoke };
};

describe("SupabaseLeadService.submitClaim", () => {
  it("invokes submit-claim with the body the Base44 adapter sends, blanks filled", async () => {
    const { client, invoke } = functionsClient({ data: { ok: true, rid: "r1", leadId: "uuid-1", warnings: [] }, error: null });
    await new SupabaseLeadService(client).submitClaim(report);
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
    await expect(new SupabaseLeadService(client).submitClaim(report)).resolves.toEqual({
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
    await expect(new SupabaseLeadService(client).submitClaim(report)).rejects.toThrow(/לא הצלחנו לשמור.*rid ab12cd34/);
  });

  it("throws on a network failure, which has no response to read", async () => {
    const { client } = functionsClient({ data: null, error: { message: "Failed to send a request to the Edge Function" } });
    await expect(new SupabaseLeadService(client).submitClaim(report)).rejects.toThrow(/Failed to send a request/);
  });
});

describe("SupabaseLeadService — leads and interviews on submit-lead", () => {
  const lead = { name: "דנה", phone: "0501234567", source: "consultation" as const, topic: "פנסיה" };
  const summary = { name: "דנה", phone: "0501234567", track: "pension" };

  it("sends a lead to submit-lead", async () => {
    const { client, invoke } = functionsClient({ data: { ok: true, rid: "r1" }, error: null });
    await new SupabaseLeadService(client).submitLead(lead);
    expect(invoke).toHaveBeenCalledWith("submit-lead", { body: leadBody(lead) });
  });

  it("sends an interview to submit-lead", async () => {
    const { client, invoke } = functionsClient({ data: { ok: true }, error: null });
    await new SupabaseLeadService(client).submitInterview(summary);
    expect(invoke).toHaveBeenCalledWith("submit-lead", { body: interviewBody(summary) });
  });

  it("throws with the function's message and rid when submit-lead refuses, and does not retry", async () => {
    const context = new Response(JSON.stringify({ error: "נדרשים שם וטלפון", rid: "ab12" }), { status: 400 });
    const { client, invoke } = functionsClient({ data: null, error: { message: "non-2xx", context } });
    await expect(new SupabaseLeadService(client).submitLead(lead)).rejects.toThrow("submit-lead failed: נדרשים שם וטלפון (rid ab12)");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("fills in an interview's just-saved lead", () => {
    const { client } = functionsClient({ data: null, error: null });
    expect(new SupabaseLeadService(client).updatesInterviews).toBe(true);
  });
});
