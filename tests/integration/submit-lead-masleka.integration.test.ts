import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { invokeEdge, type EdgeInvocation, type EdgeOptions } from "../helpers/edge-function";

/**
 * What only the Edge submit-lead does for the clearinghouse (PR A): with
 * MASLEKA_ENABLED on, an interview that answered "מעוניין/ת" gets a request,
 * and the one confirmation it already receives carries the personal /masleka
 * link as an https button (Ruling 13) where the mandate link was — one mail,
 * not two (Ruling 21). Off, nothing changes — byte for byte, pinned below
 * against the output this function produced before the pipeline existed.
 */
const AGENCY_1 = "00000000-0000-0000-0000-000000000001";
const POA = "https://example.test/poa.pdf";
const ON = { MASLEKA_ENABLED: "true" };
const STAFF = ["dorit@govari-fin.co.il", "amielnoy@gmail.com", "amielnoy@outlook.com"];
const LINK = /https:\/\/govari-fin\.co\.il\/masleka#t=([A-Za-z0-9_-]{43})/;
const CONFIRM_SUBJECT = "אישור — קיבלנו את סיכום השיחה · דורית גוב ארי";
const base = {
  name: "אורי לוי",
  phone: "0541112233",
  email: "uri@example.com",
  source: "interview",
  topic: "דמי ניהול בקרן ההשתלמות",
  track: "pension",
};
const interested = { ...base, profile: { clearinghouse: "מעוניין/ת" } };
const declined = { ...base, profile: { clearinghouse: "לא" } };
/** An interested interview that agreed a time, so the calendar runs too. */
const booked = { ...interested, scheduledAt: "2026-11-02T10:00" };
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

const run = (body: unknown, envPatch: Record<string, string | null> = {}, extra: EdgeOptions = {}) =>
  invokeEdge("submit-lead", body, { ...extra, envPatch: { POA_URL: POA, ...envPatch } });

/** Every mail the visitor received. */
const toVisitor = (r: EdgeInvocation, address = base.email) => r.emails.filter((e) => e.to === address);
/** The visitor's only mail: the confirmation. Fails unless there is exactly one. */
const confirmation = (r: EdgeInvocation) => {
  const found = toVisitor(r);
  expect(found, "exactly one mail to the visitor").toHaveLength(1);
  expect(found[0].subject).toBe(CONFIRM_SUBJECT);
  return found[0];
};

/** One run with the console captured: the log lines as parsed objects, and the raw text. */
async function withLogs(body: unknown, envPatch: Record<string, string | null> = {}, extra: EdgeOptions = {}) {
  const lines: string[] = [];
  const spies = (["log", "warn", "error"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((s: unknown) => {
      lines.push(String(s));
    }),
  );
  try {
    const r = await run(body, envPatch, extra);
    return { r, lines };
  } finally {
    for (const s of spies) s.mockRestore();
  }
}

/**
 * Everything a run shows the world, made comparable: the answer without its
 * random rid, every mail as recipient, subject and the hash of each half, and
 * every log line without its time, rid and duration. Mails and lines are
 * sorted because the sheet and the calendar run concurrently. The clock is
 * fixed, because the staff copies print the time they were sent.
 */
async function fingerprint(body: unknown, envPatch: Record<string, string | null>) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T09:00:00Z"));
  try {
    const { r, lines } = await withLogs(body, envPatch);
    const short = (t: string) => sha(t).slice(0, 16);
    const { rid: _rid, ...json } = r.json;
    return {
      status: r.status,
      json,
      mails: r.emails
        .map((e) => `${e.to} | ${e.subject} | html:${short(e.html ?? "")} text:${short(e.text ?? "")} ics:${e.ics ? "yes" : "-"}`)
        .sort(),
      logs: lines
        .map((l) => {
          const { t: _t, rid: _r, ms: _m, fn: _f, level, event, ...rest } = JSON.parse(l);
          return `${level} ${event} ${JSON.stringify(rest)}`;
        })
        .sort(),
      maslekaCalls: r.callsTo("masleka").length,
    };
  } finally {
    vi.useRealTimers();
  }
}

/**
 * What submit-lead produced for these three interviews before Task 12 touched
 * it (captured from commit 733c9bd with the clock and fixtures above). A
 * switched-off pipeline must reproduce it exactly: the same mails, byte for
 * byte, the same answer and the same log lines.
 */
const LEAD = "00000000-0000-4000-8000-000000000001";
const SHEET = '"tab":"Events","status":"נרשם ✓ — https://docs.google.com/spreadsheets/d/sheet-test/edit"';
const commonLogs = [
  'info lead.created {"leadId":"' + LEAD + '","source":"interview"}',
  'info lead.resolved {"source":"interview","track":"pension","stage":"complete","upsert":false}',
  'info mail.sent {"role":"agency","transport":"mailer"}',
  'info mail.sent {"role":"ops","transport":"mailer"}',
  'info mail.sent {"role":"ops","transport":"mailer"}',
  'info mail.sent {"role":"visitor","transport":"mailer"}',
  'info request.end {"leadId":"' + LEAD + '","source":"interview","warnings":0}',
  "info request.start {}",
  `info sheet.appended {${SHEET}}`,
];
const answer = { ok: true, leadId: LEAD, warnings: [] };
const TODAY = {
  booked: {
    status: 200,
    json: answer,
    mails: [
      "amielnoy@gmail.com | הזמנה: סיכום ראיון היכרות — אורי לוי | html:e3b0c44298fc1c14 text:a2d72e70a532e5c2 ics:yes",
      "amielnoy@gmail.com | סיכום ראיון היכרות — אורי לוי | html:5a024926f3d7d36a text:aab5545db2cf0164 ics:-",
      "amielnoy@outlook.com | הזמנה: סיכום ראיון היכרות — אורי לוי | html:e3b0c44298fc1c14 text:a2d72e70a532e5c2 ics:yes",
      "amielnoy@outlook.com | סיכום ראיון היכרות — אורי לוי | html:5a024926f3d7d36a text:aab5545db2cf0164 ics:-",
      "dorit@govari-fin.co.il | הזמנה: סיכום ראיון היכרות — אורי לוי | html:e3b0c44298fc1c14 text:a2d72e70a532e5c2 ics:yes",
      "dorit@govari-fin.co.il | סיכום ראיון היכרות — אורי לוי | html:75ee6c82b0f36d50 text:495f18d212660c37 ics:-",
      "uri@example.com | אישור — קיבלנו את סיכום השיחה · דורית גוב ארי | html:77a84198865c003e text:08969448b0f14f10 ics:-",
    ],
    logs: [
      'info calendar.created {"provider":"google"}',
      ...commonLogs,
      'info mail.sent {"role":"invite","transport":"mailer"}',
      'info mail.sent {"role":"invite","transport":"mailer"}',
      'info mail.sent {"role":"invite","transport":"mailer"}',
    ].sort(),
    maslekaCalls: 0,
  },
  declined: {
    status: 200,
    json: answer,
    mails: [
      "amielnoy@gmail.com | סיכום ראיון היכרות — אורי לוי | html:e832bb791ca3b830 text:24510590f61d1ec2 ics:-",
      "amielnoy@outlook.com | סיכום ראיון היכרות — אורי לוי | html:e832bb791ca3b830 text:24510590f61d1ec2 ics:-",
      "dorit@govari-fin.co.il | סיכום ראיון היכרות — אורי לוי | html:5e8de04bbc52701e text:d96cf311e2411337 ics:-",
      "uri@example.com | אישור — קיבלנו את סיכום השיחה · דורית גוב ארי | html:e1959abe07019c46 text:7b76f503c5bdfee7 ics:-",
    ],
    logs: [...commonLogs].sort(),
    maslekaCalls: 0,
  },
  unasked: {
    status: 200,
    json: answer,
    mails: [
      "amielnoy@gmail.com | סיכום ראיון היכרות — אורי לוי | html:8976c20db3d9fca6 text:72549e6708003322 ics:-",
      "amielnoy@outlook.com | סיכום ראיון היכרות — אורי לוי | html:8976c20db3d9fca6 text:72549e6708003322 ics:-",
      "dorit@govari-fin.co.il | סיכום ראיון היכרות — אורי לוי | html:89d377e400b0d30d text:88ddf0fbdc72c757 ics:-",
      "uri@example.com | אישור — קיבלנו את סיכום השיחה · דורית גוב ארי | html:e1959abe07019c46 text:7b76f503c5bdfee7 ics:-",
    ],
    logs: [...commonLogs].sort(),
    maslekaCalls: 0,
  },
};
/** Values that are not exactly "true" once trimmed, so the pipeline stays off. */
const OFF: Record<string, string | null>[] = [
  { MASLEKA_ENABLED: null },
  { MASLEKA_ENABLED: "" },
  { MASLEKA_ENABLED: "false" },
  { MASLEKA_ENABLED: "TRUE" },
  { MASLEKA_ENABLED: "1" },
  { MASLEKA_ENABLED: "yes" },
  { MASLEKA_ENABLED: "true1" },
];

describe("submit-lead — dark: today's lead path while MASLEKA_ENABLED is off", () => {
  it("answers, mails and logs an interested interview exactly as before the pipeline, whatever the off value", async () => {
    for (const off of OFF) {
      expect(await fingerprint(booked, off), JSON.stringify(off)).toEqual(TODAY.booked);
    }
  });

  it("answers, mails and logs a declined or unasked interview exactly as before the pipeline", async () => {
    const unasked = { ...base, profile: { life_stage: "בן 52" } };
    for (const off of [OFF[0], OFF[2]]) {
      expect(await fingerprint(declined, off), JSON.stringify(off)).toEqual(TODAY.declined);
      expect(await fingerprint(unasked, off), JSON.stringify(off)).toEqual(TODAY.unasked);
    }
  });

  it("keeps today's mandate mail, and creates no request, while the switch is off", async () => {
    const r = await run(interested);
    expect(r.callsTo("masleka_requests")).toHaveLength(0);
    expect(toVisitor(r)).toHaveLength(1);
    expect(r.mailTo(base.email).text).toContain(POA);
    expect(r.mailTo(base.email).html).toContain(POA);
  });
});

describe("submit-lead — the clearinghouse request, with the switch on", () => {
  it("creates a request for an interview that asked for the pull, and its one confirmation carries the link as a button instead of the mandate", async () => {
    const r = await run(interested, ON);
    expect(r.status).toBe(200);
    expect(r.maslekaRequests).toHaveLength(1);
    const row = r.maslekaRequests[0];
    expect(row).toMatchObject({
      agency_id: AGENCY_1,
      status: "invited",
      client_name: "אורי לוי",
      contact_email: base.email,
      lead_id: r.leads[0].id,
      created_by: null,
    });

    const mail = confirmation(r);
    const token = mail.text!.match(LINK)![1];
    const link = `https://govari-fin.co.il/masleka#t=${token}`;
    expect(row.token_hash).toBe(sha(token));
    // Ruling 13's https button, in the HTML half; the plain link in the text half.
    expect(mail.html).toContain(`<a href="${link}"`);
    expect(mail.text).toContain(link);
    for (const half of [mail.html!, mail.text!]) expect(half).not.toContain(POA);
    expect(row.client_invited_at).toEqual(expect.any(String));
  });

  it("says nothing about the clearinghouse to a visitor who declined", async () => {
    const r = await run(declined, ON);
    expect(r.maslekaRequests).toHaveLength(0);
    expect(r.callsTo("masleka_requests")).toHaveLength(0);
    const mail = confirmation(r);
    expect(mail.text).not.toContain("masleka#t=");
    expect(mail.html).not.toContain("masleka#t=");
    expect(mail.text).not.toContain("מסלקה");
  });

  it("creates nothing for an interview that is still partial", async () => {
    const r = await run({ ...interested, stage: "partial" }, ON);
    expect(r.callsTo("masleka_requests")).toHaveLength(0);
    expect(r.emails).toHaveLength(0);
  });

  it("falls back to the mandate when the request cannot be created, and the lead, the staff copies and the calendar still happen", async () => {
    const r = await run(booked, ON, { masleka: { failRequestWrite: true } });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.warnings).toContain("masleka_request_failed");
    expect(r.leads).toHaveLength(1);
    expect(r.calendarEvents).toHaveLength(1);
    for (const to of STAFF) expect(r.emails.some((e) => e.to === to && !e.ics), to).toBe(true);
    const mail = confirmation(r);
    expect(mail.text).toContain(POA);
    expect(mail.html).toContain(POA);
    expect(mail.text).not.toContain("masleka#t=");
    expect(mail.html).not.toContain("masleka#t=");
  });

  it("leaves the request not invited when the confirmation carrying the link cannot be sent, and the lead still lands", async () => {
    const r = await run(booked, ON, { failEmailTo: [base.email] });
    expect(r.status).toBe(200);
    expect(r.json.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/^client_confirmation_failed/)]));
    expect(r.maslekaRequests).toHaveLength(1);
    expect(r.maslekaRequests[0].client_invited_at).toBeNull();
    expect(r.requestPatches).toHaveLength(0);
    expect(r.leads).toHaveLength(1);
    expect(r.calendarEvents).toHaveLength(1);
    for (const to of STAFF) expect(r.emails.some((e) => e.to === to && !e.ics), to).toBe(true);
  });

  it("still answers 200 when the confirmation went out but could not be marked", async () => {
    const { r, lines } = await withLogs(interested, ON, { masleka: { failPatchMatching: "id=eq." } });
    expect(r.status).toBe(200);
    expect(confirmation(r).text).toMatch(LINK);
    expect(r.maslekaRequests[0].client_invited_at).toBeNull();
    expect(r.json.warnings).toContain("masleka_invite_mark_failed");
    expect(lines.some((l) => l.includes('"masleka.invite_mark_failed"'))).toBe(true);
  });

  it("never takes the link from the request body", async () => {
    // Ruling 5: the visitor is interested, so a link is rendered and the assertion bites.
    const body = { ...interested, maslekaLink: "https://evil.example/x", link: "https://evil.example/y", maslekaInvited: true };
    for (const envPatch of [{}, ON]) {
      const r = await run(body, envPatch);
      for (const e of r.emails) expect(`${e.html}${e.text}`, JSON.stringify(envPatch)).not.toContain("evil.example");
    }
    const on = await run(body, ON);
    expect(confirmation(on).text).toMatch(LINK);
    const off = await run(body);
    expect(confirmation(off).text, "the off path reads nothing from the body").toContain(POA);
  });

  it("creates the request without mailing when there is no address, or none that is one", async () => {
    for (const email of ["", "not-an-address"]) {
      const r = await run({ ...interested, email }, ON);
      expect(r.maslekaRequests, email).toHaveLength(1);
      expect(r.maslekaRequests[0]).toMatchObject({ contact_email: null, client_invited_at: null });
      expect(r.emails.filter((e) => !STAFF.includes(e.to)), email).toHaveLength(0);
    }
  });

  it("sends no link to an address over its daily confirmation limit", async () => {
    const r = await run(interested, ON, { overLimit: ["confirm-to:"] });
    expect(r.status).toBe(200);
    expect(r.maslekaRequests).toHaveLength(1);
    expect(r.maslekaRequests[0].client_invited_at).toBeNull();
    expect(toVisitor(r)).toHaveLength(0);
  });

  it("puts the link only in the client's confirmation — never in a log line, the answer or a staff copy", async () => {
    const { r, lines } = await withLogs(booked, ON);
    const token = confirmation(r).text!.match(LINK)![1];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(token);
      expect(line).not.toContain("masleka#t=");
      expect(JSON.parse(line).rid).toEqual(expect.any(String));
    }
    expect(lines.some((l) => l.includes('"masleka.request_created"'))).toBe(true);
    expect(JSON.stringify(r.json)).not.toContain(token);
    const others = r.emails.filter((e) => e.to !== base.email);
    expect(others.length).toBeGreaterThan(1);
    for (const e of others) expect(`${e.html}${e.text}${e.ics ?? ""}`, e.to).not.toContain(token);
  });

  it("keeps the answer's shape: ok, rid, leadId and warnings, nothing more", async () => {
    for (const extra of [{}, { masleka: { failRequestWrite: true } }]) {
      const r = await run(interested, ON, extra);
      expect(Object.keys(r.json).sort()).toEqual(["leadId", "ok", "rid", "warnings"]);
    }
  });
});
