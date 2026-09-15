import { describe, expect, it } from "vitest";
import { invokeFunction } from "../helpers/base44-function";

/**
 * `escalateToHuman`, executed.
 *
 * This is the function that runs when an agent has decided it may not answer.
 * Its obligations are unusual: the *notification* matters more than the
 * record, because an enquiry that was handed off and never reached a person is
 * a regulatory failure, while an enquiry that reached דורית without a database
 * row is merely untidy. Several tests below exist to pin that asymmetry, which
 * no amount of reading the source makes obvious.
 *
 * The reason-clamping tests are the ones that earn their place hardest. A
 * source check can see `hasOwnProperty` in the file. Only running it shows
 * that `__proto__` comes back as `uncertain` rather than as a truthy lookup
 * against `Object.prototype`.
 */

const AGENCY = "dorit@govari-fin.co.il";
const OPS = "amielnoy@gmail.com";
const OPS2 = "amielnoy@outlook.com";

const escalation = {
  reason: "product_recommendation",
  summary: "שאל איזו קרן עדיפה.",
  name: "דני לוי",
  phone: "0537654321",
  email: "dani@example.com",
  agent: "needs_interview",
  topic: "גמל",
  consentVersion: "2026-09-agents-v2",
  consentAt: "2026-09-13T10:00:00.000Z",
};

describe("escalateToHuman — handing a conversation to a person", () => {
  it("records the escalation and notifies both inboxes", async () => {
    const r = await invokeFunction("escalateToHuman", escalation);

    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, recorded: true, notified: true });
    expect(r.leads[0]).toMatchObject({
      source: "escalation",
      status: "escalated",
      escalation_reason: "product_recommendation",
      handled_by_agent: "needs_interview",
    });
    expect(r.emails.map((e) => e.to).sort()).toEqual([OPS, OPS2, AGENCY].sort());
  });

  it("stores the consent the visitor was shown, so a record ties to its wording", async () => {
    const r = await invokeFunction("escalateToHuman", escalation);
    expect(r.leads[0]).toMatchObject({
      consent_version: "2026-09-agents-v2",
      consent_at: "2026-09-13T10:00:00.000Z",
    });
  });

  it("always hands back the contact channels, whatever else happened", async () => {
    const r = await invokeFunction("escalateToHuman", escalation);
    expect(r.json.contact).toMatchObject({
      phoneDisplay: "050-831-1776",
      email: AGENCY,
    });
    expect(r.json.acknowledgement).toBeTruthy();
  });

  it("flags the reasons that should not wait in a queue", async () => {
    const urgent = await invokeFunction("escalateToHuman", { ...escalation, reason: "complaint" });
    expect(urgent.mailTo(AGENCY).subject).toContain("🔴");

    const ordinary = await invokeFunction("escalateToHuman", escalation);
    expect(ordinary.mailTo(AGENCY).subject).not.toContain("🔴");
  });
});

describe("escalateToHuman — a reason the model made up", () => {
  it("clamps __proto__ to uncertain instead of finding it on the prototype", async () => {
    // `reason in REASONS` or a bare `REASONS[reason]` guard would treat this as
    // a valid reason, because every object inherits it. This is the case the
    // hasOwnProperty check exists for, and the only way to see it is to run it.
    const r = await invokeFunction("escalateToHuman", { ...escalation, reason: "__proto__" });
    expect(r.json.reason).toBe("uncertain");
    expect(r.leads[0].escalation_reason).toBe("uncertain");
  });

  it("clamps constructor too", async () => {
    const r = await invokeFunction("escalateToHuman", { ...escalation, reason: "constructor" });
    expect(r.json.reason).toBe("uncertain");
  });

  it("clamps anything simply invented", async () => {
    const r = await invokeFunction("escalateToHuman", { ...escalation, reason: "give_advice" });
    expect(r.json.reason).toBe("uncertain");
    expect(r.leads[0].escalation_reason).toBe("uncertain");
  });

  it("clamps a missing reason", async () => {
    const r = await invokeFunction("escalateToHuman", { ...escalation, reason: undefined });
    expect(r.json.reason).toBe("uncertain");
  });

  it("keeps a declared reason exactly as given", async () => {
    for (const reason of ["regulated_advice", "privacy_request", "sensitive_data", "user_request"]) {
      const r = await invokeFunction("escalateToHuman", { ...escalation, reason });
      expect(r.json.reason, reason).toBe(reason);
    }
  });
});

describe("escalateToHuman — identifiers in a model-written summary", () => {
  const leaky = {
    ...escalation,
    summary: "מסר ת״ז 123456789, חשבון IL620108000000099999999 וכרטיס 4580-1234-5678-9012.",
  };

  it("redacts before the record is written", async () => {
    const r = await invokeFunction("escalateToHuman", leaky);
    const message = String(r.leads[0].message);
    expect(message).not.toContain("123456789");
    expect(message).not.toContain("99999999");
    expect(message).not.toContain("4580");
    expect(message).toContain("הושמט");
  });

  it("redacts before the notification is sent", async () => {
    const r = await invokeFunction("escalateToHuman", leaky);
    for (const mail of r.emails) {
      expect(mail.body, mail.to).not.toContain("123456789");
      expect(mail.body, mail.to).not.toContain("4580");
    }
  });

  it("leaves an ordinary summary untouched", async () => {
    const r = await invokeFunction("escalateToHuman", escalation);
    expect(r.mailTo(AGENCY).body).toContain("שאל איזו קרן עדיפה");
  });
});

describe("escalateToHuman — the notification outranks the record", () => {
  it("still notifies when there are no contact details to store", async () => {
    // A visitor who asked for a person without leaving a number still has to
    // reach one. Nothing is stored; דורית is told regardless.
    const r = await invokeFunction("escalateToHuman", {
      reason: "user_request",
      summary: "ביקש לדבר עם אדם.",
      agent: "blog_recommender",
    });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(0);
    expect(r.json.recorded).toBe(false);
    expect(r.json.notified).toBe(true);
    expect(r.json.warnings).toContain("no_contact_details");
  });

  it("refuses to store an invalid phone number, and notifies anyway", async () => {
    const r = await invokeFunction("escalateToHuman", { ...escalation, phone: "12345" });
    expect(r.leads).toHaveLength(0);
    expect(r.json.notified).toBe(true);
  });

  it("notifies even when the record fails to write", async () => {
    const r = await invokeFunction("escalateToHuman", escalation, { failLeadWrite: true });
    expect(r.json.notified).toBe(true);
    expect(r.json.warnings).toContain("lead_write_failed");
    expect(r.status).toBe(200);
  });

  it("still answers the agent with contact details when every mailbox bounces", async () => {
    // The worst case: nothing stored, nobody mailed. The visitor must still be
    // given a way to reach a person, so the agent can read it out.
    const r = await invokeFunction("escalateToHuman", escalation, {
      failLeadWrite: true,
      failEmailTo: [AGENCY, OPS, OPS2],
    });
    expect(r.status).toBe(200);
    expect(r.json.notified).toBe(false);
    expect(r.json.contact).toMatchObject({ phoneDisplay: "050-831-1776" });
  });

  it("names the agent that handed over, so a pattern is visible later", async () => {
    const r = await invokeFunction("escalateToHuman", escalation);
    expect(r.mailTo(AGENCY).body).toContain("needs_interview");
  });
});

describe("escalateToHuman — the operations mailboxes", () => {
  it("notifies both operations mailboxes as well as the agency", async () => {
    const r = await invokeFunction("escalateToHuman", escalation);
    for (const to of [OPS, OPS2, AGENCY]) {
      expect(r.emails.map((e) => e.to), to).toContain(to);
    }
  });

  it("still reports notified when only one mailbox bounces", async () => {
    // An escalation that reached nobody is a regulatory failure; one that
    // reached two of three is not, and must not be reported as one.
    const r = await invokeFunction("escalateToHuman", escalation, { failEmailTo: [OPS] });
    expect(r.json.notified).toBe(true);
    expect(r.emails.map((e) => e.to)).toContain(OPS2);
  });
});
