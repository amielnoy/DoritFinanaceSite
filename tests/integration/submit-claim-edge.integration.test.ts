import { afterEach, describe, expect, it, vi } from "vitest";
import { MAILER_URL } from "../helpers/base44-function";
import { invokeEdge, SUPABASE_URL } from "../helpers/edge-function";

/**
 * What only the Edge Function does: the row it writes to Supabase, the CORS
 * answer the browser needs, and the failures that are new because the database
 * is now the one store rather than a mirror.
 */

const claim = {
  name: "רונית מזרחי",
  phone: "0536667788",
  email: "ronit@example.com",
  claimType: "תאונת דרכים",
  eventDate: "2026-09-01",
  policyNumber: "POL-99",
  description: "נזק לרכב בחניון, דווח למשטרה.",
  documents: ["אישור משטרה.pdf", "תמונות.zip"],
};

afterEach(() => vi.restoreAllMocks());

describe("submit-claim — the row", () => {
  it("writes exactly today's fields, with no Base44 id", async () => {
    const r = await invokeEdge("submit-claim", claim);
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
    const { id, ...row } = r.leads[0];
    expect(id).toEqual(expect.any(String));
    expect(row).toEqual({
      name: "רונית מזרחי",
      phone: "0536667788",
      email: "ronit@example.com",
      source: "claim",
      topic: "תאונת דרכים",
      timing: "2026-09-01",
      message:
        "סוג: תאונת דרכים\nתאריך אירוע: 2026-09-01\nפוליסה: POL-99\nנזק לרכב בחניון, דווח למשטרה.\nמסמכים: אישור משטרה.pdf | תמונות.zip",
      status: "new",
      channel: "unknown",
      campaign: null,
    });
  });

  it("answers with the Supabase id of the row it wrote", async () => {
    const r = await invokeEdge("submit-claim", claim);
    expect(r.json).toMatchObject({ ok: true, leadId: r.leads[0].id, warnings: [] });
    expect(r.json.rid).toEqual(expect.any(String));
  });

  it("writes with the service key and asks for the row back, before any mail", async () => {
    const r = await invokeEdge("submit-claim", claim);
    const at = r.fetches.findIndex((f) => f.url === `${SUPABASE_URL}/rest/v1/leads`);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(r.fetches.slice(0, at).some((f) => f.url === MAILER_URL)).toBe(false);
    expect(r.fetches[at].headers).toMatchObject({
      apikey: "service-role-test",
      Authorization: "Bearer service-role-test",
      Prefer: "return=representation",
    });
  });
});

describe("submit-claim — what it refuses", () => {
  it("answers a body that is not JSON as a missing name and phone, touching nothing", async () => {
    const r = await invokeEdge("submit-claim", null, { rawBody: "not json" });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: "נדרשים שם וטלפון", rid: expect.any(String) });
    expect(r.fetches).toEqual([]);
  });

  it("saves nothing and mails nobody when Supabase is not configured", async () => {
    const r = await invokeEdge("submit-claim", claim, { env: { MAILER_URL, MAILER_TOKEN: "t" } });
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: "לא הצלחנו לשמור את הדיווח. נסו שוב או צרו קשר ישירות.", rid: expect.any(String) });
    expect(r.emails).toEqual([]);
  });

  it("keeps the row's contents out of the log when the database quotes them back", async () => {
    const lines: string[] = [];
    for (const level of ["log", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
    }
    const r = await invokeEdge("submit-claim", claim, {
      failLeadWrite: {
        status: 400,
        body: JSON.stringify({
          code: "23514",
          message: "new row violates check constraint",
          details: "Failing row contains (רונית מזרחי, 0536667788).",
        }),
      },
    });
    expect(r.status).toBe(500);
    const all = lines.join("\n");
    expect(all).toContain("lead.create_failed");
    expect(all).toContain("23514");
    expect(all).not.toContain("רונית");
    expect(all).not.toContain("0536667788");
  });
});

describe("submit-claim — the browser's side", () => {
  it("answers a preflight without doing anything", async () => {
    const r = await invokeEdge("submit-claim", undefined, { method: "OPTIONS" });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://govari-fin.co.il");
    expect(r.fetches).toEqual([]);
  });

  it("names the site's origin on every answer, including a refusal", async () => {
    const r = await invokeEdge("submit-claim", { ...claim, phone: "" });
    expect(r.status).toBe(400);
    expect(r.headers.get("access-control-allow-origin")).toBe("https://govari-fin.co.il");
  });

  it("names no origin for a page that is not ours", async () => {
    const r = await invokeEdge("submit-claim", claim, { headers: { origin: "https://evil.example" } });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
});
