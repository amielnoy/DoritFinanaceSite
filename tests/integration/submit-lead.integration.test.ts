import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAILER_URL, invokeFunction, type EmailCall, type HarnessOptions } from "../helpers/base44-function";
import { invokeEdge, type EdgeOptions } from "../helpers/edge-function";
import { REPO_ROOT } from "../helpers/entity-schema";

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
 *
 * The Edge function `submit-lead` does the work; Base44's `submitLead` is a
 * forwarder to it (forwarders.integration.test.ts).
 */

/** Both harnesses' options. A case passes only knobs both understand, or takes them from `down`. */
type RunOptions = HarnessOptions & EdgeOptions;
type Result = Awaited<ReturnType<typeof invokeFunction>> & { invitations?: EmailCall[] };

/** Settings a case may give Base44's harness that the Edge function reads too. */
const SHARED_ENV = ["SHEET_ID", "SHEET_TAB", "POA_URL"] as const;

/**
 * The Edge function on the shared cases' terms.
 *
 * Settings: Base44's harness has no sheet and no mandate link unless a case
 * sets one, so the Edge run drops its own defaults for those and takes the
 * case's. Supabase, Google and the mailer it always has; in Base44's `env`,
 * `SUPABASE_URL` only switches the mirror on.
 *
 * Invitations: Base44's went out from the calendar provider, the Edge
 * function's go out by mail (spec, "Invites by mail"). The shared cases read
 * the notifications both send; the invitations are in `invitations`, with
 * their own cases at the end.
 */
async function runEdge(body: unknown, o: RunOptions = {}) {
  const { env, ...rest } = o;
  const envPatch = Object.fromEntries(SHARED_ENV.map((k) => [k, env?.[k] ?? null]));
  const r = await invokeEdge("submit-lead", body, { ...rest, envPatch });
  const emails = r.emails.filter((e) => !e.ics);
  return {
    ...r,
    emails,
    invitations: r.emails.filter((e) => e.ics),
    mailTo(address: string) {
      const found = emails.filter((e) => e.to === address);
      if (found.length !== 1) {
        throw new Error(`expected exactly one email to ${address}, saw ${found.length}`);
      }
      return found[0];
    },
  };
}

const IMPLEMENTATIONS = [
  {
    label: "Edge submit-lead",
    edge: true,
    run: (body: unknown, o: RunOptions = {}) => runEdge(body, o) as unknown as Promise<Result>,
    source: "supabase/functions/submit-lead/lead.js",
    calendarCall: "/calendar/v3/calendars/",
    down: {
      network: { failGoogle: "token" },
      calendar: { failGoogle: "calendar" },
      sheet: { failGoogle: "sheets" },
    } as Record<"network" | "calendar" | "sheet", RunOptions>,
  },
];

const AGENCY = "dorit@govari-fin.co.il";
const OPS = "amielnoy@gmail.com";
const OPS2 = "amielnoy@outlook.com";

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

describe.each(IMPLEMENTATIONS)("$label — the enquiry actually lands", ({ run, calendarCall }) => {
  it("stores the lead, tells three people, and books the calendar", async () => {
    const r = await run(consultation);

    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, leadId: r.leads[0].id, warnings: [] });

    expect(r.leads).toHaveLength(1);
    expect(r.leads[0]).toMatchObject({
      name: "יעל כהן",
      phone: "0521234567",
      source: "consultation",
      status: "new",
    });

    expect(r.emails.map((e) => e.to).sort()).toEqual([OPS, OPS2, AGENCY, "yael@example.com"].sort());
    expect(r.callsTo(calendarCall)).toHaveLength(1);
  });

  it("pins the status rather than taking it from the caller", async () => {
    const r = await run({ ...consultation, status: "closed" });
    expect(r.leads[0].status).toBe("new");
  });

  it("gives the agency the details, and the operations team a notice without them", async () => {
    const r = await run(consultation);
    const details = ["יעל כהן", "0521234567", "עברה מעביד לעצמאית השנה"];
    // Both halves, because a reader gets whichever one their client renders.
    // A field that reached only the text copy would be invisible to everyone
    // in practice — which is what makes checking both worth the repetition.
    const agency = r.mailTo(AGENCY);
    for (const [part, content] of [["html", agency.html], ["text", agency.text]] as const) {
      for (const d of details) expect(content, `agency (${part})`).toContain(d);
    }
    // N-02: the team is told an enquiry arrived and where to read it, never who sent it.
    for (const to of [OPS, OPS2]) {
      const mail = r.mailTo(to);
      for (const [part, content] of [["subject", mail.subject], ["html", mail.html], ["text", mail.text]] as const) {
        for (const d of details) expect(content, `${to} (${part}): ${d}`).not.toContain(d);
      }
      expect(mail.text, to).toContain("https://govari-fin.co.il/admin/leads");
      expect(mail.html, to).toContain('href="https://govari-fin.co.il/admin/leads"');
    }
  });

  it("reports the delivery only to the operations team", async () => {
    const r = await run(consultation);
    expect(r.mailTo(OPS).html).toContain("תקלות");
    expect(r.mailTo(OPS).text).toContain("תקלות:");
    expect(r.mailTo(AGENCY).html).not.toContain("מצב תפעולי");
    expect(r.mailTo(AGENCY).text).not.toContain("תקלות:");
  });

  it("reports the calendar and sheet outcome in that appendix", async () => {
    const r = await run(consultation);
    const ops = r.mailTo(OPS).text!;
    // "נוצר" now names the calendars it was created in: one diary taking the
    // meeting and the other not is exactly what a bare "created" would hide.
    expect(ops).toMatch(/יומן: אירוע נוצר ✓ \([a-z, ]+\)/);
    // No spreadsheet is configured in this repo, so the append is skipped —
    // and says so, rather than reporting a success that never happened.
    expect(ops).toMatch(/גיליון: לא מוגדר/);
    expect(ops).toMatch(/תקלות: אין/);

    // The HTML says the same, in a table — label and value are separate cells,
    // so the pairing cannot be asserted as one string. That the values are
    // present is the part that matters.
    const html = r.mailTo(OPS).html!;
    expect(html).toContain("אירוע נוצר");
    expect(html).toContain("לא מוגדר");
  });

  it("adds a הגיע/ה דרך line when a known channel is supplied, and persists it on the Lead", async () => {
    const r = await run({
      ...consultation,
      channel: "linkedin",
      campaign: "autumn_push",
    });
    expect(r.mailTo(OPS).text).toContain("הגיע/ה דרך: linkedin / autumn_push");
    expect(r.mailTo(OPS).html).toContain("הגיע/ה דרך");
    expect(r.mailTo(AGENCY).text).toContain("הגיע/ה דרך: linkedin / autumn_push");
    expect(r.mailTo(AGENCY).html).toContain("הגיע/ה דרך");
    expect(r.leads[0]).toMatchObject({ channel: "linkedin", campaign: "autumn_push" });
  });

  it("omits the line and stores 'unknown' for an unrecognised channel, never echoing it into the email", async () => {
    const r = await run({ ...consultation, channel: "<script>evil</script>" });
    expect(r.mailTo(OPS).text).not.toContain("הגיע/ה דרך");
    expect(r.mailTo(OPS).text).not.toContain("script");
    expect(r.leads[0].channel).toBe("unknown");
  });

  it("re-sanitises campaign server-side rather than trusting the client's own stripping", async () => {
    const r = await run({
      ...consultation,
      channel: "google",
      campaign: "<script>alert(1)</script>",
    });
    expect(r.mailTo(OPS).text).not.toContain("<script>");
    expect(r.leads[0].campaign).toBe("scriptalert1script");
  });

  it("omits the line entirely when no channel was supplied at all", async () => {
    const r = await run(consultation);
    expect(r.mailTo(OPS).text).not.toContain("הגיע/ה דרך");
    expect(r.leads[0].channel).toBe("unknown");
  });

  it("sends every copy as HTML with a plain-text twin", async () => {
    // The staff copies used to be text-only, and Gmail collapsed the newlines
    // into one running paragraph — eight fields, no line breaks, unreadable on
    // a phone. They are laid out now like the visitor's, and keep the text as
    // the fallback rather than as the only form.
    const r = await run(consultation);
    for (const to of [AGENCY, OPS, "yael@example.com"]) {
      expect(r.mailTo(to).html, to).toContain("<table");
      expect(r.mailTo(to).text, to).toBeTruthy();
    }
  });

  it("breaks the staff copy into blocks rather than one running paragraph", async () => {
    // The point of the rewrite, stated as something that can fail: the reader
    // gets separated, titled sections. Asserting on the headings rather than on
    // markup keeps this about legibility and not about a particular table.
    const r = await run(consultation);
    const html = r.mailTo(AGENCY).html!;
    for (const heading of ["מי פנה", "הבקשה", "תקציר השיחה"]) {
      expect(html, heading).toContain(heading);
    }
  });

  it("skips the visitor's confirmation when no address was given", async () => {
    const r = await run({ ...consultation, email: "" });
    expect(r.emails.map((e) => e.to).sort()).toEqual([OPS, OPS2, AGENCY].sort());
    expect(r.status).toBe(200);
  });
});

describe.each(IMPLEMENTATIONS)("$label — a name that is really a payload", ({ run }) => {
  const hostile = {
    ...consultation,
    name: '<a href="https://evil.example">לחצו כאן</a> כהן',
    topic: '<img src=x onerror="alert(1)">',
  };

  it("renders no live markup into the visitor's HTML mail", async () => {
    const r = await run(hostile);
    const html = r.mailTo("yael@example.com").html!;
    // The dangerous forms are an unescaped tag and a real quoted attribute.
    // `onerror=` surviving as *text* inside an escaped blob is harmless, so
    // asserting on the bare substring would only produce a test that fails
    // for the wrong reason.
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('onerror="');
    expect(html).not.toContain('<a href="https://evil.example"');
  });

  it("leaves the payload out of the visitor's copy altogether", async () => {
    const r = await run(hostile);
    const mail = r.mailTo("yael@example.com");
    // Neither the name nor the topic is plain text, so neither is repeated:
    // the greeting has no name and the topic falls back to the default.
    expect(mail.html).not.toContain("&lt;a");
    expect(mail.html).not.toContain("&lt;img");
    expect(mail.html).toContain("שלום,");
    expect(mail.html).toContain("ייעוץ כללי");
    expect(mail.text).not.toContain("<img");
  });

  it("keeps the payload, escaped, in what Dorit reads", async () => {
    const r = await run(hostile);
    const copy = r.mailTo(AGENCY);
    expect(copy.html ?? copy.body).toContain("img src=x");
  });
  it("leaves the plain-text staff copy unescaped, because it cannot render", async () => {
    // Escaping the text copy too would only make the staff email unreadable.
    // This pins the boundary: escaping belongs to the HTML builder alone.
    const r = await run(hostile);
    expect(r.mailTo(AGENCY).text).toContain('<a href="https://evil.example">');
  });

  it("renders no live markup into the staff HTML either", async () => {
    // The staff copy became a rendered email, so it inherited the vector the
    // visitor's copy already guarded against — and this one is worse: it is the
    // mail Dorit opens on her phone, and the attacker controls the name and the
    // topic. Every field goes through escapeHtml; this is what says so.
    const r = await run(hostile);
    for (const to of [AGENCY, OPS]) {
      const html = r.mailTo(to).html!;
      expect(html, to).not.toContain("<img src=x");
      expect(html, to).not.toContain('onerror="');
      expect(html, to).not.toContain('<a href="https://evil.example"');
      // Present, but as text the client displays rather than markup it runs —
      // the topic in both; the name in Dorit's copy alone (N-02).
      expect(html, to).toContain("&lt;img src=x");
    }
    expect(r.mailTo(AGENCY).html).toContain("&lt;a href=&quot;https://evil.example&quot;");
    expect(r.mailTo(OPS).html).not.toContain("evil.example");
  });

  it("refuses a form whose phone is a payload, and writes nothing", async () => {
    // A phone has to be one Dorit can call back (D-01), so from a form this
    // never reaches a mail at all.
    const r = await run({ ...hostile, phone: '052"><script>alert(1)</script>' });
    expect(r.status).toBe(400);
    expect(r.leads).toHaveLength(0);
    expect(r.emails).toHaveLength(0);
  });

  it("does not turn a hostile phone number into a live link", async () => {
    // The phone is the one field rendered into an href. Anything that is not a
    // digit or a leading + is stripped before it gets there, so the attribute
    // cannot be escaped out of. An interview is the one source whose phone is
    // not refused for its shape (the model transcribed it), so it is the one
    // that still reaches the link.
    const r = await run({
      ...hostile,
      source: "interview",
      stage: "complete",
      phone: '052"><script>alert(1)</script>',
    });
    const html = r.mailTo(AGENCY).html!;
    // `0521` — the digits of the payload survive (the 1 comes from `alert(1)`)
    // and nothing else does. A useless phone number, which is the right outcome
    // for a useless phone number; the attribute is what had to stay intact.
    expect(html).toContain('href="tel:0521"');
    expect(html).not.toContain("<script>");
  });

  it("stores the raw value, so the record matches what was submitted", async () => {
    const r = await run(hostile);
    expect(r.leads[0].name).toBe(hostile.name);
  });
});

describe.each(IMPLEMENTATIONS)("$label — the visitor's copy repeats only plain text", ({ run }) => {
  it("drops a topic that carries a link", async () => {
    const r = await run({ ...consultation, topic: "ראו www.evil.example" });
    const mail = r.mailTo("yael@example.com");
    expect(mail.html).not.toContain("evil.example");
    expect(mail.text).toContain("נושא: ייעוץ כללי");
  });

  it("drops a requested time that carries an address", async () => {
    const r = await run({ ...consultation, timing: "write to x@evil.example" });
    expect(r.mailTo("yael@example.com").text).toContain("מועד מבוקש: לפי תיאום");
  });

  it("keeps an ordinary topic", async () => {
    const r = await run(consultation);
    expect(r.mailTo("yael@example.com").text).toContain(`נושא: ${consultation.topic}`);
  });
});

describe.each(IMPLEMENTATIONS)("$label — the public entry point's limits", ({ run }) => {
  it("refuses a field longer than its ceiling, and writes nothing", async () => {
    const r = await run({ ...consultation, notes: "x".repeat(4001) });
    expect(r.status).toBe(400);
    expect(r.leads).toHaveLength(0);
    expect(r.emails).toHaveLength(0);
    // And no invitation: on Edge those are mail too, kept out of `emails` above.
    expect(r.invitations ?? []).toEqual([]);
  });

  it("refuses a profile larger than any interview", async () => {
    const r = await run({
      ...consultation, source: "interview", stage: "partial", profile: { goal: "x".repeat(20001) },
    });
    expect(r.status).toBe(400);
    expect(r.leads).toHaveLength(0);
  });

  // D-01, manual test 2026-10-14: "abc" and "123" were stored as enquiries.
  it.each(["abc", "123", "050123", "+1 202 555 0143"])("refuses a phone Dorit cannot call back (%s), and writes nothing", async (phone) => {
    const r = await run({ ...consultation, source: "quick", phone });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("מספר הטלפון לא נראה תקין");
    expect(r.json.rid).toBeTruthy();
    expect(r.leads).toHaveLength(0);
    expect(r.emails).toHaveLength(0);
  });

  it.each(["050-123-4567", "03 123 4567", "+972 50 123 4567", "97231234567"])("accepts an Israeli mobile or landline (%s)", async (phone) => {
    const r = await run({ ...consultation, source: "quick", phone });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
  });

  it("does not refuse an interview for its phone's shape — the model wrote it, and the interview would be lost", async () => {
    const r = await run({ ...consultation, source: "interview", stage: "complete", phone: "חמישים ושתיים 1234567" });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
  });

  it("keeps the enquiry but mails no confirmation to something that is not an address", async () => {
    const r = await run({ ...consultation, email: "yael@example.com\nbcc: victim@example.com" });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
    expect(r.json.warnings).toContain("client_email_invalid");
    expect(r.emails.some((e) => e.to.includes("victim"))).toBe(false);
  });

  const fromIp = { headers: { "x-forwarded-for": "203.0.113.7" } };
  const limiterKeys = (r: Result) =>
    (r as unknown as { fetches: { url: string; body: unknown }[] }).fetches
      .filter((f) => f.url.endsWith("/rest/v1/rpc/allow_submission"))
      .map((f) => String((f.body as { p_key: string }).p_key));

  it("counts the caller by a hash of the address, never the address itself", async () => {
    const r = await run(consultation, fromIp);
    expect(r.status).toBe(200);
    expect(limiterKeys(r).find((k) => k.startsWith("lead-ip:"))).toMatch(/^lead-ip:[0-9a-f]{64}$/);
    expect(JSON.stringify(limiterKeys(r))).not.toContain("203.0.113.7");
  });

  it("refuses a caller over the hourly limit, and writes and mails nothing", async () => {
    const r = await run(consultation, { ...fromIp, overLimit: ["lead-ip:"] });
    expect(r.status).toBe(429);
    expect(r.json.rid).toBeTruthy();
    expect(r.leads).toHaveLength(0);
    expect(r.emails).toHaveLength(0);
    expect(r.invitations ?? []).toEqual([]);
  });

  it("past the hourly staff cap, saves the lead and confirms to the visitor, but mails no staff and books nothing", async () => {
    const r = await run(consultation, { overLimit: ["lead-staff-notify"] });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
    expect(r.json.warnings).toContain("staff_notify_capped");
    const to = r.emails.map((e) => e.to);
    expect(to).toContain("yael@example.com");
    for (const staff of [AGENCY, OPS, OPS2]) expect(to).not.toContain(staff);
    expect(r.invitations ?? []).toEqual([]);
    expect((r as unknown as { fetches: { url: string }[] }).fetches.some((f) => f.url.includes("/calendar/v3/calendars/"))).toBe(false);
  });

  it("asks the staff cap once per enquiry, and not for a partial interview", async () => {
    const full = await run(consultation);
    expect(limiterKeys(full).filter((k) => k === "lead-staff-notify")).toHaveLength(1);
    const partial = await run({ ...consultation, source: "interview", stage: "partial" });
    expect(limiterKeys(partial)).not.toContain("lead-staff-notify");
  });
});

describe.each(IMPLEMENTATIONS)("$label — identifiers a visitor volunteered", ({ run }) => {
  it("strips an ID number from the summary before anyone receives it", async () => {
    const r = await run({
      ...consultation,
      summary: "מסרה את ת״ז 123456789 בשיחה, ומספר כרטיס 4580 1234 5678 9012.",
    });
    // The invitations too, where there are any: their description is the
    // agency's text, summary included.
    for (const mail of [...r.emails, ...(r.invitations ?? [])]) {
      expect(`${mail.html ?? ""}${mail.text ?? ""}${mail.ics ?? ""}`, mail.to).not.toContain("123456789");
      expect(`${mail.html ?? ""}${mail.text ?? ""}${mail.ics ?? ""}`, mail.to).not.toContain("4580");
    }
  });

  it("says why the text changed, rather than silently deleting", async () => {
    const r = await run({
      ...consultation,
      summary: "ת״ז 123456789",
    });
    expect(r.mailTo(AGENCY).text).toContain("הושמט");
    expect(r.mailTo(AGENCY).html).toContain("הושמט");
  });
});

describe.each(IMPLEMENTATIONS)("$label — what survives a failure", ({ run, down }) => {
  it("refuses without a phone number, and writes nothing", async () => {
    const r = await run({ ...consultation, phone: "" });
    expect(r.status).toBe(400);
    expect(r.leads).toHaveLength(0);
    expect(r.emails).toHaveLength(0);
    // And no invitation: on Edge those are mail too, kept out of `emails` above.
    expect(r.invitations ?? []).toEqual([]);
  });

  it("refuses without a name", async () => {
    const r = await run({ ...consultation, name: "" });
    expect(r.status).toBe(400);
  });

  it("fails loudly when the record cannot be written, and mails nobody", async () => {
    // The record is the enquiry. Mailing about a lead that was never stored
    // would leave the team chasing something with no row behind it.
    const r = await run(consultation, { failLeadWrite: true });
    expect(r.status).toBe(500);
    expect(r.emails).toHaveLength(0);
    // And no invitation: on Edge those are mail too, kept out of `emails` above.
    expect(r.invitations ?? []).toEqual([]);
    expect(String(r.json.error)).toMatch(/לא הצלחנו לשמור/);
  });

  it("keeps the enquiry when a mailbox bounces, and still tells everyone else", async () => {
    const r = await run(consultation, { failEmailTo: [AGENCY] });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
    expect(r.json.warnings as string[]).toSatisfy((w: string[]) => w.some((x) => x.startsWith("secondary_email_failed")));
    expect(r.emails.map((e) => e.to)).toContain(OPS);
    expect(r.emails.map((e) => e.to)).toContain("yael@example.com");
  });

  it("keeps the enquiry when the calendar refuses", async () => {
    const r = await run(consultation, down.network);
    expect(r.status).toBe(200);
    // Per calendar, not one flat `calendar_event_failed`. Which diary missed
     // the meeting is the whole question when only one of them did.
    expect(r.json.warnings as string[]).toSatisfy((w: string[]) =>
      w.some((x) => /^calendar_\w+_(failed|rejected|not_connected)$/.test(x))
    );
    expect(r.leads).toHaveLength(1);
  });

  it("reports the calendar failure in the operations appendix", async () => {
    const r = await run(consultation, down.calendar);
    expect(r.mailTo(OPS).text).toMatch(/יומן: (אירוע ביומן Google )?לא נוצר/);
    expect(r.mailTo(OPS).text).toMatch(/תקלות:.*calendar_\w+_(failed|rejected)/);
  });

  it("names the upstream reason when the mailer refuses", async () => {
    /**
     * `mailer_http_502` alone says Dorit did not get the summary. It does not
     * say why, and the why is in the body the caller used to throw before
     * reading — `failed: ["http_403"]`, Resend's own status. That gap is what
     * turned a five-minute fix into a morning of guessing.
     */
    const r = await run(consultation, {
      resendStatus: 502,
      resendResponse: { ok: false, error: "send_failed", failed: ["http_403"] },
    });
    expect(r.status).toBe(200);
    expect(r.json.warnings as string[]).toSatisfy((w: string[]) =>
      w.some((x) => x.includes("mailer_http_502:http_403"))
    );
  });

  it("keeps the reason to a closed vocabulary", async () => {
    // The comment this replaced was right about the danger: a provider's prose
    // must not reach a warning the operations mail prints. Only a status code
    // or one of two fixed words survives the filter.
    const r = await run(consultation, {
      resendStatus: 502,
      resendResponse: {
        ok: false,
        failed: ["Invalid API key: re_live_abcdefghijklmnop", "network_error"],
      },
    });
    const warnings = (r.json.warnings as string[]).join(" ");
    expect(warnings, "a provider's prose reached the warning").not.toMatch(/Invalid API key|re_live/);
    expect(warnings).toContain("network_error");
  });
});

/**
 * The meeting, in Supabase.
 *
 * The agreed time used to exist only as an argument on its way to a calendar
 * API: no column on the Base44 `Lead`, none on `leads`, and no table of its
 * own. When the interview agent stopped sending it, the mail still went out
 * and the calendar quietly booked a default slot — and the only record that
 * anything had gone wrong was a line in a function log.
 *
 * These are also the first tests to exercise the Supabase mirror at all. It
 * short-circuits unless SUPABASE_URL and the service key are set, so every
 * earlier test ran with mirroring switched off without ever saying so.
 */
describe.each(IMPLEMENTATIONS)("$label — what it stores about the meeting", ({ run, edge, calendarCall }) => {
  const SUPABASE = "https://stub.supabase.co";
  const env = {
    MAILER_URL,
    MAILER_TOKEN: "test-only-token",
    SUPABASE_URL: SUPABASE,
    SUPABASE_SERVICE_ROLE_KEY: "test-only-service-key",
  };

  const booked = {
    name: "אורי לוי",
    phone: "0541112233",
    source: "interview",
    topic: "דמי ניהול בקרן ההשתלמות",
    meetingTopic: "גמל, השתלמות ופנסיה",
    timing: "חמישי השבוע, 24/09, 10:00",
    notes: "אחרי 09:30",
    track: "pension",
    scheduledAt: "2026-09-24T10:00:00",
  };

  // The rows written to Supabase: Base44's mirror, or the Edge function's own
  // writes. Writes only — the Edge function reads `leads` first, for an open
  // interview.
  const bodyOf = (r: Result, table: string) => {
    const calls = r.callsTo(`/rest/v1/${table}`).filter((c) => c.method === "POST");
    expect(calls.length, `no write reached ${table}`).toBeGreaterThan(0);
    return calls.map((c) => c.body as Record<string, unknown>);
  };

  it("puts the meeting fields on the lead", async () => {
    const r = await run(booked, { env });
    const [lead] = bodyOf(r, "leads");
    expect(lead).toMatchObject({
      meeting_topic: "גמל, השתלמות ופנסיה",
      notes: "אחרי 09:30",
      track: "pension",
    });
  });

  it("stores the agreed time as a real instant, not a naive string", async () => {
    // 10:00 in Israel is 07:00Z in September. Writing the wall-clock string
    // into a timestamptz column would have Postgres read it as UTC and store
    // 10:00Z — the same three-hour shift the calendar writers just lost.
    const r = await run(booked, { env });
    const [lead] = bodyOf(r, "leads");
    expect(lead.scheduled_at).toBe("2026-09-24T07:00:00.000Z");
  });

  it("honours Israeli winter time too", async () => {
    const r = await run({ ...booked, scheduledAt: "2026-01-15T10:00:00" }, { env });
    const [lead] = bodyOf(r, "leads");
    expect(lead.scheduled_at).toBe("2026-01-15T08:00:00.000Z");
  });

  it("writes the booking to the meetings table, keyed on the lead", async () => {
    const r = await run(booked, { env });
    const calls = r.callsTo("/rest/v1/meetings");
    // Base44 keys the booking by its own lead id; the Edge function's lead
    // exists only in Supabase, so by `leads.id` (spec, "A migration for meetings").
    const key = edge ? { lead_id: r.leads[0].id } : { lead_base44_id: "LEAD-1" };
    expect(calls[0].url).toContain(`on_conflict=${Object.keys(key)[0]}`);
    expect(calls[0].body).toMatchObject({
      ...key,
      scheduled_at: "2026-09-24T07:00:00.000Z",
      topic: "גמל, השתלמות ופנסיה",
      timing: "חמישי השבוע, 24/09, 10:00",
      track: "pension",
      source: "interview",
    });
  });

  it("carries no contact details into the meetings table", async () => {
    // The lead is one join away and cascades on delete. A second copy of the
    // name and phone is a second place a deletion request has to reach.
    const r = await run(booked, { env });
    for (const body of bodyOf(r, "meetings")) {
      for (const field of ["name", "phone", "email"]) {
        expect(body, `meetings carries ${field}`).not.toHaveProperty(field);
      }
    }
  });

  it("records what the calendar actually did, beside what was agreed", async () => {
    const r = await run(booked, { env });
    const outcome = bodyOf(r, "meetings").find((b) => "calendar_status" in b);
    expect(outcome, "the calendar outcome was never written back").toBeTruthy();
    expect(outcome!.calendar_status).toContain("אירוע נוצר");
    expect(outcome!.calendar_at).toBe("2026-09-24T07:00:00.000Z");
  });

  it("says so when an interview agreed no time at all", async () => {
    // The shape of the bug: a meeting was discussed, nothing was booked, and
    // the row is what makes that answerable without reading the logs.
    const { scheduledAt, ...noTime } = booked;
    const r = await run(noTime, { env });
    const outcome = bodyOf(r, "meetings").find((b) => "calendar_status" in b);
    expect(outcome!.calendar_status).toBe("לא נקבע מועד");
    expect(outcome!.calendar_at).toBeNull();
    expect(r.callsTo(calendarCall)).toEqual([]);
  });

  it("writes no meeting for a form that books none", async () => {
    const r = await run({ name: "יעל", phone: "0521234567", source: "quick" }, { env });
    expect(r.callsTo("/rest/v1/meetings")).toEqual([]);
  });

  it("stores the summary and the answers, as the mail shows them", async () => {
    const r = await run({ ...booked, summary: "לקוח שמעוניין לבדוק דמי ניהול", profile: { goal: "הורדת עלויות", life_stage: "נשוי +2" } }, { env });
    const [lead] = bodyOf(r, "leads");
    expect(lead.summary).toBe("לקוח שמעוניין לבדוק דמי ניהול");
    expect(lead.track_label).toBe("פנסיה, גמל והשתלמות");
    expect(lead.profile).toEqual(expect.arrayContaining([["יעד עיקרי", "הורדת עלויות"]]));
  });

  it("stores the answers only after redaction", async () => {
    const r = await run({ ...booked, profile: { goal: "ת.ז. 123456782 — הורדת עלויות" } }, { env });
    const [lead] = bodyOf(r, "leads");
    expect(lead.profile).not.toBeNull();
    expect(JSON.stringify(lead.profile)).not.toContain("123456782");
    expect(JSON.stringify(lead.profile)).toContain("הורדת עלויות");
  });

  it("stores no profile for a form that is not an interview", async () => {
    const r = await run({ name: "דן", phone: "0501112233", source: "quick" }, { env });
    const [lead] = bodyOf(r, "leads");
    expect(lead.profile).toBeNull();
  });
});

describe.each(IMPLEMENTATIONS)("$label — the calendar event it books", ({ run, calendarCall }) => {
  it("books nothing for a quick contact form", async () => {
    const r = await run({ ...consultation, source: "quick" });
    expect(r.callsTo(calendarCall)).toHaveLength(0);
    expect(r.mailTo(OPS).text).toMatch(/יומן: לא רלוונטי/);
  });

  it("honours an explicit scheduledAt", async () => {
    const r = await run({
      ...consultation,
      scheduledAt: "2026-10-01T14:00:00",
    });
    const [call] = r.callsTo(calendarCall);
    const event = call.body as { start: { dateTime: string }; end: { dateTime: string } };
    // The hour, not just the day. This asserted `toContain("2026-10-01")` while
    // the code sent `2026-10-01T14:00:00.000Z` beside timeZone "Israel Standard
    // Time" — Graph and Google both prefer an offset in the string over the
    // timeZone field, so a 14:00 meeting was held at 17:00 and the test agreed.
    expect(event.start.dateTime).toBe("2026-10-01T14:00:00");
    expect(event.end.dateTime).toBe("2026-10-01T14:30:00");
    expect(event.start.dateTime, "an offset in the string overrides timeZone").not.toMatch(/Z$|[+-]\d{2}:\d{2}$/);
  });

  it("falls back to tomorrow morning when no time was agreed", async () => {
    const r = await run({ ...consultation, scheduledAt: "" });
    const [call] = r.callsTo(calendarCall);
    const event = call.body as { start: { dateTime: string } };
    expect(event.start.dateTime).toMatch(/T09:00:00$/);
  });
});

/**
 * The introduction interview, ending.
 *
 * Until this source existed the interview agent finished by writing the
 * approved profile straight to `Lead.create`: the summary was stored and
 * nobody was told, so it waited in the database for whoever next opened the
 * leads screen. Routing it through `submitLead` is what puts it in Dorit's
 * inbox the same minute, laid out like every other enquiry — and these run the
 * function to check it actually arrives that way, rather than that the branch
 * is spelled correctly in the source.
 */
describe.each(IMPLEMENTATIONS)("$label — a finished introduction interview", ({ run, calendarCall }) => {
  const interview = {
    name: "אורי לוי",
    phone: "0541112233",
    email: "uri@example.com",
    source: "interview",
    topic: "דמי ניהול בקרן ההשתלמות",
    message:
      "· בן 52, נשוי, שני ילדים, שכיר בהייטק.\n" +
      "· קיימים: פנסיה, קרן השתלמות, ביטוח חיים. חסר: ביטוח בריאות פרטי.\n" +
      "· דאגה מרכזית: דמי הניהול בקרן ההשתלמות.\n" +
      "· יעד עיקרי: פרישה מסודרת בעוד כעשור.",
  };

  it("reaches Dorit and the operations team as HTML, and confirms to the visitor", async () => {
    const r = await run(interview);

    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, warnings: [] });
    expect(r.emails.map((e) => e.to).sort()).toEqual([OPS, OPS2, AGENCY, "uri@example.com"].sort());
    for (const to of [AGENCY, OPS]) {
      expect(r.mailTo(to).html, to).toContain("<table");
      expect(r.mailTo(to).text, to).toBeTruthy();
    }
  });

  it("carries the whole approved profile in both halves of Dorit's copy, and none of it to the operations team", async () => {
    const r = await run(interview);
    const profile = ["אורי לוי", "0541112233", "דמי הניהול בקרן ההשתלמות", "פרישה מסודרת בעוד כעשור"];
    for (const [to, carried] of [[AGENCY, true], [OPS, false]] as const) {
      const mail = r.mailTo(to);
      for (const [part, content] of [["html", mail.html], ["text", mail.text]] as const) {
        for (const p of profile) {
          if (carried) expect(content, `${to} (${part})`).toContain(p);
          else expect(content, `${to} (${part})`).not.toContain(p);
        }
      }
    }
  });

  it("names itself an interview rather than an enquiry", async () => {
    const r = await run(interview);
    expect(r.mailTo(AGENCY).subject).toBe("סיכום ראיון היכרות — אורי לוי");
    // Same headline in the body, so subject and content cannot drift apart.
    expect(r.mailTo(AGENCY).html).toContain("סיכום ראיון היכרות");
    expect(r.mailTo(AGENCY).text).toContain("סיכום ראיון היכרות");
    // And the kicker above it agrees. It was hardcoded to "פנייה מהאתר", so the
    // letter opened by calling an interview an enquiry one line above a heading
    // that called it an interview.
    expect(r.mailTo(AGENCY).html).toContain("ראיון היכרות</p>");
    expect(r.mailTo(AGENCY).html).not.toContain("פנייה מהאתר");
  });

  it("lays the profile out under its own heading", async () => {
    const r = await run(interview);
    const html = r.mailTo(AGENCY).html!;
    for (const heading of ["מי פנה", "הראיון", "פרופיל המבקר"]) {
      expect(html, heading).toContain(heading);
    }
  });

  it("stores the profile on the record under the interview source", async () => {
    const r = await run(interview);
    expect(r.leads).toHaveLength(1);
    expect(r.leads[0]).toMatchObject({
      name: "אורי לוי",
      source: "interview",
      status: "new",
      topic: "דמי ניהול בקרן ההשתלמות",
    });
    // מה שמסמן ראיון הוא השדה, לא תווית בתוך הטקסט: התווית הייתה כפילות של
    // source ונראתה במייל כשורה מיותרת מתחת לכותרת שכבר אומרת את אותו דבר.
    expect(r.leads[0].message).toContain("שכיר בהייטק");
    expect(r.leads[0].message).not.toMatch(/^\[/);
  });

  it("books no calendar slot when the interview sent no time, and says so", async () => {
    // "לא רלוונטי" read like a decision, and that is how this went unnoticed:
    // the agent had stopped sending scheduledAt, and the ops mail reported the
    // silence as though a calendar had never been wanted. The label now names
    // what actually happened, so the next time it is visible in the mail.
    const r = await run(interview);
    expect(r.callsTo(calendarCall)).toEqual([]);
    expect(r.mailTo(OPS).text).toMatch(/יומן: לא נקבע מועד/);
  });

  it("books the slot the interview did agree, at the hour it agreed", async () => {
    const r = await run({ ...interview, scheduledAt: "2026-09-24T10:00:00" });
    const [call] = r.callsTo(calendarCall);
    const event = call.body as { start: { dateTime: string } };
    expect(event.start.dateTime).toBe("2026-09-24T10:00:00");
    expect(r.mailTo(OPS).text).toMatch(/יומן: אירוע נוצר ✓ \([a-z, ]+\) — 2026-09-24 10:00/);
  });

  it("redacts the profile itself, not only a separate summary", async () => {
    // The profile is written by a model, not typed by the visitor: the agent
    // is told never to record an ID number, but the visitor can type one
    // mid-conversation and the model can reflect it back into the summary.
    const r = await run({
      ...interview,
      message: "· מסר את ת״ז 123456789 באמצע השיחה.",
    });
    for (const mail of r.emails) {
      expect(`${mail.html ?? ""}${mail.text ?? ""}`, mail.to).not.toContain("123456789");
    }
    expect(r.leads[0].message).not.toContain("123456789");
    expect(r.leads[0].message).toContain("הושמט");
  });

  it("tells the visitor what was kept, without repeating the profile back", async () => {
    const r = await run(interview);
    const mail = r.mailTo("uri@example.com");
    // Subject and opening line, pinned together: `toContain("אישור")` passed
    // while the subject still said "פנייתכם" and the letter said something else.
    expect(mail.subject).toBe("אישור — קיבלנו את סיכום השיחה · דורית גוב ארי");
    expect(mail.html).toContain("קיבלנו את סיכום השיחה");
    expect(mail.html).toContain("דמי ניהול בקרן ההשתלמות");
    // The bullets are for Dorit. Mailing them back adds a fourth copy of the
    // visitor's own words to an inbox neither of them controls.
    expect(mail.html).not.toContain("שני ילדים");
    expect(mail.text).not.toContain("שני ילדים");
  });

  it("still lands when no address was given, because the staff copies matter", async () => {
    const r = await run({ ...interview, email: "" });
    expect(r.status).toBe(200);
    expect(r.emails.map((e) => e.to).sort()).toEqual([OPS, OPS2, AGENCY].sort());
  });
});

/**
 * The interview's fixed schema.
 *
 * The interview used to end in a paragraph the model composed, which read well
 * and compared to nothing: what got collected changed from conversation to
 * conversation depending on what the model chose to remember. It now hands over
 * named fields, chosen by a track derived from the visitor's goal, and the
 * function decides what is renderable — so a key the model invents cannot reach
 * Dorit or the record.
 */
describe.each(IMPLEMENTATIONS)("$label — the interview schema", ({ run, source }) => {
  const pension = {
    name: "אורי לוי",
    phone: "0541112233",
    email: "",
    source: "interview",
    topic: "דמי ניהול",
    track: "pension",
    profile: {
      life_stage: "בן 52, נשוי, שני ילדים",
      goal: "פרישה מסודרת בעוד כעשור",
      concern: "דמי הניהול נראים גבוהים",
      employer: "שכיר בהייטק",
      seniority: "בערך 14 שנה",
      products: "פנסיה, השתלמות. אין ביטוח בריאות פרטי",
      fees: "לא ידוע למבקר",
    },
  };

  it("renders every field of the track, with its label", async () => {
    const r = await run(pension);
    const html = r.mailTo(AGENCY).html!;
    for (const label of ["שלב חיים", "יעד עיקרי", "דאגה מרכזית", "מעסיק / מעמד תעסוקתי", "ותק", "מוצרים קיימים"]) {
      expect(html, label).toContain(label);
    }
    for (const value of ["בן 52, נשוי, שני ילדים", "שכיר בהייטק", "בערך 14 שנה", "לא ידוע למבקר"]) {
      expect(html, value).toContain(value);
    }
  });

  it("names the track it ran", async () => {
    const r = await run(pension);
    expect(r.mailTo(AGENCY).html).toContain("פנסיה, גמל והשתלמות");
    expect(r.mailTo(AGENCY).text).toContain("פנסיה, גמל והשתלמות");
  });

  it("drops a key the model invented", async () => {
    // The whitelist is the point: a schema the model can extend is not a schema.
    const r = await run({
      ...pension,
      profile: { ...pension.profile, estimated_savings: "₪840,000", advice: "כדאי לנייד" },
    });
    for (const mail of r.emails) {
      const all = `${mail.html ?? ""}${mail.text ?? ""}`;
      expect(all, mail.to).not.toContain("840,000");
      expect(all, mail.to).not.toContain("כדאי לנייד");
    }
    expect(JSON.stringify(r.leads[0])).not.toContain("840,000");
  });

  it("renders only the fields of the track it was given", async () => {
    // An insurance field arriving on a pension interview is a model mistake,
    // not a new column.
    const r = await run({
      ...pension,
      profile: { ...pension.profile, health_flag: "יש נושא לדיון בפגישה" },
    });
    expect(r.mailTo(AGENCY).html).not.toContain("סוגיה בריאותית");
  });

  it("omits a field the visitor never answered, rather than printing a dash", async () => {
    const r = await run({
      ...pension,
      profile: { life_stage: "בן 52", goal: "פרישה", concern: "דמי ניהול" },
    });
    const html = r.mailTo(AGENCY).html!;
    expect(html).toContain("שלב חיים");
    expect(html).not.toContain("ותק");
  });

  it("redacts an identifier the model echoed into a field", async () => {
    const r = await run({
      ...pension,
      profile: { ...pension.profile, employer: "שכיר, ת״ז 123456789" },
    });
    for (const mail of r.emails) {
      expect(`${mail.html ?? ""}${mail.text ?? ""}`, mail.to).not.toContain("123456789");
    }
    expect(JSON.stringify(r.leads[0])).not.toContain("123456789");
  });

  it("stores the same fields it mailed, so record and mail cannot disagree", async () => {
    const r = await run(pension);
    const stored = r.leads[0].message as string;
    expect(stored).toContain("שלב חיים: בן 52, נשוי, שני ילדים");
    expect(stored).toContain("ותק: בערך 14 שנה");
  });

  it("carries the collect-not-advise declaration on every interview", async () => {
    const r = await run(pension);
    // Dorit's copy: the operations notice carries no interview to qualify (N-02).
    for (const part of [r.mailTo(AGENCY).html, r.mailTo(AGENCY).text]) {
      expect(part, AGENCY).toContain("אינו בירור צרכים");
    }
  });

  /**
   * Every track, executed — and a fixture list that cannot fall behind.
   *
   * Two tracks were exercised here and five were not, which is the failure mode
   * a table invites: the schema grows, the tests keep passing, and nobody
   * notices that `savings` has never once been rendered. The first case reads
   * the track names out of the function and fails if this file does not carry a
   * fixture for each, so adding a track to the code forces a fixture with it.
   */
  describe("every declared track", () => {
    const fixtures: Record<string, { label: string; profile: Record<string, string> }> = {
      pension: {
        label: "פנסיה, גמל והשתלמות",
        profile: { employer: "שכיר בהייטק", seniority: "בערך 14 שנה", products: "פנסיה, השתלמות", fees: "לא ידוע למבקר" },
      },
      insurance: {
        label: "ביטוחי חיים ובריאות",
        profile: { dependents: "בן זוג ושלושה ילדים", mortgage: "יש, עוד כ-18 שנה", health_flag: "יש נושא לדיון בפגישה", coverage: "דרך העבודה בלבד" },
      },
      retirement: {
        label: "פרישה וקיבוע זכויות",
        profile: { retirement_horizon: "בעוד כשנתיים", employment_status: "שכיר", rights_fixing: "לא ידוע", severance_history: "לא" },
      },
      tax: {
        label: "מיסוי ופיננסים",
        profile: { tax_event: "פרישה", filing_status: "לא מגיש", prior_handling: "לא", products: "פנסיה, גמל" },
      },
      savings: {
        label: "חיסכון לטווח",
        profile: { horizon: "עד גיל 18 של הילד", purpose: "חיסכון לילדים", existing_savings: "אין", liquidity: "לא נדרשת" },
      },
      self_employed: {
        label: "עצמאים",
        profile: { business_type: "עיצוב גרפי", years_active: "בערך 6 שנים", pension_status: "קיים", study_fund_status: "לא קיים" },
      },
      general: {
        label: "הקשר כללי",
        profile: { products: "פנסיה בלבד", notes: "עוד לא בטוח מה מחפש" },
      },
    };

    it("carries a fixture for every track the function declares", () => {
      const fn = readFileSync(join(REPO_ROOT, source), "utf8");
      const body = fn.slice(fn.indexOf("const INTERVIEW_TRACKS"), fn.indexOf("\n};", fn.indexOf("const INTERVIEW_TRACKS")));
      const declared = [...body.matchAll(/^  ([a-z_]+): \{$/gm)].map((m) => m[1]);
      expect(declared.length).toBeGreaterThan(1);
      expect(Object.keys(fixtures).sort()).toEqual(declared.sort());
    });

    for (const [track, { label, profile }] of Object.entries(fixtures)) {
      it(`renders the ${track} track end to end`, async () => {
        const r = await run({
          name: "אורי לוי", phone: "0541112233", email: "", source: "interview",
          topic: "בדיקה", track,
          profile: { life_stage: "בן 45", goal: "יעד כלשהו", concern: "דאגה כלשהי", ...profile },
        });
        expect(r.status).toBe(200);
        const mail = r.mailTo(AGENCY);
        expect(mail.html, `${track} label`).toContain(label);
        expect(mail.text, `${track} label`).toContain(label);
        // Every value the fixture supplied reaches the agency, in both halves.
        for (const value of Object.values(profile)) {
          expect(mail.html, `${track}: ${value}`).toContain(value);
          expect(mail.text, `${track}: ${value}`).toContain(value);
        }
        // And the record holds the same fields the mail showed.
        for (const value of Object.values(profile)) {
          expect(r.leads[0].message as string, `${track} record`).toContain(value);
        }
      });
    }
  });

  describe("a track that is missing or unknown", () => {
    const base = {
      name: "אורי לוי", phone: "0541112233", email: "", source: "interview", topic: "בדיקה",
      profile: { life_stage: "בן 45", goal: "יעד", concern: "דאגה", employer: "שכיר" },
    };

    it("still delivers the common fields when no track was chosen", async () => {
      const r = await run(base);
      expect(r.status).toBe(200);
      const html = r.mailTo(AGENCY).html!;
      for (const label of ["שלב חיים", "יעד עיקרי", "דאגה מרכזית"]) {
        expect(html, label).toContain(label);
      }
    });

    it("drops track-specific fields rather than guessing a track", async () => {
      const r = await run(base);
      // `employer` belongs to pension; without a track there is nothing to say
      // it applies, so it is not rendered under a label that was never chosen.
      expect(r.mailTo(AGENCY).html).not.toContain("מעסיק / מעמד תעסוקתי");
    });

    it("treats an invented track the same as none", async () => {
      const r = await run({ ...base, track: "crypto" });
      expect(r.status).toBe(200);
      expect(r.mailTo(AGENCY).html).toContain("שלב חיים");
      expect(r.mailTo(AGENCY).html).not.toContain("crypto");
    });
  });

  it("escapes markup a model put inside a profile value", async () => {
    // Same class of defect as the hostile-name case above, one layer in: the
    // profile is model-written text interpolated into HTML that staff open.
    const r = await run({
      name: "אורי לוי", phone: "0541112233", email: "", source: "interview",
      topic: "בדיקה", track: "pension",
      profile: { life_stage: '<a href="https://evil.example">לחצו</a>', goal: "יעד", concern: "דאגה" },
    });
    const html = r.mailTo(AGENCY).html!;
    expect(html).not.toContain('<a href="https://evil.example"');
    expect(html).toContain("&lt;a href=");
  });

  it("runs the insurance track off the same machinery", async () => {
    const r = await run({
      ...pension,
      track: "insurance",
      profile: {
        life_stage: "בת 41, נשואה",
        goal: "להגן על המשפחה",
        concern: "אין ביטוח חיים",
        dependents: "בן זוג ושלושה ילדים",
        mortgage: "יש, עוד כ-18 שנה",
        health_flag: "יש נושא לדיון בפגישה",
        coverage: "ביטוח בריאות דרך העבודה בלבד",
      },
    });
    const html = r.mailTo(AGENCY).html!;
    expect(html).toContain("ביטוחי חיים ובריאות");
    expect(html).toContain("תלויים");
    expect(html).toContain("בן זוג ושלושה ילדים");
    // The flag is a flag. Nothing downstream should ever hold a description.
    expect(html).toContain("יש נושא לדיון בפגישה");
  });

  it("still works for an interview sent without a schema at all", async () => {
    // The free-text path predates the schema and is what a mid-deploy agent
    // still sends; it must not start dropping summaries.
    const r = await run({
      name: "אורי לוי", phone: "0541112233", email: "", source: "interview",
      topic: "דמי ניהול", message: "· בן 52, שכיר.\n· דאגה: דמי ניהול.",
    });
    expect(r.status).toBe(200);
    expect(r.mailTo(AGENCY).html).toContain("דאגה: דמי ניהול");
  });
});

/**
 * Two mailboxes, one team.
 *
 * The operations copy goes to more than one address now. The risk in a list is
 * not that it is wrong on the happy path — it is that somebody folds it back
 * into a single call, or wraps the whole loop in one `try`, at which point the
 * first mailbox to bounce silently takes the rest of the list with it.
 */
describe.each(IMPLEMENTATIONS)("$label — the operations mailboxes", ({ run }) => {
  const lead = {
    name: "יעל כהן", phone: "0521234567", email: "",
    source: "consultation", topic: "פנסיה", timing: "השבוע",
  };

  it("sends the same operations copy to every mailbox", async () => {
    const r = await run(lead);
    const first = r.mailTo(OPS);
    const second = r.mailTo(OPS2);
    expect(second.subject).toBe(first.subject);
    expect(second.html).toBe(first.html);
    expect(second.text).toBe(first.text);
    // And it is the operations notice, not the agency's copy: a link, no visitor.
    expect(second.html).toContain("https://govari-fin.co.il/admin/leads");
    expect(second.html).not.toContain("יעל כהן");
  });

  it("keeps the agency copy free of the appendix, with the list in place", async () => {
    const r = await run(lead);
    expect(r.mailTo(AGENCY).html).not.toContain("מצב תפעולי");
  });

  it("delivers to the second mailbox when the first bounces", async () => {
    const r = await run(lead, { failEmailTo: [OPS] });
    expect(r.emails.map((e) => e.to)).toContain(OPS2);
    expect(r.json.warnings as string[]).toSatisfy((w: string[]) => w.some((x) => x.startsWith("notify_email_failed")));
    // The lead still stored, and the agency still told.
    expect(r.status).toBe(200);
    expect(r.emails.map((e) => e.to)).toContain(AGENCY);
  });

  it("delivers to the first when the second bounces", async () => {
    const r = await run(lead, { failEmailTo: [OPS2] });
    expect(r.emails.map((e) => e.to)).toContain(OPS);
    expect(r.json.warnings as string[]).toSatisfy((w: string[]) => w.some((x) => x.startsWith("notify_email_failed")));
  });
});

/**
 * The interview, saved twice.
 *
 * Contact details used to be collected last, so a visitor who answered four
 * questions and closed the tab left nothing at all — and for a chat interview
 * that is likely the common case. The agent now saves once as soon as it has a
 * name and a number, and again at the end; the second call has to find the
 * first rather than create a second row, which is also what stops a visitor
 * running the interview three times from producing three leads.
 */
describe.each(IMPLEMENTATIONS)("$label — a partial interview, and the upsert that completes it", ({ run }) => {
  const partial = {
    name: "אורי לוי", phone: "0541112233", email: "", source: "interview",
    stage: "partial", track: "pension",
    profile: { life_stage: "בן 52", goal: "פרישה", concern: "דמי ניהול" },
  };

  it("stores a partial interview and tells nobody", async () => {
    const r = await run(partial);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, stage: "partial", notified: false });
    expect(r.leads).toHaveLength(1);
    expect(r.leads[0]).toMatchObject({ source: "interview", status: "partial" });
    // The point of the early save is the record, not a message: mailing on
    // everyone who starts answering would turn the inbox into noise.
    expect(r.emails).toHaveLength(0);
    // And no invitation: on Edge those are mail too, kept out of `emails` above.
    expect(r.invitations ?? []).toEqual([]);
  });

  it("keeps what was answered so far, so an abandoned interview is still useful", async () => {
    const r = await run(partial);
    const stored = r.leads[0].message as string;
    expect(stored).toContain("שלב חיים: בן 52");
    expect(stored).toContain("דאגה מרכזית: דמי ניהול");
  });

  it("updates that row on completion rather than creating a second", async () => {
    const existing = {
      id: "LEAD-EXISTING", name: "אורי לוי", phone: "0541112233", source: "interview",
      status: "partial", email: "", created_date: new Date().toISOString(),
    };
    const r = await run({
      ...partial,
      stage: "complete",
      profile: { ...partial.profile, employer: "שכיר בהייטק", seniority: "14 שנה" },
    }, { existingLeads: [existing] });

    expect(r.leads, "a second row was created").toHaveLength(0);
    expect(r.leadUpdates).toHaveLength(1);
    expect(r.leadUpdates[0].id).toBe("LEAD-EXISTING");
    expect(r.leadUpdates[0].fields).toMatchObject({ status: "new" });
    expect(r.leadUpdates[0].fields.message).toContain("שכיר בהייטק");
    // And now the mail goes out, against the same record.
    expect(r.json).toMatchObject({ leadId: "LEAD-EXISTING" });
    expect(r.emails.map((e) => e.to)).toContain(AGENCY);
  });

  /**
   * The completion writes the full name and the agreed time — or keeps the
   * time already stored. That both stores agree is Base44's own case, below.
   */
  describe("the completion's name and time", () => {
    // A fresh object per test: an update writes into the stored lead, and a
    // completed one (status "new") is no longer an open interview.
    const opened = () => ({
      id: "LEAD-EXISTING", name: "אורי", phone: "0541112233", source: "interview",
      status: "partial", email: "", timing: "", created_date: new Date().toISOString(),
    });

    it("carries the agreed time and the full name into the update", async () => {
      const r = await run({ ...partial, stage: "complete", timing: "בשבוע הבא" }, { existingLeads: [opened()] });
      expect(r.leadUpdates[0].fields).toMatchObject({ name: "אורי לוי", timing: "בשבוע הבא" });
    });

    it("keeps a time already stored when the completion sends none", async () => {
      const r = await run({ ...partial, stage: "complete" }, { existingLeads: [{ ...opened(), timing: "בבוקר" }] });
      expect(r.leadUpdates[0].fields).toMatchObject({ timing: "בבוקר" });
    });
  });


  it("does not adopt an interview that is too old to be this conversation", async () => {
    // The same person in every other respect — name, phone, address, still
    // partial — so the six-hour window is the only thing that can turn it away.
    const stale = {
      id: "LEAD-OLD", name: "אורי לוי", phone: "0541112233", email: "", source: "interview", status: "partial",
      created_date: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    };
    const r = await run({ ...partial, stage: "complete" }, { existingLeads: [stale] });
    expect(r.leadUpdates).toHaveLength(0);
    expect(r.leads).toHaveLength(1);
  });

  it("completes the newest of two open interviews", async () => {
    // A rerun within the window joins the latest attempt, not the first.
    const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
    const older = {
      id: "LEAD-OLDER", name: "אורי לוי", phone: "0541112233", email: "", source: "interview",
      status: "partial", created_date: hoursAgo(2),
    };
    const newer = { ...older, id: "LEAD-NEWER", created_date: hoursAgo(1) };
    const r = await run({ ...partial, stage: "complete" }, { existingLeads: [older, newer] });
    expect(r.leadUpdates.map((u) => u.id)).toEqual(["LEAD-NEWER"]);
    expect(r.leads).toHaveLength(0);
  });

  it("does not adopt another person's interview", async () => {
    const other = {
      id: "LEAD-OTHER", phone: "0529998888", source: "interview",
      status: "partial", created_date: new Date().toISOString(),
    };
    const r = await run({ ...partial, stage: "complete" }, { existingLeads: [other] });
    expect(r.leadUpdates).toHaveLength(0);
    expect(r.leads).toHaveLength(1);
  });

  /**
   * A phone number is not a secret. Before, anyone who knew one could submit
   * `source: "interview"` with it and overwrite that person's open interview —
   * the email, the message and the status, in both stores.
   */
  describe("whose interview it is", () => {
    const victims = (over: Record<string, unknown> = {}) => [{
      id: "LEAD-VICTIM", name: "אורי לוי", phone: "0541112233", source: "interview",
      status: "partial", email: "uri@example.com", created_date: new Date().toISOString(), ...over,
    }];

    it("does not adopt the same number under another name", async () => {
      const r = await run({ ...partial, name: "מישהו אחר", email: "attacker@example.com", stage: "complete" },
        { existingLeads: victims() },
      );
      expect(r.leadUpdates).toHaveLength(0);
      expect(r.leads).toHaveLength(1);
    });

    it("does not adopt it when the address on file says someone else", async () => {
      const r = await run({ ...partial, email: "attacker@example.com", stage: "complete" },
        { existingLeads: victims() },
      );
      expect(r.leadUpdates).toHaveLength(0);
      expect(r.leads).toHaveLength(1);
    });

    it("does not reopen an interview that was already completed", async () => {
      const r = await run({ ...partial, email: "uri@example.com", stage: "complete" },
        { existingLeads: victims({ status: "new" }) },
      );
      expect(r.leadUpdates).toHaveLength(0);
      expect(r.leads).toHaveLength(1);
    });

    it("still completes the visitor's own interview", async () => {
      const r = await run({ ...partial, name: "  אורי   לוי ", email: "URI@example.com", stage: "complete" },
        { existingLeads: victims() },
      );
      expect(r.leadUpdates.map((u) => u.id)).toEqual(["LEAD-VICTIM"]);
      expect(r.leads).toHaveLength(0);
    });
  });

  it("does not adopt a lead that was never an interview", async () => {
    const form = {
      id: "LEAD-FORM", phone: "0541112233", source: "consultation",
      status: "new", created_date: new Date().toISOString(),
    };
    const r = await run({ ...partial, stage: "complete" }, { existingLeads: [form] });
    expect(r.leadUpdates).toHaveLength(0);
    expect(r.leads).toHaveLength(1);
  });

  it("creates rather than loses the interview when the lookup itself fails", async () => {
    // A duplicate row is a nuisance; a dropped interview is not recoverable.
    const r = await run({ ...partial, stage: "complete" }, {
      existingLeads: [{ id: "LEAD-EXISTING", phone: "0541112233", source: "interview", created_date: new Date().toISOString() }],
      failLeadLookup: true,
    });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
  });

  it("leaves every other source on the create path untouched", async () => {
    const r = await run({
      name: "יעל", phone: "0541112233", source: "quick", message: "שלום",
    }, { existingLeads: [{ id: "LEAD-EXISTING", phone: "0541112233", source: "interview", created_date: new Date().toISOString() }] });
    expect(r.leadUpdates).toHaveLength(0);
    expect(r.leads).toHaveLength(1);
  });
});

/**
 * The completion writes the same name and time to both stores.
 *
 * The update used to leave `name` and `timing` out of the Base44 write while
 * the Supabase mirror took them from the request — so the two copies of one
 * interview disagreed, and reconcile-stores reported 11 of 49 leads drifted
 * on exactly these two fields. Whichever store a screen reads, it should see
 * the time the visitor actually agreed.
 */
describe.each(IMPLEMENTATIONS)("$label — how complete the interview was", ({ run }) => {
  const base = {
    name: "אורי לוי", phone: "0541112233", email: "", source: "interview", track: "pension",
  };

  it("counts answered fields against the track's total", async () => {
    const r = await run({
      ...base,
      profile: { life_stage: "בן 52", goal: "פרישה", concern: "דמי ניהול" },
    });
    // pension carries eight fields — the four common ones including the
    // clearing-house offer, plus the track's four; three were answered.
    expect(r.mailTo(AGENCY).html).toContain("3 מתוך 8 שדות נענו");
    expect(r.mailTo(AGENCY).text).toContain("3 מתוך 8 שדות נענו");
  });

  it("separates what the visitor did not know from what was never asked", async () => {
    // Both matter to someone preparing a meeting, and they are not the same:
    // an unanswered field is a gap in the interview, "לא ידוע למבקר" is a fact
    // about the visitor.
    const r = await run({
      ...base,
      profile: {
        life_stage: "בן 52", goal: "פרישה", concern: "דמי ניהול",
        employer: "שכיר", seniority: "לא ידוע למבקר", fees: "לא ידוע למבקר",
      },
    });
    const html = r.mailTo(AGENCY).html!;
    expect(html).toContain("6 מתוך 8 שדות נענו");
    expect(html).toContain("2 מהם לא ידועים למבקר");
  });

  it("says nothing about unknowns when there are none", async () => {
    const r = await run({
      ...base,
      profile: { life_stage: "בן 52", goal: "פרישה", concern: "דמי ניהול" },
    });
    expect(r.mailTo(AGENCY).html).not.toContain("לא ידועים למבקר");
  });
});

describe.each(IMPLEMENTATIONS)("$label — the topic the interview no longer asks for", ({ run }) => {
  it("derives it from the concern the schema already carries", async () => {
    const r = await run({
      name: "אורי לוי", phone: "0541112233", email: "uri@example.com",
      source: "interview", track: "pension",
      profile: { life_stage: "בן 52", goal: "פרישה", concern: "דמי הניהול גבוהים" },
    });
    expect(r.leads[0].topic).toBe("דמי הניהול גבוהים");
    // And the visitor's confirmation names it, which is where topic is shown.
    expect(r.mailTo("uri@example.com").html).toContain("דמי הניהול גבוהים");
  });

  it("falls back to an explicit topic when no concern was recorded", async () => {
    const r = await run({
      name: "אורי לוי", phone: "0541112233", email: "", source: "interview",
      track: "pension", topic: "נושא שנמסר במפורש",
      profile: { life_stage: "בן 52" },
    });
    expect(r.leads[0].topic).toBe("נושא שנמסר במפורש");
  });

  it("leaves topic alone for every other source", async () => {
    const r = await run({
      name: "יעל", phone: "0521234567", source: "consultation", topic: "פנסיה",
    });
    expect(r.leads[0].topic).toBe("פנסיה");
  });
});

/**
 * The event log in Google Sheets.
 *
 * This existed and had never run. `SHEET_ID` was a hardcoded empty string, so
 * `appendEventRow` returned "לא מוגדר" before touching the network and every
 * test took that branch — the column order was pinned by a contract test, and
 * what actually landed in a row was pinned by nothing.
 *
 * Which mattered, because an interview wrote a blank one: the row took `topic`,
 * which the interview agent stopped sending once the meeting topic was derived,
 * and `summary`, which it never sends at all — the profile travels in
 * `profile`. Name and phone would have arrived in the sheet with the interview
 * itself missing.
 */
describe.each(IMPLEMENTATIONS)("$label — the row it appends to the sheet", ({ run, source, down }) => {
  /** The headers the function declares, read from it rather than repeated here. */
  const SHEET_COLUMNS = (() => {
    const src = readFileSync(join(REPO_ROOT, source), "utf8");
    const i = src.indexOf("const SHEET_COLUMNS = [");
    return src.slice(i, src.indexOf("];", i)).match(/'[^']+'/g)!.map((q) => q.slice(1, -1));
  })();

  const SHEET = { SHEET_ID: "sheet-test-id", MAILER_URL, MAILER_TOKEN: "test-only-token" };

  /** The single row appended, as the Sheets API received it. */
  const rowFrom = (r: Result) => {
    const [call] = r.callsTo("sheets.googleapis.com");
    expect(call, "nothing was appended").toBeTruthy();
    return (call.body as { values: string[][] }).values[0];
  };

  /**
   * What an interview puts in the sheet, and why it is six cells rather than one.
   *
   * Everything the interview collected used to land in `תקציר` as free text:
   * life stage, goal, concern, clearinghouse interest, employer, seniority,
   * products, fees — eight structured answers flattened into one cell. The
   * sheet could show them and nothing else. It could not be asked "who wants a
   * clearinghouse pull?" or "which interviews finished?", which are the two
   * questions it exists to answer.
   *
   * The four asked in every interview get columns because they are comparable
   * across interviews. Track-specific fields stay in the summary: they differ
   * per track, and a column filled in a third of rows is worse than prose.
   */
  describe("the interview's own columns", () => {
    const INTERVIEW = {
      name: "אורי לוי",
      phone: "0541112233",
      source: "interview",
      track: "pension",
      meetingTopic: "גמל, השתלמות ופנסיה",
      timing: "חמישי השבוע, בוקר",
      scheduledAt: "2026-09-24T10:00:00",
      completeness: { answered: 8, total: 8, unknown: 1 },
      profile: {
        life_stage: "שכיר, גרוש עם ארבעה ילדים",
        goal: "שיפור צבירה",
        concern: "דמי ניהול",
        clearinghouse: "מעוניין/ת",
        employer: "משרד החינוך",
        seniority: "שנה",
        products: "פנסיה, גמל, השתלמות",
        fees: "לא ידוע למבקר",
      },
    };
    const at = (label: string) => SHEET_COLUMNS.indexOf(label);

    it("gives each common field its own cell", async () => {
      const row = rowFrom(await run(INTERVIEW, { env: SHEET }));
      expect(row[at("שלב חיים")]).toBe("שכיר, גרוש עם ארבעה ילדים");
      expect(row[at("יעד עיקרי")]).toBe("שיפור צבירה");
      expect(row[at("דאגה מרכזית")]).toBe("דמי ניהול");
      expect(row[at("מסלקה")]).toBe("מעוניין/ת");
    });

    it("writes the agreed slot, not the words around it", async () => {
      // `מועד מבוקש` is what the visitor said; `מועד הפגישה` is what the diary
      // took. Only the second sorts, and "what have I got this week" is asked
      // of the second.
      const row = rowFrom(await run(INTERVIEW, { env: SHEET }));
      expect(row[at("מועד הפגישה")]).toBe("2026-09-24 10:00");
      expect(row[at("מועד מבוקש")]).toBe("חמישי השבוע, בוקר");
    });

    it("records how complete the interview was", async () => {
      const row = rowFrom(await run(INTERVIEW, { env: SHEET }));
      expect(row[at("שלמות")]).toMatch(/8 מתוך 8/);
    });

    it("leaves the new cells empty for everything that is not an interview", async () => {
      // A consultation has no profile and no track. Empty, not absent — a
      // shorter row slides every later column under the wrong heading.
      const row = rowFrom(
        await run({ name: "יעל", phone: "0521234567", source: "consultation", topic: "פנסיה" },
          { env: SHEET },
        ),
      );
      expect(row).toHaveLength(SHEET_COLUMNS.length);
      for (const label of ["שלב חיים", "יעד עיקרי", "דאגה מרכזית", "מסלקה", "שלמות"]) {
        expect(row[at(label)], label).toBe("");
      }
    });

    it("still carries the whole profile in the summary cell", async () => {
      // The columns are for filtering, not a replacement. Employer, seniority,
      // products and fees have no column and must not be lost with the change.
      const row = rowFrom(await run(INTERVIEW, { env: SHEET }));
      const summary = row[at("תקציר")];
      for (const value of ["משרד החינוך", "שנה", "פנסיה, גמל, השתלמות", "לא ידוע למבקר"]) {
        expect(summary, value).toContain(value);
      }
    });
  });

  it("appends one row, in the column order the contract pins", async () => {
    const r = await run({
      name: "יעל כהן", phone: "0521234567", email: "yael@example.com",
      source: "consultation", topic: "פנסיה", timing: "השבוע",
    }, { env: SHEET });

    expect(r.callsTo("sheets.googleapis.com")).toHaveLength(1);
    const row = rowFrom(r);
    // Against the header list itself, not a number copied beside it. A row and
    // its headers drifting apart is the failure that makes every other column
    // in the sheet wrong, and it is invisible until somebody reads it.
    expect(row).toHaveLength(SHEET_COLUMNS.length);
    expect(row[1]).toBe("consultation_request");
    expect(row[2]).toBe("consultation");
    expect(row[5]).toBe("פנסיה");
    expect(row[6]).toBe("השבוע");
    expect(row[7]).toBe("יעל כהן");
    // Leading apostrophe, which Sheets reads as "this is text" and does not
    // display. Without it `valueInputOption=USER_ENTERED` stores 0521234567 as
    // the number 521234567 — the leading zero gone, in the one copy that
    // outlives deleting the Lead.
    expect(row[8]).toBe("'0521234567");
  });

  it("writes the interview's profile, not an empty summary column", async () => {
    const r = await run({
      name: "אורי לוי", phone: "0541112233", email: "", source: "interview",
      track: "pension", meetingTopic: "גמל, השתלמות ופנסיה", timing: "השבוע הבא",
      profile: {
        life_stage: "בן 52, נשוי", goal: "פרישה מסודרת",
        concern: "דמי ניהול", employer: "שכיר בהייטק",
      },
    }, { env: SHEET });

    const row = rowFrom(r);
    expect(row[1]).toBe("interview_summary");
    expect(row[3], "the track is not recorded").toBe("פנסיה, גמל והשתלמות");
    expect(row[5], "the meeting topic is not recorded").toBe("גמל, השתלמות ופנסיה");
    // The point of the whole row.
    expect(row[12]).toContain("שלב חיים: בן 52, נשוי");
    expect(row[12]).toContain("מעסיק / מעמד תעסוקתי: שכיר בהייטק");
  });

  it("writes no row for a partial interview", async () => {
    // A partial is the quiet save that catches someone who abandoned; it mails
    // nobody and it does not reach the sheet either. That is deliberate rather
    // than an oversight: the sheet is the copy that survives deleting the Lead
    // (COMPLIANCE §6), so logging people who started and left would retain
    // their details in the one place a deletion request does not reach. The
    // Lead row already makes an abandoned interview visible in the admin.
    const r = await run({
      name: "אורי לוי", phone: "0541112233", source: "interview", stage: "partial",
      track: "pension", profile: { life_stage: "בן 52", goal: "פרישה", concern: "דמי ניהול" },
    }, { env: SHEET });
    expect(r.emails).toHaveLength(0);
    // And no invitation: on Edge those are mail too, kept out of `emails` above.
    expect(r.invitations ?? []).toEqual([]);
    expect(r.callsTo("sheets.googleapis.com")).toHaveLength(0);
    expect(r.leads, "the record itself is still written").toHaveLength(1);
  });

  it("redacts an identifier before it reaches the sheet", async () => {
    // The sheet is the copy that outlives a deleted Lead — see COMPLIANCE §6.
    const r = await run({
      name: "אורי לוי", phone: "0541112233", source: "interview", track: "pension",
      profile: { life_stage: "מסר ת״ז 123456789", goal: "פרישה", concern: "דמי ניהול" },
    }, { env: SHEET });
    expect(JSON.stringify(rowFrom(r))).not.toContain("123456789");
  });

  it("skips the sheet entirely when none is configured", async () => {
    const r = await run({
      name: "יעל", phone: "0521234567", source: "quick", message: "שלום",
    });
    expect(r.callsTo("sheets.googleapis.com")).toHaveLength(0);
    expect(r.status).toBe(200);
  });

  it("never lets a failed append cost the enquiry", async () => {
    const r = await run({
      name: "יעל", phone: "0521234567", source: "quick", message: "שלום",
    }, { env: SHEET, ...down.sheet });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
    expect(r.json.warnings).toSatisfy((w: string[]) => w.some((x) => x.startsWith("sheet_append_failed")));
  });
});

/**
 * The pension clearing house, offered without an identity number.
 *
 * Pulling a full pension picture before the meeting is the single thing that
 * most improves a first meeting — Dorit arrives with the real products and the
 * real fees instead of what the visitor remembered. The clearing house serves a
 * licence holder only against the client's signed authorisation, so what the
 * interview can usefully collect is the *intent*, not an identifier: an ID typed
 * into a chat advances nothing, and would place a national ID number in the
 * lead, three mailboxes and a spreadsheet — after the visitor accepted a notice
 * telling them not to provide one.
 */
describe.each(IMPLEMENTATIONS)("$label — the clearing-house offer", ({ run }) => {
  const base = {
    name: "אורי לוי", phone: "0541112233", source: "interview", track: "pension",
  };

  it("carries the visitor's answer through to the agency", async () => {
    const r = await run({
      ...base,
      profile: { life_stage: "בן 52", goal: "פרישה", clearinghouse: "מעוניין" },
    });
    const html = r.mailTo(AGENCY).html!;
    expect(html).toContain("שליפת נתוני מסלקה");
    expect(html).toContain("מעוניין");
  });

  it("offers it on every track, not only the pension one", async () => {
    // Someone who came about life cover still has a pension, and the picture is
    // just as useful there.
    for (const track of ["insurance", "retirement", "tax", "savings", "self_employed", "general"]) {
      const r = await run({
        ...base,
        track,
        profile: { life_stage: "בת 40", clearinghouse: "לא" },
      });
      expect(r.mailTo(AGENCY).html, track).toContain("שליפת נתוני מסלקה");
    }
  });

  it("omits the row when the question was never put", async () => {
    // The distinction the whole schema rests on: not asked is not the same as
    // declined, and inventing "לא" would tell Dorit the visitor refused.
    const r = await run({
      ...base,
      profile: { life_stage: "בן 52", goal: "פרישה" },
    });
    expect(r.mailTo(AGENCY).html).not.toContain("שליפת נתוני מסלקה");
  });

  it("redacts an identity number if one reaches the field anyway", async () => {
    // The prompt forbids asking, and forbids recording one volunteered. This is
    // the layer that does not depend on the model having complied.
    const r = await run({
      ...base,
      profile: { life_stage: "בן 52", clearinghouse: "מעוניין, ת\"ז 123456789" },
    });
    const html = r.mailTo(AGENCY).html!;
    expect(html).not.toContain("123456789");
    expect(html).toContain("[הושמט");
  });
});

/**
 * The power of attorney, which is the only thing that actually moves a
 * clearing-house pull forward.
 *
 * An identity number typed into the chat does not — the מסלקה answers a
 * licensed agent holding a signed mandate, so the chat records the intent and
 * the mandate travels by mail. These cases pin that it reaches exactly the
 * people who asked for it, in both halves of the message, and nobody else.
 */
describe.each(IMPLEMENTATIONS)("$label — the clearing-house mandate", ({ run }) => {
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
  const env = { MAILER_URL, MAILER_TOKEN: "test-only-token", POA_URL: "https://example.test/poa.pdf" };

  it("sends the mandate to a visitor who asked for the pull", async () => {
    const r = await run(interested, { env });
    const mail = r.mailTo(base.email);
    expect(mail.html, "the link is missing from the HTML half").toContain("https://example.test/poa.pdf");
    expect(mail.text, "the link is missing from the plain-text half").toContain("https://example.test/poa.pdf");
  });

  it("says nothing about it to a visitor who declined", async () => {
    // A mandate arriving unasked is a document about pension data landing in
    // the inbox of someone who said no to it.
    const r = await run(declined, { env });
    const mail = r.mailTo(base.email);
    expect(mail.html).not.toContain("example.test/poa.pdf");
    expect(mail.text).not.toContain("ייפוי כוח");
  });

  it("says nothing when the question was never put", async () => {
    const r = await run(base, { env });
    expect(r.mailTo(base.email).text).not.toContain("ייפוי כוח");
  });

  it("falls back to the old wording when no document is configured", async () => {
    // A deployment without POA_URL must not promise a link it does not have.
    const r = await run(interested, {
      env: { MAILER_URL, MAILER_TOKEN: "test-only-token" },
    });
    const mail = r.mailTo(base.email);
    expect(mail.text).not.toContain("ייפוי כוח");
    expect(mail.text, "the confirmation itself went missing").toContain("תודה על השיחה");
  });
});

/**
 * Where the copies went, as links rather than as claims.
 *
 * The operations appendix used to say "נרשם ✓" and leave finding the row to the
 * reader. The sheet now carries its address the way the document already did,
 * and both are clickable in the HTML half — a full URL inside a table cell is a
 * long line nobody can click, so the cell keeps the short status and takes the
 * address as its href.
 */
describe.each(IMPLEMENTATIONS)("$label — the operations appendix links to what it wrote", ({ run }) => {
  const env = {
    MAILER_URL,
    MAILER_TOKEN: "test-only-token",
    SHEET_ID: "sheet-test-id",
    SHEET_TAB: "Events",
  };

  it("gives the sheet row an address, in both halves", async () => {
    const r = await run(consultation, { env });
    const ops = r.mailTo(OPS);
    const url = "https://docs.google.com/spreadsheets/d/sheet-test-id/edit";
    expect(ops.text, "the plain-text half has no address to follow").toContain(url);
    expect(ops.html, "the HTML half does not link the row").toContain(`href="${url}"`);
  });

  it("keeps the long address out of the visible cell", async () => {
    // The href carries it; the cell shows the status. A URL rendered as cell
    // text wraps across three lines and is not clickable.
    const r = await run(consultation, { env });
    const html = r.mailTo(OPS).html!;
    const cell = html.slice(html.indexOf("גיליון"), html.indexOf("גיליון") + 400);
    expect(cell).toContain("נרשם ✓");
    expect(cell.replace(/href="[^"]*"/g, ""), "the URL is printed as text too").not.toContain(
      "docs.google.com"
    );
  });

  it("says so plainly when there is no sheet to link to", async () => {
    const r = await run(consultation, {
      env: { MAILER_URL, MAILER_TOKEN: "test-only-token" },
    });
    const ops = r.mailTo(OPS);
    expect(ops.text).toMatch(/גיליון: לא מוגדר/);
    expect(ops.html).not.toContain("spreadsheets/d");
  });
});

/**
 * "No faults" has to mean no faults.
 *
 * A connector that was authorised and is no longer returns no token, and the
 * step that needed it returns a status and exits — no throw, no log, no
 * warning. On 2026-10-04 at 22:03 that is exactly what happened to the summary
 * document: it was never created, and the mail Dorit received said
 * `תקלות: אין`.
 *
 * That line is the one somebody reads instead of checking, which is precisely
 * why it must be true. What is *not* a fault: `לא רלוונטי`, because a quick
 * enquiry is not supposed to produce a document, and `לא מוגדר`, because an
 * absent `SHEET_ID` is a decision somebody made and the appendix states it
 * plainly.
 */
describe.each(IMPLEMENTATIONS)("$label — a step that quietly did not happen says so", ({ run, down }) => {
  const env = { MAILER_URL, MAILER_TOKEN: "test-only-token", SHEET_ID: "sheet-test-id", SHEET_TAB: "Events" };

  it("counts a failed write as a fault", async () => {
    const r = await run(consultation, { env, ...down.sheet });
    expect(r.json.warnings.join(" ")).toMatch(/doc_failed|sheet_append_failed/);
  });

  it("does not call an unconfigured sheet a fault", async () => {
    const r = await run(consultation, {
      env: { MAILER_URL, MAILER_TOKEN: "test-only-token" },
    });
    expect(r.json.warnings.join(" ")).not.toMatch(/sheet_not/);
    expect(r.mailTo(OPS).text).toMatch(/גיליון: לא מוגדר/);
  });
});

/**
 * The two links Dorit needs, in the copy she actually reads.
 *
 * She had the enquiry and the operations team had the links. Her mail went out
 * immediately after the save — before the calendar, the sheet row and the
 * summary document existed — so there was nothing to link to at the time it was
 * built. The links were in the operational appendix, which is deliberately
 * suppressed in her copy, and she found the document by searching Drive.
 *
 * Her send now happens after all three. That is why the sheet, document and
 * calendar fetches each carry an `AbortSignal.timeout`: before, an unresponsive
 * Google delayed an appendix; now it would delay the one message somebody is
 * waiting on.
 */
describe.each(IMPLEMENTATIONS)("$label — the agency copy carries the links", ({ run, down }) => {
  const env = {
    MAILER_URL,
    MAILER_TOKEN: "test-only-token",
    SHEET_ID: "sheet-test-id",
    SHEET_TAB: "Events",
  };
  const SHEET = "https://docs.google.com/spreadsheets/d/sheet-test-id/edit";

  it("builds the sheet link from SHEET_ID, not from the append's reply", async () => {
    // It used to be parsed out of the status string, which made it a hostage to
    // that string: a build returning a bare `נרשם ✓` left Dorit with no link
    // and made the whole block vanish — silently, since as far as the code was
    // concerned there was nothing to link to.
    //
    // The address is known from SHEET_ID and does not need the API to say it.
    const r = await run(consultation, { env });
    expect(r.mailTo(AGENCY).html).toContain(`href="${SHEET}"`);
    expect(r.mailTo(AGENCY).text).toContain(SHEET);
  });

  it("does not link a sheet the row never reached", async () => {
    // The risk of deriving the address from a constant: a link that always
    // works, to a sheet that does not contain this enquiry. The status is still
    // asked whether the row arrived — that is the one thing it is good for.
    const r = await run(consultation, { env, ...down.sheet });
    expect(r.json.warnings.join(" ")).toMatch(/sheet/);
    expect(r.mailTo(AGENCY).html, "linked a sheet the append never wrote to").not.toContain(
      "spreadsheets/d",
    );
  });

  it("does not link a sheet the row never reached", async () => {
    const r = await run(consultation, {
      env: { ...env, SHEET_ID: "" },
    });
    expect(r.mailTo(AGENCY).html).not.toContain("spreadsheets/d");
  });

  it("adds the links without bringing the operational appendix with them", async () => {
    // The distinction the whole change rests on. She gets the addresses; the
    // record id, the warning list and the rest of the ops panel stay internal.
    const r = await run(consultation, { env });
    const mail = r.mailTo(AGENCY);
    expect(mail.html).not.toContain("מצב תפעולי");
    expect(mail.text).not.toContain("מצב תפעולי");
    expect(mail.html).not.toContain(String(r.json.leadId));
  });

  it("does not print the sheet address twice to the operations team", async () => {
    // They read the appendix, which already carries it. A second copy of the
    // same link above it is noise in the mail that is read under pressure.
    const r = await run(consultation, { env });
    expect(r.mailTo(OPS).html!.split(`href="${SHEET}"`)).toHaveLength(2);
  });

  it("omits a link rather than offering a broken one", async () => {
    // No SHEET_ID and no document: the block must not appear at all. A row
    // reading "לפתיחה" over a dead href is worse than an absent row, because
    // it looks like the thing was written when it was not.
    const r = await run({
      name: "דנה לוי",
      phone: "0529876543",
      message: "שאלה קצרה",
    }, { env: { MAILER_URL, MAILER_TOKEN: "test-only-token" } });
    const mail = r.mailTo(AGENCY);
    expect(mail.html).not.toContain("קישורים");
    expect(mail.html).not.toContain("docs.google.com");
    expect(mail.text).not.toContain("── קישורים ──");
  });

  it("sends her copy after the sheet, not before", async () => {
    // The ordering *is* the fix. If her send moves back ahead of the append,
    // the link goes empty again and only this assertion would notice.
    const r = await run(consultation, { env });
    const agencySend = r.fetches.findIndex(
      (f) => f.url === MAILER_URL && (f.body as { to?: string; ics?: string }).to === AGENCY && !(f.body as { ics?: string }).ics,
    );
    const sheetWrite = r.fetches.findIndex((f) => f.url.includes("sheets.googleapis.com"));
    expect(sheetWrite).toBeGreaterThanOrEqual(0);
    expect(agencySend).toBeGreaterThan(sheetWrite);
  });
});

describe("Edge submit-lead — what only it does", () => {
  const consultation = {
    name: "יעל כהן", phone: "0521234567", email: "yael@example.com", source: "consultation",
    topic: "גמל, השתלמות ופנסיה", timing: "בוקר", scheduledAt: "2026-10-20T10:00",
  };

  it("books Dorit's calendar by id, without attendees, and mails each attendee an invitation", async () => {
    const r = await invokeEdge("submit-lead", consultation);
    expect(r.status).toBe(200);
    expect(r.callsTo("/calendar/v3/calendars/govaridorit%40gmail.com/events")).toHaveLength(1);
    expect(r.calendarEvents[0]).not.toHaveProperty("attendees");
    const invited = r.emails.filter((e) => e.ics).map((e) => e.to).sort();
    // Not to the Gmail address: the event is written straight into that calendar.
    expect(invited).toEqual(["amielnoy@outlook.com", "dorit@govari-fin.co.il"]);
    for (const m of r.emails.filter((e) => e.ics)) {
      expect(m.ics).toContain("UID:ev1@google.com");
      expect(m.ics).toContain("METHOD:REQUEST");
    }
  });

  describe("invitations do not depend on the Google event", () => {
    const icsOf = (r: Awaited<ReturnType<typeof invokeEdge>>) => r.emails.filter((e) => e.ics);
    // The enquiry copy: with an invitation also going to Gmail, mailTo() would see two.
    const opsText = (r: Awaited<ReturnType<typeof invokeEdge>>) => r.emails.find((e) => e.to === "amielnoy@gmail.com" && !e.ics)!.text;

    it("sends both with a local UID and a warning when the Google call fails; the lead is saved", async () => {
      const r = await invokeEdge("submit-lead", consultation, { failGoogle: "calendar" });
      expect(r.status).toBe(200);
      expect(r.leads).toHaveLength(1);
      const mails = icsOf(r);
      // The Google event is missing, so Gmail gets the meeting by invitation.
      expect(mails.map((m) => m.to).sort()).toEqual(["amielnoy@gmail.com", "amielnoy@outlook.com", "dorit@govari-fin.co.il"]);
      for (const m of mails) expect(m.ics).toContain(`UID:lead-${r.leads[0].id}@govari-fin.co.il`);
      expect(r.json.warnings).toContain("calendar_google_failed");
      expect(opsText(r)).toMatch(/אירוע ביומן Google לא נוצר/);
      expect(opsText(r)).toMatch(/נשלחו 3\/3/);
    });

    it("sends all three, with no Google request for the event, when GOOGLE_CALENDAR_ID is unset", async () => {
      const r = await invokeEdge("submit-lead", consultation, { envPatch: { GOOGLE_CALENDAR_ID: null } });
      expect(r.status).toBe(200);
      expect(icsOf(r).map((m) => m.to).sort()).toEqual(["amielnoy@gmail.com", "amielnoy@outlook.com", "dorit@govari-fin.co.il"]);
      expect(r.callsTo("/calendar/v3/calendars/")).toEqual([]);
      expect(icsOf(r)[0].ics).toContain("UID:lead-");
    });

    it("keeps the other invitation, says 1/2 and saves the lead when one invitation fails", async () => {
      const r = await invokeEdge("submit-lead", consultation, { failEmailTo: ["amielnoy@outlook.com"] });
      expect(r.status).toBe(200);
      expect(r.leads).toHaveLength(1);
      expect(icsOf(r).map((m) => m.to)).toEqual(["dorit@govari-fin.co.il"]);
      expect(opsText(r)).toMatch(/נשלחו 1\/2/);
      expect(icsOf(r).some((m) => m.to === "amielnoy@gmail.com")).toBe(false);
      expect(r.json.warnings as string[]).toSatisfy((w: string[]) => w.some((x) => x.startsWith("invite_failed")));
    });

    it("is organised by the site, never by an attendee", async () => {
      const r = await invokeEdge("submit-lead", consultation, { failGoogle: "calendar" });
      expect(icsOf(r)).toHaveLength(3);
      for (const m of icsOf(r)) {
        const organizer = /ORGANIZER[^:]*:mailto:(\S+)/.exec(m.ics!.replace(/\r\n /g, ""))![1];
        expect(organizer).toBe("notifications@mail.govari-fin.co.il");
        expect(["amielnoy@outlook.com", "dorit@govari-fin.co.il", "amielnoy@gmail.com"]).not.toContain(organizer);
      }
    });

    it.each([
      ["summer, UTC+3", "2026-07-15T10:00", "DTSTART:20260715T070000Z", "DTEND:20260715T073000Z"],
      ["winter, UTC+2", "2026-12-15T10:00", "DTSTART:20261215T080000Z", "DTEND:20261215T083000Z"],
    ])("puts a 10:00 Israel slot at the right instant in %s, on the local-UID path", async (_n, at, start, end) => {
      const r = await invokeEdge("submit-lead", { ...consultation, scheduledAt: at }, { failGoogle: "calendar" });
      expect(icsOf(r)).toHaveLength(3);
      for (const m of icsOf(r)) {
        expect(m.ics).toContain(start);
        expect(m.ics).toContain(end);
      }
    });

    it("never shares a UID between leads when the insert returned no id", async () => {
      const run = () => invokeEdge("submit-lead", consultation, { failGoogle: "calendar", leadWithoutId: true });
      const uidOf = (r: Awaited<ReturnType<typeof invokeEdge>>) => /UID:(\S+)/.exec(icsOf(r)[0].ics!)![1];
      const [a, b] = [uidOf(await run()), uidOf(await run())];
      expect(a).not.toContain("lead-null");
      expect(a).toMatch(/^lead-.+@govari-fin\.co\.il$/);
      expect(a).not.toBe(b);
    });

    it("reports ready.google from the service account alone", async () => {
      const r = await invokeEdge("submit-lead", {}, { envPatch: { GOOGLE_CALENDAR_ID: null } });
      expect(r.json.ready).toMatchObject({ google: true });
    });
  });

  it("writes a booking row by the lead's Supabase id", async () => {
    const r = await invokeEdge("submit-lead", consultation);
    expect(r.meetings).toHaveLength(1);
    expect(r.meetings[0]).toMatchObject({ lead_id: r.leads[0].id, source: "consultation" });
    expect(String(r.meetings[0].calendar_status)).toMatch(/^אירוע נוצר ✓/);
  });

  it("clips Dorit's invitation for a long interview, and gives the team's diary the name, phone and topic alone", async () => {
    // `notes` is capped at 4,000 characters and the summary, redacted, at 2,000;
    // the body is the two together with its headings, well past the 4,000 the
    // invitation carries. Hence 3,990 of notes (9,000 would be refused) and a 9,000-character summary.
    const notes = "פרטים על המצב הפיננסי ".repeat(420); // ~9,000 Hebrew characters
    expect(notes.length).toBeGreaterThan(8_900);
    const r = await invokeEdge("submit-lead", { ...consultation, summary: notes, notes: notes.slice(0, 3_990) });
    expect(r.status).toBe(200);
    const invitations = r.emails.filter((e) => e.ics);
    expect(invitations.map((m) => m.to).sort()).toEqual([AGENCY, OPS2].sort()); // the Google event exists here
    const encoder = new TextEncoder();
    for (const mail of invitations) expect(encoder.encode(mail.ics!).length, mail.to).toBeLessThan(20_000);
    const unfold = (ics: string) => ics.replace(/\r\n /g, "");
    // Dorit's: the enquiry, clipped to fit.
    expect(unfold(invitations.find((m) => m.to === AGENCY)!.ics!)).toContain("…הפרטים המלאים במייל");
    // The team's diary — the Outlook invitation and the Google event — holds what a
    // meeting needs and nothing more (N-02): the name, the phone, the topic, the record.
    const team = [unfold(invitations.find((m) => m.to === OPS2)!.ics!), invitations.find((m) => m.to === OPS2)!.text!, String(r.calendarEvents[0].description)];
    for (const copy of team) {
      expect(copy).toContain(consultation.name);
      expect(copy).toContain(consultation.phone);
      expect(copy).toContain("https://govari-fin.co.il/admin/leads");
      expect(copy).not.toContain("פרטים על המצב הפיננסי");
    }
    expect(r.json.warnings ?? []).not.toContain("invite_failed");
  });

  it("says so when the booking row cannot be written, once", async () => {
    const r = await invokeEdge("submit-lead", consultation, { failMeetings: true });
    expect(r.status).toBe(200);
    expect(r.leads).toHaveLength(1);
    expect((r.json.warnings as string[]).filter((w) => w === "meeting_write_failed")).toHaveLength(1);
  });

  it("appends the Events row through the service account", async () => {
    const r = await invokeEdge("submit-lead", consultation);
    expect(r.sheetRows).toHaveLength(1);
    expect(r.sheetRows[0].tab).toBe("Events");
    expect(r.sheetRows[0].row[1]).toBe("consultation_request");
  });

  it("asks nothing of Docs, Outlook or Base44", async () => {
    const r = await invokeEdge("submit-lead", consultation);
    for (const host of ["docs.googleapis.com", "graph.microsoft.com", "base44"]) {
      expect(r.callsTo(host), `called ${host}`).toEqual([]);
    }
  });

  // The Google counterparts of Base44's Outlook event cases above.
  it("asks Google for today's reminders, in Israel time", async () => {
    const r = await invokeEdge("submit-lead", consultation);
    expect(r.calendarEvents[0]).toMatchObject({
      start: { dateTime: "2026-10-20T10:00:00", timeZone: "Asia/Jerusalem" },
      reminders: {
        useDefault: false,
        overrides: [{ method: "popup", minutes: 60 }, { method: "email", minutes: 720 }],
      },
    });
  });

  it("authorises with the service account's token and never leaks it to the caller", async () => {
    const r = await invokeEdge("submit-lead", consultation);
    const [call] = r.callsTo("/calendar/v3/calendars/");
    expect(call.headers.Authorization).toBe("Bearer google-test-token");
    expect(JSON.stringify(r.json)).not.toContain("google-test-token");
  });

  it("answers the empty smoke request with what it could do", async () => {
    const r = await invokeEdge("submit-lead", {});
    expect(r.status).toBe(400);
    expect(r.json.ready).toEqual({ db: true, mailer: true, google: true });
    const noGoogle = await invokeEdge("submit-lead", {}, { noGoogle: true });
    expect(noGoogle.json.ready).toMatchObject({ google: false });
  });

  describe("submit-lead — when Google is not there", () => {
    for (const fail of ["token", "calendar", "sheets"] as const) {
      it(`still saves and mails when the ${fail} call fails, with a warning${fail === "sheets" ? "" : " and the invitations still sent"}`, async () => {
        const r = await invokeEdge("submit-lead", consultation, { failGoogle: fail });
        expect(r.status).toBe(200);
        expect(r.leads).toHaveLength(1);
        expect(r.emails.map((e) => e.to)).toContain("dorit@govari-fin.co.il");
        expect(r.json.warnings.length).toBeGreaterThan(0);
        // The sheet failing leaves the event, so Gmail needs no invitation.
        expect(r.emails.filter((e) => e.ics)).toHaveLength(fail === "sheets" ? 2 : 3);
      });
    }

    it("reports a calendar that was never shared as rejected, not as an error page", async () => {
      const r = await invokeEdge("submit-lead", consultation, { calendarStatus: 404 });
      expect(r.status).toBe(200);
      expect(r.json.warnings).toContain("calendar_google_rejected");
    });
  });

  it("completes an interview whose partial save came through Base44", async () => {
    // The switch-over day: the partial row was mirrored from Base44 (it has a
    // base44_id); the completion reaches Edge. One row, updated.
    const partial = {
      id: "00000000-0000-4000-8000-0000000000aa", base44_id: "b44-partial-1", name: "אורי לוי",
      phone: "0541112233", email: "", source: "interview", status: "partial",
      created_at: new Date().toISOString(),
    };
    const r = await invokeEdge("submit-lead", {
      name: "אורי לוי", phone: "0541112233", source: "interview", stage: "complete", track: "pension",
    }, { existingLeads: [partial] });
    expect(r.leads).toHaveLength(0);
    expect(r.leadUpdates.map((u) => u.id)).toEqual(["00000000-0000-4000-8000-0000000000aa"]);
    expect(r.leadUpdates[0].fields).toMatchObject({ status: "new" });
  });
});

/**
 * The short questionnaire (2026-10-14): the lead is saved — and Dorit mailed — at
 * its second step; the optional questions after it arrive as stage "details" and
 * fill in that same lead, with one short follow-up mail.
 */
describe.each(IMPLEMENTATIONS)("$label — the questionnaire's details, after the lead was saved", ({ run }) => {
  const details = {
    name: "אורי לוי", phone: "0541112233", email: "", source: "interview",
    stage: "details", track: "pension",
    profile: { concern: "דמי ניהול", life_stage: "בן 52", goal: "פרישה" },
  };
  const saved = (over: Record<string, unknown> = {}) => [{
    id: "LEAD-SAVED", name: "אורי לוי", phone: "0541112233", source: "interview",
    status: "new", email: "", created_date: new Date().toISOString(), ...over,
  }];

  it("fills in the visitor's lead from a few minutes ago instead of creating a second", async () => {
    const r = await run(details, { existingLeads: saved() });
    expect(r.status).toBe(200);
    expect(r.leads, "a second row was created").toHaveLength(0);
    expect(r.leadUpdates.map((u) => u.id)).toEqual(["LEAD-SAVED"]);
    expect(r.leadUpdates[0].fields).toMatchObject({ status: "new" });
    expect(r.leadUpdates[0].fields.message).toContain("שלב חיים: בן 52");
    expect(r.json).toMatchObject({ ok: true, leadId: "LEAD-SAVED" });
  });

  it("tells Dorit once more, under a subject that says these are further details", async () => {
    const r = await run(details, { existingLeads: saved() });
    expect(r.mailTo(AGENCY).subject.startsWith("פרטים נוספים — ")).toBe(true);
  });

  it("saves the details as a lead of their own when there is no recent one to fill in", async () => {
    const r = await run(details, { existingLeads: [] });
    expect(r.leadUpdates).toHaveLength(0);
    expect(r.leads).toHaveLength(1);
    expect(r.leads[0]).toMatchObject({ source: "interview", status: "new" });
  });

  it("does not fill in a lead older than half an hour", async () => {
    const r = await run(details, { existingLeads: saved({ created_date: new Date(Date.now() - 31 * 60_000).toISOString() }) });
    expect(r.leadUpdates).toHaveLength(0);
    expect(r.leads).toHaveLength(1);
  });

  it("does not fill in another person's lead on the same phone", async () => {
    const r = await run(details, { existingLeads: saved({ name: "מישהו אחר" }) });
    expect(r.leadUpdates).toHaveLength(0);
    expect(r.leads).toHaveLength(1);
  });

  it("does not fill in a lead that was never an interview", async () => {
    const r = await run(details, { existingLeads: saved({ source: "consultation" }) });
    expect(r.leadUpdates).toHaveLength(0);
    expect(r.leads).toHaveLength(1);
  });
});

/** The questionnaire's urgency and clearinghouse report (2026-10-14). */
describe.each(IMPLEMENTATIONS)("$label — urgency and the clearinghouse report", ({ run }) => {
  const lead = {
    name: "אורי לוי", phone: "0541112233", email: "", source: "interview", stage: "complete", track: "pension",
    profile: { concern: "דמי ניהול / הפנסיה שלי", life_stage: "בן 52" },
  };

  it("puts 🔴 דחוף at the head of Dorit's mail when the visitor said it is urgent", async () => {
    const r = await run({ ...lead, profile: { ...lead.profile, urgency: "דחוף — אשמח לשיחה השבוע" } });
    expect(r.mailTo(AGENCY).subject).toBe("🔴 דחוף — סיכום ראיון היכרות — אורי לוי");
    expect(r.leads[0].message as string).toContain("דחיפות: דחוף — אשמח לשיחה השבוע");
  });

  it("leaves the subject as it was for any other urgency", async () => {
    const r = await run({ ...lead, profile: { ...lead.profile, urgency: "בחודשים הקרובים" } });
    expect(r.mailTo(AGENCY).subject).toBe("סיכום ראיון היכרות — אורי לוי");
  });

  it("records whether a clearinghouse report exists, without taking it for the pull", async () => {
    const r = await run({ ...lead, profile: { ...lead.profile, clearinghouse_report: "כן" } });
    expect(r.leads[0].message as string).toContain("דוח מסלקה פנסיונית: כן");
    expect(r.json).not.toHaveProperty("masleka");
  });
});
