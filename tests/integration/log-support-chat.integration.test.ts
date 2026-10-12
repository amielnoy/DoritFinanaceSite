import { describe, expect, it } from "vitest";
import { invokeFunction, MAILER_URL } from "../helpers/base44-function";
import { invokeEdge } from "../helpers/edge-function";

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
 *
 * Two implementations answer these cases while both are deployed: Base44's
 * `logSupportChat` and its Supabase Edge port `log-support-chat`. A case that
 * holds for one must hold for the other; what only the port does is at the end.
 */

const ENV = { MAILER_URL, MAILER_TOKEN: "test-only-token", SHEET_ID: "sheet-1" };

interface Outcome {
  status: number;
  json: Record<string, unknown>;
  /** The sheet appends the function made, as the tab and the cells it sent. */
  rows: { tab: string; row: string[] }[];
  emails: unknown[];
  leads: unknown[];
}
interface Knobs {
  /** The spreadsheet is not configured. */
  noSheet?: boolean;
  /** The sheet append is refused with a 500. */
  failSheet?: boolean;
}

const IMPLEMENTATIONS = [
  {
    label: "Base44 logSupportChat",
    async run(body: unknown, k: Knobs = {}): Promise<Outcome> {
      const env = k.noSheet ? { MAILER_URL, MAILER_TOKEN: "test-only-token" } : ENV;
      const r = await invokeFunction("logSupportChat", body, { env, ...(k.failSheet ? { fetchStatus: 500 } : {}) });
      const rows = r.callsTo("sheets.googleapis.com").map((c) => ({
        tab: /values\/([^!]+)!A:G/.exec(decodeURIComponent(c.url))?.[1] ?? "",
        row: (c.body as { values: string[][] }).values[0],
      }));
      return { status: r.status, json: r.json, rows, emails: r.emails, leads: r.leads };
    },
  },
  {
    label: "Edge log-support-chat",
    async run(body: unknown, k: Knobs = {}): Promise<Outcome> {
      const r = await invokeEdge("log-support-chat", body, {
        ...(k.noSheet ? { envPatch: { SHEET_ID: null } } : {}),
        ...(k.failSheet ? { failGoogle: "sheets" as const } : {}),
      });
      return { status: r.status, json: r.json, rows: r.sheetRows as Outcome["rows"], emails: r.emails, leads: r.leads };
    },
  },
];

const chat = (fields: Record<string, unknown> = {}) => ({
  channel: "site",
  topic: "דמי ניהול",
  transcript: "שאל מה הם דמי ניהול · הסברתי והפניתי למאמר",
  outcome: "answered",
  messageCount: 4,
  ...fields,
});

describe.each(IMPLEMENTATIONS)("$label — the row", ({ run }) => {
  it("writes the conversation to the support tab", async () => {
    const r = await run(chat());
    const [append] = r.rows;
    expect(append.tab).toBe("Support");
    expect(append.row.slice(1)).toEqual([
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
      const r = await run(chat({ outcome }));
      expect(r.rows[0].row[4], outcome).toBe(expected);
    }
  });

  it("keeps the WhatsApp number in the same shape the contact list uses", async () => {
    // Both tabs are keyed on a phone number, and a row that cannot be matched
    // to the contact it belongs to is a row nobody can follow up.
    const r = await run(chat({ channel: "whatsapp", phone: "972501234567" }));
    // `'` forces Sheets to keep this as text; see the note in `appendEventRow`.
    // Without it the leading zero is lost to numeric coercion.
    expect(r.rows[0].row[2]).toBe("'0501234567");
  });

  it("leaves the number empty for the site chat, which has none", async () => {
    const r = await run(chat());
    expect(r.rows[0].row[2]).toBe("");
  });

  it("falls back to the site channel rather than storing what it was told", async () => {
    const r = await run(chat({ channel: "sms" }));
    expect(r.rows[0].row[1]).toBe("site");
  });
});

describe.each(IMPLEMENTATIONS)("$label — restraint", ({ run }) => {
  it("strips identifiers out of the transcript", async () => {
    // Rule 3 says the agent must not repeat sensitive data back. This is the
    // same rule applied to the copy nobody reads until months later.
    const r = await run(chat({ transcript: 'שלח ת"ז 123456789 ומספר פוליסה 4580111122223333' }));
    const row = r.rows[0].row[6];
    expect(row).not.toContain("123456789");
    expect(row).not.toContain("4580111122223333");
  });

  it("stores a conversation, not an archive of one", async () => {
    // A cell holds far more than this, and the cap is `redact`'s own — the
    // limit is proportionality rather than storage: a support chat kept in
    // full, forever, collects more than the stated purpose needs.
    const r = await run(chat({ transcript: "א".repeat(9000) }));
    expect(r.rows[0].row[6]).toHaveLength(2000);
  });

  it("writes nothing when there is nothing to write", async () => {
    const r = await run({ channel: "site", outcome: "abandoned" });
    expect(r.status).toBe(400);
    expect(r.rows).toHaveLength(0);
  });

  it("sends no mail and creates no record", async () => {
    const r = await run(chat());
    expect(r.emails).toHaveLength(0);
    expect(r.leads).toHaveLength(0);
  });
});

describe.each(IMPLEMENTATIONS)("$label — failure", ({ run }) => {
  it("never makes a failed write the visitor's problem", async () => {
    // The agent is told not to report this call. So it has to answer in a way
    // that gives it nothing to report: the conversation already happened.
    const r = await run(chat(), { failSheet: true });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.sheet).toBe("נכשל");
    // The reason in brackets is the sheet client's own wording, which differs
    // between the two (`sheets 500` / `sheets_http_500`); the label does not.
    expect(r.json.warnings).toEqual([expect.stringMatching(/^sheet_append_failed \(sheets[ _](http_)?500\)$/)]);
  });

  it("skips quietly when no spreadsheet is configured", async () => {
    const r = await run(chat(), { noSheet: true });
    expect(r.status).toBe(200);
    expect(r.json.sheet).toBe("לא מוגדר");
    expect(r.rows).toHaveLength(0);
  });
});

// Base44 only: the connector's authorisation is Base44's own state. The Edge
// function has no connector — it signs in as the service account — so there is
// nothing to leave unauthorised (spec: connectors off Base44).
describe("Base44 logSupportChat — connector not authorised", () => {
  it("does not stall the chat when the connector is not authorised", async () => {
    const run = await invokeFunction("logSupportChat", chat(), {
      env: ENV,
      connections: { googlesheets: null },
    });
    expect(run.status).toBe(200);
    expect(run.json.sheet).toBe("אין חיבור");
  });
});

// What only the port does: the row goes in through the service account.
describe("Edge log-support-chat — what only it does", () => {
  it("appends to the Support tab through the service account", async () => {
    const r = await invokeEdge("log-support-chat", {
      channel: "site",
      phone: "0501234567",
      topic: "שאלה",
      transcript: "שלום",
      outcome: "answered",
      messageCount: 3,
    });
    expect(r.json).toMatchObject({ ok: true });
    expect(r.sheetRows).toEqual([{ tab: "Support", row: expect.arrayContaining(["site", "'0501234567", "שאלה"]) }]);
  });

  it("answers ok with a failed sheet when the service account cannot sign in", async () => {
    const r = await invokeEdge("log-support-chat", { topic: "שאלה" }, { failGoogle: "token" });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, sheet: "נכשל" });
  });

  it("answers the preflight", async () => {
    const r = await invokeEdge("log-support-chat", null, { method: "OPTIONS" });
    expect(r.status).toBe(204);
  });
});
