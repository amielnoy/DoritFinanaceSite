import { describe, expect, it, vi } from "vitest";
import { Base44LeadService } from "@/services/base44/Base44LeadService";
import { Base44SupportService } from "@/services/base44/Base44SupportService";

/**
 * The receipt is the response body, whatever the SDK wraps it in.
 *
 * `@base44/sdk` builds its functions client with `interceptResponses: false`,
 * so `functions.invoke` resolves to the whole axios response — `{ data,
 * status, headers, … }` — and not to the body. The adapters cast that straight
 * to a receipt and read `.ok` and `.contact` off the wrapper, where they never
 * are. So an interview that had saved, mailed Dorit and written both calendars
 * told the visitor "לא הצלחתי לשמור את הפרטים", every time; and every handoff
 * that reached her was shown to the visitor as one that had not.
 *
 * The fakes elsewhere return bare bodies, which is why nothing caught it.
 * These return what the SDK actually returns.
 */
const axiosResponse = (data: unknown) => ({
  data,
  status: 200,
  statusText: "OK",
  headers: {},
  config: {},
});

const clientReturning = (data: unknown) => ({
  functions: { invoke: vi.fn().mockResolvedValue(axiosResponse(data)) },
});

describe("Base44LeadService — reading the SDK's response", () => {
  it("reports an interview that saved as saved", async () => {
    const leads = new Base44LeadService(clientReturning({ ok: true, rid: "03cc1acf", leadId: "L1", warnings: [] }));
    const receipt = await leads.submitInterview({ name: "רונית", phone: "0527654321" });
    expect(receipt.ok).toBe(true);
    expect(receipt.rid).toBe("03cc1acf");
  });

  it("reports a lead that saved as saved", async () => {
    const leads = new Base44LeadService(clientReturning({ ok: true, rid: "r1", leadId: "L2", warnings: [] }));
    const receipt = await leads.submitLead({ name: "רונית", phone: "0527654321", source: "quick" });
    expect(receipt.ok).toBe(true);
  });

  it("still accepts a bare body, as the in-memory fakes return", async () => {
    const leads = new Base44LeadService({
      functions: { invoke: vi.fn().mockResolvedValue({ ok: true, rid: "r2" }) },
    });
    expect((await leads.submitInterview({ name: "רונית", phone: "0527654321" })).ok).toBe(true);
  });
});

describe("Base44SupportService — reading the SDK's response", () => {
  it("reports a handoff that reached Dorit as one that did", async () => {
    const contact = {
      phoneDisplay: "050-000-0000",
      phoneE164: "+972500000000",
      whatsapp: "972500000000",
      email: "x@example.com",
    };
    const support = new Base44SupportService(
      clientReturning({ ok: true, rid: "e1", contact, acknowledgement: "הפנייה הועברה", warnings: [] })
    );
    const receipt = await support.escalate({ reason: "user_request", summary: "s", phone: "0527654321" });
    expect(receipt.ok).toBe(true);
    expect(receipt.contact).toEqual(contact);
  });
});
