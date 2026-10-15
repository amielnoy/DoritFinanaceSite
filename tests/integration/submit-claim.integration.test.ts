import { describe, expect, it } from "vitest";
import { invokeFunction } from "../helpers/base44-function";
import { invokeEdge } from "../helpers/edge-function";

/**
 * `submitClaim`, executed.
 *
 * This function had no integration coverage at all — `12-std-integration.md`
 * listed it as a known gap — and it was the third place the operations mailbox
 * list had to be threaded through. A change to who gets told about a claim is
 * exactly the kind of thing a source-matching test waves through: the constant
 * is renamed, the loop is added, every string assertion still passes, and
 * nobody notices until a claim is reported and one inbox stays empty.
 *
 * A claim is also the most time-critical thing the site accepts. The record is
 * written first and every notification is best-effort after it, same as
 * `submitLead` — these pin that a bounce costs a message and never the report.
 *
 * Both implementations run every case below while both exist: Base44's
 * `submitClaim` (the rollback) and the `submit-claim` Edge Function that
 * replaced it. A case that passes for one and fails for the other is drift.
 */

const AGENCY = "dorit@govari-fin.co.il";
const OPS = "amielnoy@gmail.com";
const OPS2 = "amielnoy@outlook.com";

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

type Run = (
  body: unknown,
  options?: { failLeadWrite?: boolean; failEmailTo?: string[] },
) => Promise<{
  status: number;
  json: Record<string, unknown>;
  leads: Record<string, unknown>[];
  emails: { to: string; subject: string; html?: string; text?: string; body?: string }[];
  mailTo(address: string): { subject: string; html?: string; text?: string; body?: string };
}>;

/**
 * `minimalOps`: the operations mailboxes get a notice without the reporter's
 * details (N-02). The Edge function — production's path — does; Base44's twin,
 * reached only where Supabase is not configured and retired by N-03, still
 * sends them the whole report.
 */
const IMPLEMENTATIONS: { label: string; run: Run; minimalOps: boolean }[] = [
  { label: "Base44 submitClaim", run: (body, options) => invokeFunction("submitClaim", body, options), minimalOps: false },
  { label: "Edge submit-claim", run: (body, options) => invokeEdge("submit-claim", body, options), minimalOps: true },
];

describe.each(IMPLEMENTATIONS)("$label", ({ run, minimalOps }) => {
  describe("submitClaim — the report lands", () => {
    it("stores the claim and tells the agency and both operations mailboxes", async () => {
      const r = await run(claim);

      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ ok: true, warnings: [] });
      expect(r.leads).toHaveLength(1);
      expect(r.leads[0]).toMatchObject({ name: "רונית מזרחי", source: "claim", status: "new" });

      for (const to of [AGENCY, OPS, OPS2, "ronit@example.com"]) {
        expect(r.emails.map((e) => e.to), to).toContain(to);
      }
    });

    it("gives Dorit the whole report, and the operations mailboxes a notice without the reporter's details", async () => {
      const r = await run(claim);
      const details = ["רונית מזרחי", "0536667788", "נזק לרכב בחניון", "אישור משטרה.pdf"];
      const agency = r.mailTo(AGENCY).body ?? r.mailTo(AGENCY).text ?? "";
      for (const d of details) expect(agency, d).toContain(d);
      for (const to of [OPS, OPS2]) {
        const mail = r.mailTo(to);
        const body = `${mail.subject}\n${mail.body ?? mail.text ?? ""}\n${mail.html ?? ""}`;
        if (minimalOps) {
          for (const d of details) expect(body, `${to}: ${d}`).not.toContain(d);
          expect(body, to).toContain("דיווח אירוע ביטוחי חדש");
          expect(body, to).toContain("https://govari-fin.co.il/admin/leads");
        } else {
          for (const d of details) expect(body, `${to}: ${d}`).toContain(d);
        }
      }
    });

    it("pins the status and the source rather than taking them from the caller", async () => {
      const r = await run({ ...claim, status: "closed", source: "quick" });
      expect(r.leads[0].status).toBe("new");
      expect(r.leads[0].source).toBe("claim");
    });

    it("says so when no documents were attached", async () => {
      const r = await run({ ...claim, documents: [] });
      const body = r.mailTo(AGENCY).body ?? r.mailTo(AGENCY).text ?? "";
      expect(body).toContain("מסמכים מצורפים: אין");
    });

    it("skips the reporter's confirmation when no address was given", async () => {
      const r = await run({ ...claim, email: "" });
      expect(r.status).toBe(200);
      expect(r.emails.map((e) => e.to).sort()).toEqual([AGENCY, OPS, OPS2].sort());
    });
  });

  describe("submitClaim — the operations mailboxes", () => {
    it("delivers to the second mailbox when the first bounces", async () => {
      const r = await run(claim, { failEmailTo: [OPS] });
      expect(r.emails.map((e) => e.to)).toContain(OPS2);
      expect(r.json.warnings as string[]).toSatisfy((w: string[]) => w.some((x) => x.startsWith("notify_email_failed")));
      // The agency and the reporter are on separate sends and are unaffected.
      expect(r.emails.map((e) => e.to)).toContain(AGENCY);
      expect(r.status).toBe(200);
    });

    it("delivers to the first when the second bounces", async () => {
      const r = await run(claim, { failEmailTo: [OPS2] });
      expect(r.emails.map((e) => e.to)).toContain(OPS);
      expect(r.json.warnings as string[]).toSatisfy((w: string[]) => w.some((x) => x.startsWith("notify_email_failed")));
    });

    it("still tells the agency when both operations mailboxes bounce", async () => {
      const r = await run(claim, { failEmailTo: [OPS, OPS2] });
      expect(r.emails.map((e) => e.to)).toContain(AGENCY);
      expect(r.status).toBe(200);
    });
  });

  describe("submitClaim — what survives a failure", () => {
    it("refuses without a phone number, and writes nothing", async () => {
      const r = await run({ ...claim, phone: "" });
      expect(r.status).toBe(400);
      expect(r.leads).toHaveLength(0);
      expect(r.emails).toHaveLength(0);
    });

    it("refuses without a name", async () => {
      const r = await run({ ...claim, name: "" });
      expect(r.status).toBe(400);
    });

    it("fails loudly when the record cannot be written, and mails nobody", async () => {
      // A claim nobody stored is worse than a claim nobody was mailed about:
      // the reporter believes it is in hand.
      const r = await run(claim, { failLeadWrite: true });
      expect(r.status).toBe(500);
      expect(r.emails).toHaveLength(0);
    });

    it("keeps the report when only the confirmation bounces", async () => {
      const r = await run(claim, { failEmailTo: ["ronit@example.com"] });
      expect(r.status).toBe(200);
      expect(r.leads).toHaveLength(1);
      expect(r.json.warnings as string[]).toSatisfy((w: string[]) => w.some((x) => x.startsWith("client_confirmation_failed")));
    });
  });

  describe("submitClaim — a name that is really a payload", () => {
    it("renders no live markup into the reporter's HTML mail", async () => {
      const r = await run({
        ...claim,
        name: '<a href="https://evil.example">לחצו כאן</a> מזרחי',
      });
      const mail = r.mailTo("ronit@example.com");
      // A first "word" that is not made of letters is dropped, not escaped:
      // the greeting goes out without a name, so nothing of it arrives.
      expect(mail.html).not.toContain("<a ");
      expect(mail.html).not.toContain("&lt;a");
      expect(mail.html).not.toContain("evil.example");
      expect(mail.html).toContain("שלום,");
      expect(mail.text).toMatch(/^שלום, קיבלתי/);
    });

    it("greets a letters-only first name as before", async () => {
      const r = await run(claim);
      expect(r.mailTo("ronit@example.com").html).toContain("שלום רונית,");
    });

    it("names in the reporter's copy only a claim type from the form's list", async () => {
      const r = await run({ ...claim, claimType: "visit https://evil.example now" });
      const mail = r.mailTo("ronit@example.com");
      expect(mail.html).not.toContain("evil.example");
      expect(mail.text).toContain("סוג אירוע: כללי");
      // Dorit's copy still says what was typed — she is the one who has to read it.
      expect(r.mailTo("dorit@govari-fin.co.il").body).toContain("visit https://evil.example now");
    });

    it("shows the event date to the reporter only when it is a date", async () => {
      const r = await run({ ...claim, eventDate: "https://evil.example" });
      expect(r.mailTo("ronit@example.com").text).toContain("תאריך: —");
    });
  });

  describe("submitClaim — the public entry point's limits", () => {
    it("refuses a field longer than its ceiling, and writes nothing", async () => {
      const r = await run({ ...claim, description: "x".repeat(4001) });
      expect(r.status).toBe(400);
      expect(r.leads).toHaveLength(0);
      expect(r.emails).toHaveLength(0);
    });

    it("refuses a field that is not text", async () => {
      const r = await run({ ...claim, name: { first: "רונית" } });
      expect(r.status).toBe(400);
      expect(r.leads).toHaveLength(0);
    });

    it("refuses more than ten documents", async () => {
      const r = await run({ ...claim, documents: Array.from({ length: 11 }, (_, i) => `doc-${i}.pdf`) });
      expect(r.status).toBe(400);
      expect(r.leads).toHaveLength(0);
    });

    it("keeps the report but sends no confirmation to something that is not an address", async () => {
      const r = await run({ ...claim, email: "a@b.com, victim@example.com" });
      expect(r.status).toBe(200);
      expect(r.leads).toHaveLength(1);
      expect(r.emails.map((e) => e.to)).not.toContain("a@b.com, victim@example.com");
      expect(r.json.warnings).toContain("client_email_invalid");
    });
  });

  describe("submitClaim — channel attribution", () => {
    it("stores the claim as a lead with the supplied channel", async () => {
      const r = await run({ ...claim, channel: "facebook" });
      expect(r.status).toBe(200);
      expect(r.leads[0]).toMatchObject({ source: "claim", channel: "facebook" });
    });

    it("adds a הגיע/ה דרך line to both the operations and agency copies — submitClaim sends them the same agentBody, unlike submitLead's richer ops-only footer", async () => {
      const r = await run({ ...claim, channel: "instagram", campaign: "q4" });
      const opsBody = r.mailTo(OPS).body ?? r.mailTo(OPS).text ?? "";
      const agencyBody = r.mailTo(AGENCY).body ?? r.mailTo(AGENCY).text ?? "";
      expect(opsBody).toContain("הגיע/ה דרך: instagram / q4");
      expect(agencyBody).toContain("הגיע/ה דרך: instagram / q4");
    });

    it("stores 'unknown' and adds no line for an unrecognised channel", async () => {
      const r = await run({ ...claim, channel: "not_a_real_channel" });
      expect(r.leads[0].channel).toBe("unknown");
      const opsBody = r.mailTo(OPS).body ?? r.mailTo(OPS).text ?? "";
      expect(opsBody).not.toContain("הגיע/ה דרך");
    });

    it("works with no channel supplied at all", async () => {
      const r = await run(claim);
      expect(r.status).toBe(200);
      expect(r.leads[0].channel).toBe("unknown");
    });
  });
});

describe("the two implementations say the same thing", () => {
  it("send the reporter the same HTML", async () => {
    const [base44, edge] = await Promise.all([invokeFunction("submitClaim", claim), invokeEdge("submit-claim", claim)]);
    expect(edge.mailTo("ronit@example.com").html).toBe(base44.mailTo("ronit@example.com").html);
    expect(edge.mailTo("ronit@example.com").subject).toBe(base44.mailTo("ronit@example.com").subject);
  });

  // Dorit's copy only: the operations mailboxes get a notice from the Edge function (N-02).
  it("send Dorit the same report, apart from the timestamp line", async () => {
    const [base44, edge] = await Promise.all([invokeFunction("submitClaim", claim), invokeEdge("submit-claim", claim)]);
    const rest = (text = "") => text.split("\n").slice(1).join("\n");
    for (const to of [AGENCY]) {
      expect(rest(edge.mailTo(to).text), to).toBe(rest(base44.mailTo(to).body ?? base44.mailTo(to).text));
      expect(edge.mailTo(to).subject, to).toBe(base44.mailTo(to).subject);
    }
  });
});

describe("Edge submit-claim — files kept two months (claim_documents_expired)", () => {
  it("tells Dorit to keep a stored file, since the site deletes it after two months", async () => {
    const r = await invokeEdge("submit-claim", {
      ...claim,
      documents: ["storage:claim-documents/00000000-0000-0000-0000-000000000001/police.pdf"],
    });
    expect(r.mailTo(AGENCY).text).toContain("הקבצים נמחקים מהאתר אחרי חודשיים — כדאי לשמור אותם בתיק הלקוח");
  });

  it("says nothing of it when no file is stored on the site", async () => {
    const r = await invokeEdge("submit-claim", claim);
    expect(r.mailTo(AGENCY).text).not.toContain("נמחקים מהאתר");
  });
});
