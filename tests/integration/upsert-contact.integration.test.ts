import { describe, expect, it } from "vitest";
import { invokeFunction, MAILER_URL } from "../helpers/base44-function";

/**
 * `upsertContact`, executed.
 *
 * WhatsApp is the reason this function exists, and it changes the shape of the
 * problem: on the site a visitor types a phone number into a field, once, in a
 * format the field enforces. Here the number arrives with the message, in
 * whatever form the channel hands over, from someone who may have written last
 * month under a different name and no email at all.
 *
 * So the two things worth testing are the two things that go wrong: the same
 * person becoming several rows because their number was spelled three ways, and
 * a second message erasing what the first one established.
 */

const ENV = { MAILER_URL, MAILER_TOKEN: "test-only-token", SHEET_ID: "sheet-1" };

const whatsapp = (fields: Record<string, unknown> = {}) => ({
  phone: "972501234567",
  channel: "whatsapp",
  ...fields,
});

describe("upsertContact — who the sender is", () => {
  it("creates a contact from the number the message arrived on", async () => {
    const run = await invokeFunction("upsertContact", whatsapp({ name: "יעל" }), { env: ENV });
    expect(run.status).toBe(200);
    expect(run.json.created).toBe(true);
    expect(run.leads[0]).toMatchObject({ phone: "0501234567", name: "יעל", channel: "whatsapp" });
  });

  it("treats the same person written three ways as one contact", async () => {
    // `972501234567` from WhatsApp, `050-123-4567` from the site, `+972 50…`
    // typed by hand. Three spellings, one person — and three rows would mean
    // Dorit calls someone she has already spoken to as though she has not.
    for (const spelling of ["972501234567", "050-123-4567", "+972 50 123 4567"]) {
      const run = await invokeFunction(
        "upsertContact",
        { phone: spelling, channel: "whatsapp" },
        { env: ENV },
      );
      expect(run.json.saved, spelling).toMatchObject({ phone: "0501234567" });
    }
  });

  it("updates rather than duplicates when the number is already known", async () => {
    const run = await invokeFunction("upsertContact", whatsapp({ email: "yael@example.com" }), {
      env: ENV,
      existingLeads: [{ id: "C-1", phone: "0501234567", name: "יעל" }],
    });
    expect(run.json.created).toBe(false);
    expect(run.leads, "created a second row for a known number").toHaveLength(0);
    expect(run.leadUpdates[0]).toMatchObject({
      id: "C-1",
      fields: { name: "יעל", email: "yael@example.com" },
    });
  });

  it("completes a known contact without erasing what is already there", async () => {
    // A second message that carries only a number must not blank the name the
    // first one established: an update is what was learned, not what was sent.
    const run = await invokeFunction("upsertContact", whatsapp(), {
      env: ENV,
      existingLeads: [{ id: "C-1", phone: "0501234567", name: "יעל", email: "yael@example.com" }],
    });
    expect(run.leadUpdates[0].fields).toMatchObject({
      name: "יעל",
      email: "yael@example.com",
    });
  });

  it("stamps last_seen on both paths so a quiet contact is visible", async () => {
    const created = await invokeFunction("upsertContact", whatsapp(), { env: ENV });
    const updated = await invokeFunction("upsertContact", whatsapp(), {
      env: ENV,
      existingLeads: [{ id: "C-1", phone: "0501234567" }],
    });
    expect(String(created.leads[0].last_seen)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(String(updated.leadUpdates[0].fields.last_seen)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("refuses a number that is not a number", async () => {
    for (const phone of ["", "12", "not-a-phone", undefined]) {
      const run = await invokeFunction("upsertContact", { phone, channel: "whatsapp" }, { env: ENV });
      expect(run.status, String(phone)).toBe(400);
    }
  });

  it("falls back to a fixed channel rather than storing what the caller sent", async () => {
    const run = await invokeFunction(
      "upsertContact",
      { phone: "0501234567", channel: "<script>" },
      { env: ENV },
    );
    expect(run.leads[0].channel).toBe("other");
  });

  it("creates rather than losing the contact when the lookup is down", async () => {
    // A failed search must not end with nobody recorded: a duplicate row is an
    // annoyance, a dropped enquiry is someone nobody calls back.
    const run = await invokeFunction("upsertContact", whatsapp(), {
      env: ENV,
      failLeadLookup: true,
    });
    expect(run.status).toBe(200);
    expect(run.leads).toHaveLength(1);
  });

  it("reports the failure when the write itself fails", async () => {
    const run = await invokeFunction("upsertContact", whatsapp(), {
      env: ENV,
      failLeadWrite: true,
    });
    expect(run.status).toBe(500);
    expect(run.json.ok).toBeUndefined();
  });
});

describe("upsertContact — what the agent reads back", () => {
  it("returns what was stored, not what was sent", async () => {
    // The agent is told to confirm details by reading `saved`. If that echoed
    // the request, it would confirm a number that is not the key anything was
    // filed under, and the confirmation would be theatre.
    const run = await invokeFunction("upsertContact", whatsapp({ name: "יעל" }), { env: ENV });
    expect(run.json.saved).toEqual({ phone: "0501234567", name: "יעל", email: "" });
  });
});

describe("upsertContact — privacy", () => {
  it("strips identifiers a person typed into WhatsApp before storing them", async () => {
    const run = await invokeFunction(
      "upsertContact",
      whatsapp({ notes: "ת\"ז 123456789 ופוליסה 4580111122223333" }),
      { env: ENV },
    );
    const notes = String(run.leads[0].notes);
    expect(notes).not.toContain("123456789");
    expect(notes).not.toContain("4580111122223333");
    expect(notes).toContain("[הושמט");
  });

  it("sends no mail at all", async () => {
    // Recording a contact is not an enquiry. If this notified anyone, every
    // "היי" on WhatsApp would reach Dorit's inbox.
    const run = await invokeFunction("upsertContact", whatsapp({ name: "יעל" }), { env: ENV });
    expect(run.emails).toHaveLength(0);
    expect(run.callsTo("send-email")).toHaveLength(0);
  });
});

describe("upsertContact — the contacts sheet", () => {
  it("appends a new contact to the Contacts tab", async () => {
    const run = await invokeFunction("upsertContact", whatsapp({ name: "יעל" }), { env: ENV });
    const [append] = run.callsTo("sheets.googleapis.com");
    expect(decodeURIComponent(append.url)).toContain("Contacts!A:F");
    expect((append.body as { values: string[][] }).values[0].slice(1)).toEqual([
      "0501234567",
      "יעל",
      "",
      "whatsapp",
      "",
    ]);
    expect(run.json.sheet).toBe("נרשם ✓");
  });

  it("writes the normalised number, the one the entity is keyed on", async () => {
    const run = await invokeFunction("upsertContact", whatsapp(), { env: ENV });
    const [append] = run.callsTo("sheets.googleapis.com");
    expect((append.body as { values: string[][] }).values[0][1]).toBe("0501234567");
  });

  it("does not add a row when a known contact sends another message", async () => {
    // The tab is the list of people. A row per message would make it a second
    // event log, and the event log already exists.
    const run = await invokeFunction("upsertContact", whatsapp(), {
      env: ENV,
      existingLeads: [{ id: "C-1", phone: "0501234567" }],
    });
    expect(run.callsTo("sheets.googleapis.com")).toHaveLength(0);
  });

  it("keeps the contact when the sheet refuses", async () => {
    const run = await invokeFunction("upsertContact", whatsapp(), {
      env: ENV,
      fetchStatus: 403,
    });
    expect(run.status).toBe(200);
    expect(run.leads).toHaveLength(1);
    expect(run.json.warnings).toContain("sheet_append_failed (sheets 403)");
  });

  it("skips the sheet quietly when none is configured", async () => {
    const run = await invokeFunction("upsertContact", whatsapp(), {
      env: { MAILER_URL, MAILER_TOKEN: "test-only-token" },
    });
    expect(run.status).toBe(200);
    expect(run.json.sheet).toBe("לא מוגדר");
    expect(run.callsTo("sheets.googleapis.com")).toHaveLength(0);
  });
});
