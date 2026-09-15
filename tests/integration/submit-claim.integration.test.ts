import { describe, expect, it } from "vitest";
import { invokeFunction } from "../helpers/base44-function";

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

describe("submitClaim — the report lands", () => {
  it("stores the claim and tells the agency and both operations mailboxes", async () => {
    const r = await invokeFunction("submitClaim", claim);

    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, warnings: [] });
    expect(r.leads).toHaveLength(1);
    expect(r.leads[0]).toMatchObject({ name: "רונית מזרחי", source: "claim", status: "new" });

    for (const to of [AGENCY, OPS, OPS2, "ronit@example.com"]) {
      expect(r.emails.map((e) => e.to), to).toContain(to);
    }
  });

  it("gives every staff mailbox the same report", async () => {
    const r = await invokeFunction("submitClaim", claim);
    for (const to of [AGENCY, OPS, OPS2]) {
      const body = r.mailTo(to).body ?? r.mailTo(to).text ?? "";
      expect(body, to).toContain("רונית מזרחי");
      expect(body, to).toContain("0536667788");
      expect(body, to).toContain("נזק לרכב בחניון");
      expect(body, to).toContain("אישור משטרה.pdf");
    }
  });

  it("pins the status and the source rather than taking them from the caller", async () => {
    const r = await invokeFunction("submitClaim", { ...claim, status: "closed", source: "quick" });
    expect(r.leads[0].status).toBe("new");
    expect(r.leads[0].source).toBe("claim");
  });

  it("says so when no documents were attached", async () => {
    const r = await invokeFunction("submitClaim", { ...claim, documents: [] });
    const body = r.mailTo(AGENCY).body ?? r.mailTo(AGENCY).text ?? "";
    expect(body).toContain("מסמכים מצורפים: אין");
  });

  it("skips the reporter's confirmation when no address was given", async () => {
    const r = await invokeFunction("submitClaim", { ...claim, email: "" });
    expect(r.status).toBe(200);
    expect(r.emails.map((e) => e.to).sort()).toEqual([AGENCY, OPS, OPS2].sort());
  });
});

describe("submitClaim — the operations mailboxes", () => {
  it("delivers to the second mailbox when the first bounces", async () => {
    const r = await invokeFunction("submitClaim", claim, { failEmailTo: [OPS] });
    expect(r.emails.map((e) => e.to)).toContain(OPS2);
    expect(r.json.warnings as string[]).toSatisfy((w: string[]) => w.some((x) => x.startsWith("notify_email_failed")));
    // The agency and the reporter are on separate sends and are unaffected.
    expect(r.emails.map((e) => e.to)).toContain(AGENCY);
    expect(r.status).toBe(200);
  });

  it("delivers to the first when the second bounces", async () => {
    const r = await invokeFunction("submitClaim", claim, { failEmailTo: [OPS2] });
    expect(r.emails.map((e) => e.to)).toContain(OPS);
    expect(r.json.warnings as string[]).toSatisfy((w: string[]) => w.some((x) => x.startsWith("notify_email_failed")));
  });

  it("still tells the agency when both operations mailboxes bounce", async () => {
    const r = await invokeFunction("submitClaim", claim, { failEmailTo: [OPS, OPS2] });
    expect(r.emails.map((e) => e.to)).toContain(AGENCY);
    expect(r.status).toBe(200);
  });
});

describe("submitClaim — what survives a failure", () => {
  it("refuses without a phone number, and writes nothing", async () => {
    const r = await invokeFunction("submitClaim", { ...claim, phone: "" });
    expect(r.status).toBe(400);
    expect(r.leads).toHaveLength(0);
    expect(r.emails).toHaveLength(0);
  });

  it("refuses without a name", async () => {
    const r = await invokeFunction("submitClaim", { ...claim, name: "" });
    expect(r.status).toBe(400);
  });

  it("fails loudly when the record cannot be written, and mails nobody", async () => {
    // A claim nobody stored is worse than a claim nobody was mailed about:
    // the reporter believes it is in hand.
    const r = await invokeFunction("submitClaim", claim, { failLeadWrite: true });
    expect(r.status).toBe(500);
    expect(r.emails).toHaveLength(0);
  });

  it("keeps the report when only the confirmation bounces", async () => {
    const r = await invokeFunction("submitClaim", claim, { failEmailTo: ["ronit@example.com"] });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
    expect(r.json.warnings as string[]).toSatisfy((w: string[]) => w.some((x) => x.startsWith("client_confirmation_failed")));
  });
});

describe("submitClaim — a name that is really a payload", () => {
  it("renders no live markup into the reporter's HTML mail", async () => {
    const r = await invokeFunction("submitClaim", {
      ...claim,
      name: '<a href="https://evil.example">לחצו כאן</a> מזרחי',
    });
    const html = r.mailTo("ronit@example.com").html!;
    // Only the first word reaches the greeting — `firstName` is split on the
    // space — so the assertion is that no live tag survives, and that the
    // fragment that did arrive came through escaped.
    expect(html).not.toContain('<a href="https://evil.example"');
    expect(html).not.toContain("<a ");
    expect(html).toContain("&lt;a");
  });
});
