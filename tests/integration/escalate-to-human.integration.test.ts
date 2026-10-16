import { describe, expect, it, vi } from "vitest";
import { invokeFunction, type HarnessOptions } from "../helpers/base44-function";
import { invokeEdge, type EdgeOptions } from "../helpers/edge-function";

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
 *
 * The Edge function `escalate-to-human` does the work; Base44's `escalateToHuman`
 * is a forwarder to it (forwarders.integration.test.ts).
 */

/** Both harnesses' options. A case passes only knobs both understand. */
type RunOptions = HarnessOptions & EdgeOptions;
type Result = Awaited<ReturnType<typeof invokeFunction>>;

const IMPLEMENTATIONS = [
  {
    label: "Edge escalate-to-human",
    run: (body: unknown, o: RunOptions = {}) => invokeEdge("escalate-to-human", body, o) as unknown as Promise<Result>,
  },
];

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
  consentVersion: "2026-10-agents-v3",
  consentAt: "2026-09-13T10:00:00.000Z",
};

describe.each(IMPLEMENTATIONS)("$label — handing a conversation to a person", ({ run }) => {
  it("records the escalation and notifies both inboxes", async () => {
    const r = await run(escalation);

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
    const r = await run(escalation);
    expect(r.leads[0]).toMatchObject({
      consent_version: "2026-10-agents-v3",
      consent_at: "2026-09-13T10:00:00.000Z",
    });
  });

  it("always hands back the contact channels, whatever else happened", async () => {
    const r = await run(escalation);
    expect(r.json.contact).toMatchObject({
      phoneDisplay: "050-831-1776",
      email: AGENCY,
    });
    expect(r.json.acknowledgement).toBeTruthy();
  });

  it("flags the reasons that should not wait in a queue", async () => {
    const urgent = await run({ ...escalation, reason: "complaint" });
    expect(urgent.mailTo(AGENCY).subject).toContain("🔴");

    const ordinary = await run(escalation);
    expect(ordinary.mailTo(AGENCY).subject).not.toContain("🔴");
  });
});

describe.each(IMPLEMENTATIONS)("$label — a reason the model made up", ({ run }) => {
  it("clamps __proto__ to uncertain instead of finding it on the prototype", async () => {
    // `reason in REASONS` or a bare `REASONS[reason]` guard would treat this as
    // a valid reason, because every object inherits it. This is the case the
    // hasOwnProperty check exists for, and the only way to see it is to run it.
    const r = await run({ ...escalation, reason: "__proto__" });
    expect(r.json.reason).toBe("uncertain");
    expect(r.leads[0].escalation_reason).toBe("uncertain");
  });

  it("clamps constructor too", async () => {
    const r = await run({ ...escalation, reason: "constructor" });
    expect(r.json.reason).toBe("uncertain");
  });

  it("clamps anything simply invented", async () => {
    const r = await run({ ...escalation, reason: "give_advice" });
    expect(r.json.reason).toBe("uncertain");
    expect(r.leads[0].escalation_reason).toBe("uncertain");
  });

  it("clamps a missing reason", async () => {
    const r = await run({ ...escalation, reason: undefined });
    expect(r.json.reason).toBe("uncertain");
  });

  it("keeps a declared reason exactly as given", async () => {
    for (const reason of ["regulated_advice", "privacy_request", "sensitive_data", "user_request"]) {
      const r = await run({ ...escalation, reason });
      expect(r.json.reason, reason).toBe(reason);
    }
  });
});

describe.each(IMPLEMENTATIONS)("$label — identifiers in a model-written summary", ({ run }) => {
  const leaky = {
    ...escalation,
    summary: "מסר ת״ז 123456789, חשבון IL620108000000099999999 וכרטיס 4580-1234-5678-9012.",
  };

  it("redacts before the record is written", async () => {
    const r = await run(leaky);
    const message = String(r.leads[0].message);
    expect(message).not.toContain("123456789");
    expect(message).not.toContain("99999999");
    expect(message).not.toContain("4580");
    expect(message).toContain("הושמט");
  });

  it("redacts before the notification is sent", async () => {
    const r = await run(leaky);
    for (const mail of r.emails) {
      // Every half of every copy. `body` is absent once a message carries HTML
      // — Base44 rejects the two together — so asserting on it alone would pass
      // by reading undefined rather than by finding nothing.
      const whole = `${mail.html ?? ""}${mail.text ?? ""}${mail.body ?? ""}`;
      expect(whole, mail.to).not.toContain("123456789");
      expect(whole, mail.to).not.toContain("4580");
    }
  });

  it("leaves an ordinary summary untouched", async () => {
    const r = await run(escalation);
    expect(r.mailTo(AGENCY).body).toContain("שאל איזו קרן עדיפה");
  });
});

describe.each(IMPLEMENTATIONS)("$label — the notification outranks the record", ({ run }) => {
  it("still notifies when there are no contact details to store", async () => {
    // A visitor who asked for a person without leaving a number still has to
    // reach one. Nothing is stored; דורית is told regardless.
    const r = await run({
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
    const r = await run({ ...escalation, phone: "12345" });
    expect(r.leads).toHaveLength(0);
    expect(r.json.notified).toBe(true);
  });

  it("notifies even when the record fails to write", async () => {
    const r = await run(escalation, { failLeadWrite: true });
    expect(r.json.notified).toBe(true);
    expect(r.json.warnings).toContain("lead_write_failed");
    expect(r.status).toBe(200);
  });

  it("still answers the agent with contact details when every mailbox bounces", async () => {
    // The worst case: nothing stored, nobody mailed. The visitor must still be
    // given a way to reach a person, so the agent can read it out.
    const r = await run(escalation, {
      failLeadWrite: true,
      failEmailTo: [AGENCY, OPS, OPS2],
    });
    expect(r.status).toBe(200);
    expect(r.json.notified).toBe(false);
    expect(r.json.contact).toMatchObject({ phoneDisplay: "050-831-1776" });
  });

  it("names the agent that handed over, so a pattern is visible later", async () => {
    const r = await run(escalation);
    expect(r.mailTo(AGENCY).body).toContain("needs_interview");
  });
});

describe.each(IMPLEMENTATIONS)("$label — the operations mailboxes", ({ run }) => {
  it("notifies both operations mailboxes as well as the agency", async () => {
    const r = await run(escalation);
    for (const to of [OPS, OPS2, AGENCY]) {
      expect(r.emails.map((e) => e.to), to).toContain(to);
    }
  });

  it("tells the operations team a hand-off happened and why, never who asked or what they said", async () => {
    const r = await run(escalation);
    const details = [escalation.name, escalation.phone, escalation.email, escalation.summary];
    for (const d of details) expect(r.mailTo(AGENCY).text ?? "", `agency: ${d}`).toContain(d);
    for (const to of [OPS, OPS2]) {
      const mail = r.mailTo(to);
      const all = `${mail.subject}\n${mail.text ?? ""}\n${mail.html ?? ""}`;
      for (const d of details) expect(all, `${to}: ${d}`).not.toContain(d);
      expect(mail.subject, to).toContain("העברה לטיפול אנושי");
      expect(mail.text, to).toContain("https://govari-fin.co.il/admin/leads");
    }
  });

  it("still reports notified when only one mailbox bounces", async () => {
    // An escalation that reached nobody is a regulatory failure; one that
    // reached two of three is not, and must not be reported as one.
    const r = await run(escalation, { failEmailTo: [OPS] });
    expect(r.json.notified).toBe(true);
    expect(r.emails.map((e) => e.to)).toContain(OPS2);
  });
});

/**
 * The handover, laid out.
 *
 * It went out as plain text only, and mail clients folded it into one running
 * paragraph: reason, name, phone and the conversation summary in a single line
 * with no separation. This is the message Dorit opens on a phone to decide
 * whether to call someone back now — exactly the thing that was not possible.
 *
 * The same defect was found and fixed for ordinary enquiries (A-14) and left
 * here, which is why these assert the layout rather than only the content.
 */
describe.each(IMPLEMENTATIONS)("$label — the notification is readable", ({ run }) => {
  it("sends HTML with the plain text alongside it, not instead of it", async () => {
    const r = await run(escalation);
    for (const to of [AGENCY, OPS, OPS2]) {
      const mail = r.mailTo(to);
      expect(mail.html, `${to} got no HTML`).toContain("<table");
      expect(mail.text ?? mail.body, `${to} lost the text fallback`).toBeTruthy();
    }
  });

  it("breaks it into titled blocks rather than one paragraph", async () => {
    const r = await run(escalation);
    const html = r.mailTo(AGENCY).html!;
    for (const heading of ["מי פנה", "ההעברה", "תקציר השיחה", "מצב"]) {
      expect(html, heading).toContain(heading);
    }
  });

  it("makes the phone dialable, because that is what this mail is for", async () => {
    const r = await run(escalation);
    expect(r.mailTo(AGENCY).html).toContain("tel:");
  });

  it("marks an urgent reason so it reads as urgent at a glance", async () => {
    // A complaint and an out-of-scope question must not look alike in a list.
    const urgent = await run({ ...escalation, reason: "complaint" });
    expect(urgent.mailTo(AGENCY).html).toContain("דחוף");

    const ordinary = await run({ ...escalation, reason: "out_of_scope" });
    expect(ordinary.mailTo(AGENCY).html).not.toContain("דחוף — לטפל היום");
  });

  it("says plainly when nothing was stored, because then this is the only record", async () => {
    const r = await run({ ...escalation, name: "", phone: "" });
    expect(r.mailTo(AGENCY).html).toContain("זו ההודעה היחידה");
  });

  it("escapes a name that is really a payload", async () => {
    const r = await run({
      ...escalation,
      name: '<a href="https://evil.example">לחצו</a> כהן',
    });
    const html = r.mailTo(AGENCY).html!;
    expect(html).not.toContain('<a href="https://evil.example"');
    expect(html).toContain("&lt;a");
  });

  it("keeps the redaction, now that the summary is rendered twice", async () => {
    // It reaches both the HTML and the text. A value stripped from one and not
    // the other would be the worst of both.
    const r = await run({
      ...escalation,
      summary: "מסר ת״ז 123456789 בשיחה",
    });
    for (const mail of r.emails) {
      expect(`${mail.html ?? ""}${mail.text ?? ""}${mail.body ?? ""}`, mail.to).not.toContain("123456789");
    }
  });
});

describe.each(IMPLEMENTATIONS)("$label — channel attribution", ({ run }) => {
  it("adds a הגיע/ה דרך line and persists the channel when contactable", async () => {
    const r = await run({
      reason: "user_request",
      summary: "בקשה לדבר עם דורית.",
      agent: "needs_interview",
      name: "דנה כהן",
      phone: "0541112222",
      channel: "ai_assistant",
    });
    expect(r.mailTo("dorit@govari-fin.co.il").text).toContain("הגיע/ה דרך: ai_assistant");
    expect(r.leads[0]).toMatchObject({ channel: "ai_assistant" });
  });

  it("stores 'unknown' for an unrecognised channel and adds no line", async () => {
    const r = await run({
      reason: "user_request",
      summary: "בקשה לדבר עם דורית.",
      agent: "needs_interview",
      name: "דנה כהן",
      phone: "0541112222",
      channel: "bogus",
    });
    expect(r.leads[0].channel).toBe("unknown");
    expect(r.mailTo("dorit@govari-fin.co.il").text).not.toContain("הגיע/ה דרך");
  });
});

// What only the port does. The Base44 function mirrored each lead into Supabase
// after writing its own entity; the port writes Supabase alone and appends the
// sheet row through the service account (spec: Supabase is the only store, no
// connectors), so these have no Base44 counterpart.
describe("Edge escalate-to-human — what only it does", () => {
  const handoff = { reason: "user_request", summary: "רוצה לדבר עם דורית", name: "דנה", phone: "0501234567", agent: "support_agent" };

  it("writes the hand-off to Supabase and the sheet, and nothing to Base44", async () => {
    const r = await invokeEdge("escalate-to-human", handoff);
    expect(r.json).toMatchObject({ ok: true, recorded: true });
    expect(r.leads[0]).toMatchObject({ source: "escalation", status: "escalated", escalation_reason: "user_request", handled_by_agent: "support_agent" });
    expect(r.sheetRows[0]).toMatchObject({ tab: "Events" });
    expect(r.sheetRows[0].row[1]).toBe("conversation_escalation");
    expect(r.callsTo("base44")).toEqual([]);
  });

  it("still answers with the contact details when the sheet fails", async () => {
    const r = await invokeEdge("escalate-to-human", handoff, { failGoogle: "sheets" });
    expect(r.json).toMatchObject({ ok: true, notified: true });
    expect(r.json.warnings).toContain("sheet_append_failed");
  });

  it("stores an absent consent time as null, not an empty string a timestamptz refuses", async () => {
    const r = await invokeEdge("escalate-to-human", handoff);
    expect(r.leads[0].consent_at).toBeNull();
  });

  it("answers ok: false with the contact details when the body is not usable", async () => {
    const r = await invokeEdge("escalate-to-human", handoff, { rawBody: "{not json" });
    // Base44's `await req.json()` throws into the catch; the port does the same.
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: false });
    expect(r.json.contact).toMatchObject({ phoneDisplay: "050-831-1776" });
  });
});

/** The structured log lines a run wrote, parsed. */
async function withLogs<T>(run: () => Promise<T>): Promise<{ result: T; lines: Record<string, unknown>[] }> {
  const spies = (["log", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  try {
    const result = await run();
    const lines = spies
      .flatMap((spy) => spy.mock.calls.map((c) => String(c[0])))
      .flatMap((text) => {
        try { return [JSON.parse(text) as Record<string, unknown>]; } catch { return []; }
      });
    return { result, lines };
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
}

describe("Edge escalate-to-human — what it refuses and what it holds back", () => {
  const handoff = { reason: "user_request", summary: "רוצה לדבר עם דורית", name: "דנה", phone: "0501234567", agent: "support_agent" };

  it("answers 400 to a request with nothing in it, and sends, stores and appends nothing", async () => {
    const { result: r, lines } = await withLogs(() => invokeEdge("escalate-to-human", {}));
    expect(lines).toContainEqual(expect.objectContaining({ level: "warn", event: "request.rejected", reason: "nothing_to_hand_over" }));
    expect(r.status).toBe(400);
    expect(r.json).toMatchObject({ error: expect.any(String), rid: expect.any(String) });
    expect(r.emails).toHaveLength(0);
    expect(r.leads).toHaveLength(0);
    expect(r.sheetRows).toHaveLength(0);
  });

  it("treats a blank summary and blank contact fields as nothing", async () => {
    const r = await invokeEdge("escalate-to-human", { reason: "user_request", summary: "  \n ", name: " ", phone: "", email: null });
    expect(r.status).toBe(400);
    expect(r.emails).toHaveLength(0);
  });

  it("still takes a summary with no way to reach the visitor: an anonymous hand-off is real", async () => {
    const r = await invokeEdge("escalate-to-human", { reason: "user_request", summary: "רוצה לדבר עם אדם" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, notified: true, recorded: false });
    expect(r.emails.length).toBeGreaterThan(0);
  });

  it("still takes contact details with no summary", async () => {
    const r = await invokeEdge("escalate-to-human", { name: "דנה", phone: "0501234567" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, notified: true, recorded: true });
  });

  it("holds back the staff mail over the hourly cap, and still records the hand-off", async () => {
    const { result: r, lines } = await withLogs(() => invokeEdge("escalate-to-human", handoff, { overLimit: ["escalate:notify"] }));
    // An error, so it alerts (review 2026-10-15).
    expect(lines).toContainEqual(expect.objectContaining({ level: "error", event: "mail.skipped", reason: "rate_limited" }));
    expect(r.status).toBe(200);
    expect(r.emails).toHaveLength(0);
    expect(r.json).toMatchObject({ ok: true, notified: false, recorded: true });
    expect(r.json.warnings).toContain("notify_rate_limited");
    expect(r.leads).toHaveLength(1);
    expect(r.sheetRows).toHaveLength(1);
  });

  it.each(["complaint", "privacy_request"])("never holds back an urgent hand-off (%s), whatever the caps say", async (reason) => {
    const r = await invokeEdge("escalate-to-human", { ...handoff, reason }, {
      headers: { "x-forwarded-for": "203.0.113.9" },
      overLimit: ["escalate:notify", "escalate-ip:"],
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, notified: true });
    expect(r.emails.length).toBeGreaterThan(0);
  });

  it("refuses a caller over the hourly hand-off limit, for a reason that is not urgent, writing nothing", async () => {
    const r = await invokeEdge("escalate-to-human", handoff, { headers: { "x-forwarded-for": "203.0.113.9" }, overLimit: ["escalate-ip:"] });
    expect(r.status).toBe(429);
    expect(r.json.rid).toBeTruthy();
    expect(r.leads).toHaveLength(0);
    expect(r.emails).toHaveLength(0);
    const key = r.fetches.find((f) => String((f.body as { p_key?: string })?.p_key ?? "").startsWith("escalate-ip:"));
    expect(String((key!.body as { p_key: string }).p_key)).toMatch(/^escalate-ip:[0-9a-f]{64}$/);
  });

  it.each([
    ["name", "x".repeat(81)],
    ["phone", "0".repeat(31)],
    ["topic", "x".repeat(201)],
    ["agent", "x".repeat(61)],
    ["email", `${"a".repeat(250)}@x.co`],
  ])("refuses a %s longer than its ceiling, writing and mailing nothing", async (field, value) => {
    const r = await invokeEdge("escalate-to-human", { ...handoff, [field]: value });
    expect(r.status).toBe(400);
    expect(r.leads).toHaveLength(0);
    expect(r.emails).toHaveLength(0);
  });

  it("drops an address that is not one, and still hands over", async () => {
    const r = await invokeEdge("escalate-to-human", { ...handoff, email: "dana@example.com\nbcc: victim@example.com" });
    expect(r.status).toBe(200);
    expect(r.json.warnings).toContain("email_invalid");
    expect(r.leads[0].email).toBe("");
    expect(r.emails.some((e) => e.to.includes("victim") || e.text?.includes("victim"))).toBe(false);
  });

  it("mails staff when the limiter is unreachable: it fails open", async () => {
    const r = await invokeEdge("escalate-to-human", handoff, { failLimiter: 500 });
    expect(r.json).toMatchObject({ ok: true, notified: true });
    expect(r.emails.length).toBeGreaterThan(0);
    expect(r.json.warnings).not.toContain("notify_rate_limited");
  });

  it("counts one hand-off once, not once per recipient", async () => {
    const r = await invokeEdge("escalate-to-human", handoff);
    const checks = r.fetches.filter((f) => f.url.endsWith("/rpc/allow_submission"));
    expect(checks).toHaveLength(1);
    expect(checks[0].body).toMatchObject({ p_key: "escalate:notify", p_window_seconds: 3600, p_max: 60 });
  });
});
