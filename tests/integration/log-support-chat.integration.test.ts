import { describe, expect, it } from "vitest";
import { invokeFunction, MAILER_URL } from "../helpers/base44-function";

/**
 * `logSupportChat`, executed.
 *
 * The support agent answers the same questions over and over, and nothing until
 * now recorded which ones. The event log says someone got in touch; the contact
 * list says who they are; neither says what was actually asked, which is the
 * only one of the three that can tell Dorit what to write next or where the
 * agent keeps stopping.
 *
 * Recording a conversation is also the most intrusive thing on this site, so
 * the tests below are mostly about restraint: what gets stripped before it is
 * written, how much is kept, and the fact that a failed write is never allowed
 * to become the visitor's problem.
 */

const ENV = { MAILER_URL, MAILER_TOKEN: "test-only-token", SHEET_ID: "sheet-1" };

const chat = (fields: Record<string, unknown> = {}) => ({
  channel: "site",
  topic: "דמי ניהול",
  transcript: "שאל מה הם דמי ניהול · הסברתי והפניתי למאמר",
  outcome: "answered",
  messageCount: 4,
  ...fields,
});

describe("logSupportChat — the row", () => {
  it("writes the conversation to the support tab", async () => {
    const run = await invokeFunction("logSupportChat", chat(), { env: ENV });
    const [append] = run.callsTo("sheets.googleapis.com");
    expect(decodeURIComponent(append.url)).toContain("Support!A:G");
    expect((append.body as { values: string[][] }).values[0].slice(1)).toEqual([
      "site",
      "",
      "דמי ניהול",
      "נענה",
      "4",
      "שאל מה הם דמי ניהול · הסברתי והפניתי למאמר",
    ]);
  });

  it("records the outcome in words, from a fixed list", async () => {
    // The outcome is the column anyone will filter on, so it cannot be free
    // text the model phrases differently each time.
    const outcomes = {
      answered: "נענה",
      escalated: "הועבר לדורית",
      referred_to_interview: "הופנה לראיון היכרות",
      abandoned: "נקטע",
      "made up by the model": "לא ידוע",
    };
    for (const [outcome, expected] of Object.entries(outcomes)) {
      const run = await invokeFunction("logSupportChat", chat({ outcome }), { env: ENV });
      const [append] = run.callsTo("sheets.googleapis.com");
      expect((append.body as { values: string[][] }).values[0][4], outcome).toBe(expected);
    }
  });

  it("keeps the WhatsApp number in the same shape the contact list uses", async () => {
    // Both tabs are keyed on a phone number, and a row that cannot be matched
    // to the contact it belongs to is a row nobody can follow up.
    const run = await invokeFunction(
      "logSupportChat",
      chat({ channel: "whatsapp", phone: "972501234567" }),
      { env: ENV },
    );
    const [append] = run.callsTo("sheets.googleapis.com");
    expect((append.body as { values: string[][] }).values[0][2]).toBe("0501234567");
  });

  it("leaves the number empty for the site chat, which has none", async () => {
    const run = await invokeFunction("logSupportChat", chat(), { env: ENV });
    const [append] = run.callsTo("sheets.googleapis.com");
    expect((append.body as { values: string[][] }).values[0][2]).toBe("");
  });

  it("falls back to the site channel rather than storing what it was told", async () => {
    const run = await invokeFunction("logSupportChat", chat({ channel: "sms" }), { env: ENV });
    const [append] = run.callsTo("sheets.googleapis.com");
    expect((append.body as { values: string[][] }).values[0][1]).toBe("site");
  });
});

describe("logSupportChat — restraint", () => {
  it("strips identifiers out of the transcript", async () => {
    // Rule 3 says the agent must not repeat sensitive data back. This is the
    // same rule applied to the copy nobody reads until months later.
    const run = await invokeFunction(
      "logSupportChat",
      chat({ transcript: 'שלח ת"ז 123456789 ומספר פוליסה 4580111122223333' }),
      { env: ENV },
    );
    const [append] = run.callsTo("sheets.googleapis.com");
    const row = (append.body as { values: string[][] }).values[0][6];
    expect(row).not.toContain("123456789");
    expect(row).not.toContain("4580111122223333");
  });

  it("stores a conversation, not an archive of one", async () => {
    // A cell holds far more than this, and the cap is `redact`'s own — the
    // limit is proportionality rather than storage: a support chat kept in
    // full, forever, collects more than the stated purpose needs.
    const run = await invokeFunction(
      "logSupportChat",
      chat({ transcript: "א".repeat(9000) }),
      { env: ENV },
    );
    const [append] = run.callsTo("sheets.googleapis.com");
    expect((append.body as { values: string[][] }).values[0][6]).toHaveLength(2000);
  });

  it("writes nothing when there is nothing to write", async () => {
    const run = await invokeFunction(
      "logSupportChat",
      { channel: "site", outcome: "abandoned" },
      { env: ENV },
    );
    expect(run.status).toBe(400);
    expect(run.callsTo("sheets.googleapis.com")).toHaveLength(0);
  });

  it("sends no mail and creates no record", async () => {
    const run = await invokeFunction("logSupportChat", chat(), { env: ENV });
    expect(run.emails).toHaveLength(0);
    expect(run.leads).toHaveLength(0);
  });
});

describe("logSupportChat — failure", () => {
  it("never makes a failed write the visitor's problem", async () => {
    // The agent is told not to report this call. So it has to answer in a way
    // that gives it nothing to report: the conversation already happened.
    const run = await invokeFunction("logSupportChat", chat(), { env: ENV, fetchStatus: 500 });
    expect(run.status).toBe(200);
    expect(run.json.ok).toBe(true);
    expect(run.json.sheet).toBe("נכשל");
    expect(run.json.warnings).toContain("sheet_append_failed (sheets 500)");
  });

  it("skips quietly when no spreadsheet is configured", async () => {
    const run = await invokeFunction("logSupportChat", chat(), {
      env: { MAILER_URL, MAILER_TOKEN: "test-only-token" },
    });
    expect(run.status).toBe(200);
    expect(run.json.sheet).toBe("לא מוגדר");
    expect(run.callsTo("sheets.googleapis.com")).toHaveLength(0);
  });

  it("does not stall the chat when the connector is not authorised", async () => {
    const run = await invokeFunction("logSupportChat", chat(), {
      env: ENV,
      connections: { googlesheets: null },
    });
    expect(run.status).toBe(200);
    expect(run.json.sheet).toBe("אין חיבור");
  });
});
