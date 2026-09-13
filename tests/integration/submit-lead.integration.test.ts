import { describe, expect, it } from "vitest";
import { invokeFunction } from "../helpers/base44-function";

/**
 * `submitLead`, executed.
 *
 * Every form on the site and the booking agent all land here, so this one
 * function decides what is stored, who is told, what each of them sees, and
 * what survives a failure. The contract and security suites assert things
 * about its *source*; these run it and look at what came out.
 *
 * The difference is not academic. A source check confirms `escapeHtml(` sits
 * next to `firstName`. It cannot tell you whether the escaped value actually
 * reached the HTML, whether the plain-text copy was escaped by mistake, or
 * whether a bounce to one recipient silently dropped the other two.
 */

const AGENCY = "dorit@govari-fin.co.il";
const OPS = "amielnoy@gmail.com";

const consultation = {
  name: "יעל כהן",
  phone: "0521234567",
  email: "yael@example.com",
  source: "consultation",
  topic: "גמל, השתלמות ופנסיה",
  timing: "השבוע הבא, בוקר",
  notes: "זמינה אחרי 16:00",
  summary: "ביקשה פגישה בנושא גמל והשתלמות. עברה מעביד לעצמאית השנה.",
};

describe("submitLead — the enquiry actually lands", () => {
  it("stores the lead, tells three people, and books the calendar", async () => {
    const r = await invokeFunction("submitLead", consultation);

    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, leadId: "LEAD-1", warnings: [] });

    expect(r.leads).toHaveLength(1);
    expect(r.leads[0]).toMatchObject({
      name: "יעל כהן",
      phone: "0521234567",
      source: "consultation",
      status: "new",
    });

    expect(r.emails.map((e) => e.to).sort()).toEqual([OPS, AGENCY, "yael@example.com"].sort());
    expect(r.callsTo("graph.microsoft.com")).toHaveLength(1);
  });

  it("pins the status rather than taking it from the caller", async () => {
    const r = await invokeFunction("submitLead", { ...consultation, status: "closed" });
    expect(r.leads[0].status).toBe("new");
  });

  it("gives the agency and the operations team the same details", async () => {
    const r = await invokeFunction("submitLead", consultation);
    for (const to of [AGENCY, OPS]) {
      const mail = r.mailTo(to);
      expect(mail.body, to).toContain("יעל כהן");
      expect(mail.body, to).toContain("0521234567");
      expect(mail.body, to).toContain("עברה מעביד לעצמאית השנה");
    }
  });

  it("adds the operational appendix only to the operations copy", async () => {
    const r = await invokeFunction("submitLead", consultation);
    expect(r.mailTo(OPS).body).toContain("מצב תפעולי");
    expect(r.mailTo(AGENCY).body).not.toContain("מצב תפעולי");
  });

  it("reports the calendar and sheet outcome in that appendix", async () => {
    const r = await invokeFunction("submitLead", consultation);
    const ops = r.mailTo(OPS).body!;
    expect(ops).toMatch(/יומן: אירוע נוצר/);
    // No spreadsheet is configured in this repo, so the append is skipped —
    // and says so, rather than reporting a success that never happened.
    expect(ops).toMatch(/גיליון: לא מוגדר/);
    expect(ops).toMatch(/תקלות: אין/);
  });

  it("sends the staff copies as plain text and the visitor's as HTML", async () => {
    const r = await invokeFunction("submitLead", consultation);
    expect(r.mailTo(AGENCY).html).toBeUndefined();
    expect(r.mailTo(OPS).html).toBeUndefined();
    expect(r.mailTo("yael@example.com").html).toContain("<table");
  });

  it("skips the visitor's confirmation when no address was given", async () => {
    const r = await invokeFunction("submitLead", { ...consultation, email: "" });
    expect(r.emails.map((e) => e.to).sort()).toEqual([OPS, AGENCY].sort());
    expect(r.status).toBe(200);
  });
});

describe("submitLead — a name that is really a payload", () => {
  const hostile = {
    ...consultation,
    name: '<a href="https://evil.example">לחצו כאן</a> כהן',
    topic: '<img src=x onerror="alert(1)">',
  };

  it("renders no live markup into the visitor's HTML mail", async () => {
    const r = await invokeFunction("submitLead", hostile);
    const html = r.mailTo("yael@example.com").html!;
    // The dangerous forms are an unescaped tag and a real quoted attribute.
    // `onerror=` surviving as *text* inside an escaped blob is harmless, so
    // asserting on the bare substring would only produce a test that fails
    // for the wrong reason.
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('onerror="');
    expect(html).not.toContain('<a href="https://evil.example"');
  });

  it("escapes it into something a mail client shows as text", async () => {
    const r = await invokeFunction("submitLead", hostile);
    const html = r.mailTo("yael@example.com").html!;
    // `topic` is interpolated whole, so it carries the full escaped tag.
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain("&quot;alert(1)&quot;");
    // `firstName` is name.split(' ')[0], so only the opening token reaches the
    // greeting — escaped all the same.
    expect(html).toContain("&lt;a");
  });

  it("leaves the plain-text staff copy unescaped, because it cannot render", async () => {
    // Escaping the text copy too would only make the staff email unreadable.
    // This pins the boundary: escaping belongs to the HTML builder alone.
    const r = await invokeFunction("submitLead", hostile);
    expect(r.mailTo(AGENCY).body).toContain('<a href="https://evil.example">');
  });

  it("stores the raw value, so the record matches what was submitted", async () => {
    const r = await invokeFunction("submitLead", hostile);
    expect(r.leads[0].name).toBe(hostile.name);
  });
});

describe("submitLead — identifiers a visitor volunteered", () => {
  it("strips an ID number from the summary before anyone receives it", async () => {
    const r = await invokeFunction("submitLead", {
      ...consultation,
      summary: "מסרה את ת״ז 123456789 בשיחה, ומספר כרטיס 4580 1234 5678 9012.",
    });
    for (const mail of r.emails) {
      expect(mail.body ?? "", mail.to).not.toContain("123456789");
      expect(mail.body ?? "", mail.to).not.toContain("4580");
    }
  });

  it("says why the text changed, rather than silently deleting", async () => {
    const r = await invokeFunction("submitLead", {
      ...consultation,
      summary: "ת״ז 123456789",
    });
    expect(r.mailTo(AGENCY).body).toContain("הושמט");
  });
});

describe("submitLead — what survives a failure", () => {
  it("refuses without a phone number, and writes nothing", async () => {
    const r = await invokeFunction("submitLead", { ...consultation, phone: "" });
    expect(r.status).toBe(400);
    expect(r.leads).toHaveLength(0);
    expect(r.emails).toHaveLength(0);
  });

  it("refuses without a name", async () => {
    const r = await invokeFunction("submitLead", { ...consultation, name: "" });
    expect(r.status).toBe(400);
  });

  it("fails loudly when the record cannot be written, and mails nobody", async () => {
    // The record is the enquiry. Mailing about a lead that was never stored
    // would leave the team chasing something with no row behind it.
    const r = await invokeFunction("submitLead", consultation, { failLeadWrite: true });
    expect(r.status).toBe(500);
    expect(r.emails).toHaveLength(0);
    expect(String(r.json.error)).toMatch(/לא הצלחנו לשמור/);
  });

  it("keeps the enquiry when a mailbox bounces, and still tells everyone else", async () => {
    const r = await invokeFunction("submitLead", consultation, { failEmailTo: [AGENCY] });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
    expect(r.json.warnings).toContain("secondary_email_failed");
    expect(r.emails.map((e) => e.to)).toContain(OPS);
    expect(r.emails.map((e) => e.to)).toContain("yael@example.com");
  });

  it("keeps the enquiry when the calendar refuses", async () => {
    const r = await invokeFunction("submitLead", consultation, { failFetch: true });
    expect(r.status).toBe(200);
    expect(r.json.warnings).toContain("calendar_event_failed");
    expect(r.leads).toHaveLength(1);
  });

  it("reports the calendar failure in the operations appendix", async () => {
    const r = await invokeFunction("submitLead", consultation, { failFetch: true });
    expect(r.mailTo(OPS).body).toMatch(/יומן: לא נוצר/);
    expect(r.mailTo(OPS).body).toMatch(/תקלות:.*calendar_event_failed/);
  });

  it("does not attempt a calendar event without a connector token", async () => {
    const r = await invokeFunction("submitLead", consultation, {
      connections: { outlook: null },
    });
    expect(r.callsTo("graph.microsoft.com")).toHaveLength(0);
    expect(r.status).toBe(200);
  });
});

describe("submitLead — the calendar event it books", () => {
  it("books nothing for a quick contact form", async () => {
    const r = await invokeFunction("submitLead", { ...consultation, source: "quick" });
    expect(r.callsTo("graph.microsoft.com")).toHaveLength(0);
    expect(r.mailTo(OPS).body).toMatch(/יומן: לא רלוונטי/);
  });

  it("honours an explicit scheduledAt", async () => {
    const r = await invokeFunction("submitLead", {
      ...consultation,
      scheduledAt: "2026-10-01T14:00:00",
    });
    const [call] = r.callsTo("graph.microsoft.com");
    const event = call.body as { start: { dateTime: string }; end: { dateTime: string } };
    expect(event.start.dateTime).toContain("2026-10-01");
    // Half an hour, not an open-ended hold on the diary.
    const minutes =
      (Date.parse(event.end.dateTime) - Date.parse(event.start.dateTime)) / 60000;
    expect(minutes).toBe(30);
  });

  it("falls back to tomorrow morning when no time was agreed", async () => {
    const r = await invokeFunction("submitLead", { ...consultation, scheduledAt: "" });
    const [call] = r.callsTo("graph.microsoft.com");
    const event = call.body as { start: { dateTime: string } };
    expect(event.start.dateTime).toMatch(/T09:00:00$/);
  });

  it("asks for a reminder and sets the Israel timezone", async () => {
    const r = await invokeFunction("submitLead", consultation);
    const [call] = r.callsTo("graph.microsoft.com");
    expect(call.body).toMatchObject({
      isReminderOn: true,
      start: { timeZone: "Israel Standard Time" },
    });
  });

  it("authorises with the connector token and never leaks it to the caller", async () => {
    const r = await invokeFunction("submitLead", consultation, {
      connections: { outlook: "secret-outlook-token" },
    });
    const [call] = r.callsTo("graph.microsoft.com");
    expect(call.headers.Authorization).toBe("Bearer secret-outlook-token");
    expect(JSON.stringify(r.json)).not.toContain("secret-outlook-token");
  });
});
