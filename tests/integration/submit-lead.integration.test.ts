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

    expect(r.emails.map((e) => e.to).sort()).toEqual([OPS, OPS2, AGENCY, "yael@example.com"].sort());
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
      // Both halves, because a reader gets whichever one their client renders.
      // A field that reached only the text copy would be invisible to everyone
      // in practice — which is what makes checking both worth the repetition.
      for (const [part, content] of [["html", mail.html], ["text", mail.text]] as const) {
        expect(content, `${to} (${part})`).toContain("יעל כהן");
        expect(content, `${to} (${part})`).toContain("0521234567");
        expect(content, `${to} (${part})`).toContain("עברה מעביד לעצמאית השנה");
      }
    }
  });

  it("adds the operational appendix only to the operations copy", async () => {
    const r = await invokeFunction("submitLead", consultation);
    expect(r.mailTo(OPS).html).toContain("מצב תפעולי");
    expect(r.mailTo(OPS).text).toContain("מצב תפעולי");
    expect(r.mailTo(AGENCY).html).not.toContain("מצב תפעולי");
    expect(r.mailTo(AGENCY).text).not.toContain("מצב תפעולי");
  });

  it("reports the calendar and sheet outcome in that appendix", async () => {
    const r = await invokeFunction("submitLead", consultation);
    const ops = r.mailTo(OPS).text!;
    expect(ops).toMatch(/יומן: אירוע נוצר/);
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

  it("sends every copy as HTML with a plain-text twin", async () => {
    // The staff copies used to be text-only, and Gmail collapsed the newlines
    // into one running paragraph — eight fields, no line breaks, unreadable on
    // a phone. They are laid out now like the visitor's, and keep the text as
    // the fallback rather than as the only form.
    const r = await invokeFunction("submitLead", consultation);
    for (const to of [AGENCY, OPS, "yael@example.com"]) {
      expect(r.mailTo(to).html, to).toContain("<table");
      expect(r.mailTo(to).text, to).toBeTruthy();
    }
  });

  it("breaks the staff copy into blocks rather than one running paragraph", async () => {
    // The point of the rewrite, stated as something that can fail: the reader
    // gets separated, titled sections. Asserting on the headings rather than on
    // markup keeps this about legibility and not about a particular table.
    const r = await invokeFunction("submitLead", consultation);
    const html = r.mailTo(OPS).html!;
    for (const heading of ["מי פנה", "הבקשה", "תקציר השיחה", "מצב תפעולי"]) {
      expect(html, heading).toContain(heading);
    }
  });

  it("skips the visitor's confirmation when no address was given", async () => {
    const r = await invokeFunction("submitLead", { ...consultation, email: "" });
    expect(r.emails.map((e) => e.to).sort()).toEqual([OPS, OPS2, AGENCY].sort());
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
    expect(r.mailTo(AGENCY).text).toContain('<a href="https://evil.example">');
  });

  it("renders no live markup into the staff HTML either", async () => {
    // The staff copy became a rendered email, so it inherited the vector the
    // visitor's copy already guarded against — and this one is worse: it is the
    // mail Dorit opens on her phone, and the attacker controls the name and the
    // topic. Every field goes through escapeHtml; this is what says so.
    const r = await invokeFunction("submitLead", hostile);
    for (const to of [AGENCY, OPS]) {
      const html = r.mailTo(to).html!;
      expect(html, to).not.toContain("<img src=x");
      expect(html, to).not.toContain('onerror="');
      expect(html, to).not.toContain('<a href="https://evil.example"');
      // Present, but as text the client displays rather than markup it runs.
      expect(html, to).toContain("&lt;img src=x");
      expect(html, to).toContain("&lt;a href=&quot;https://evil.example&quot;");
    }
  });

  it("does not turn a hostile phone number into a live link", async () => {
    // The phone is the one field rendered into an href. Anything that is not a
    // digit or a leading + is stripped before it gets there, so the attribute
    // cannot be escaped out of.
    const r = await invokeFunction("submitLead", {
      ...hostile,
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
      expect(`${mail.html ?? ""}${mail.text ?? ""}`, mail.to).not.toContain("123456789");
      expect(`${mail.html ?? ""}${mail.text ?? ""}`, mail.to).not.toContain("4580");
    }
  });

  it("says why the text changed, rather than silently deleting", async () => {
    const r = await invokeFunction("submitLead", {
      ...consultation,
      summary: "ת״ז 123456789",
    });
    expect(r.mailTo(AGENCY).text).toContain("הושמט");
    expect(r.mailTo(AGENCY).html).toContain("הושמט");
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
    expect(r.mailTo(OPS).text).toMatch(/יומן: לא נוצר/);
    expect(r.mailTo(OPS).text).toMatch(/תקלות:.*calendar_event_failed/);
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
    expect(r.mailTo(OPS).text).toMatch(/יומן: לא רלוונטי/);
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
describe("submitLead — a finished introduction interview", () => {
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
    const r = await invokeFunction("submitLead", interview);

    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, warnings: [] });
    expect(r.emails.map((e) => e.to).sort()).toEqual([OPS, OPS2, AGENCY, "uri@example.com"].sort());
    for (const to of [AGENCY, OPS]) {
      expect(r.mailTo(to).html, to).toContain("<table");
      expect(r.mailTo(to).text, to).toBeTruthy();
    }
  });

  it("carries the whole approved profile in both halves of the staff copy", async () => {
    const r = await invokeFunction("submitLead", interview);
    for (const to of [AGENCY, OPS]) {
      const mail = r.mailTo(to);
      for (const [part, content] of [["html", mail.html], ["text", mail.text]] as const) {
        expect(content, `${to} (${part})`).toContain("אורי לוי");
        expect(content, `${to} (${part})`).toContain("0541112233");
        expect(content, `${to} (${part})`).toContain("דמי הניהול בקרן ההשתלמות");
        expect(content, `${to} (${part})`).toContain("פרישה מסודרת בעוד כעשור");
      }
    }
  });

  it("names itself an interview rather than an enquiry", async () => {
    const r = await invokeFunction("submitLead", interview);
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
    const r = await invokeFunction("submitLead", interview);
    const html = r.mailTo(AGENCY).html!;
    for (const heading of ["מי פנה", "הראיון", "פרופיל המבקר"]) {
      expect(html, heading).toContain(heading);
    }
  });

  it("stores the profile on the record under the interview source", async () => {
    const r = await invokeFunction("submitLead", interview);
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

  it("books no calendar slot — an interview agrees no time", async () => {
    const r = await invokeFunction("submitLead", interview);
    expect(r.callsTo("graph.microsoft.com")).toEqual([]);
    expect(r.mailTo(OPS).text).toMatch(/יומן: לא רלוונטי/);
  });

  it("redacts the profile itself, not only a separate summary", async () => {
    // The profile is written by a model, not typed by the visitor: the agent
    // is told never to record an ID number, but the visitor can type one
    // mid-conversation and the model can reflect it back into the summary.
    const r = await invokeFunction("submitLead", {
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
    const r = await invokeFunction("submitLead", interview);
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
    const r = await invokeFunction("submitLead", { ...interview, email: "" });
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
describe("submitLead — the interview schema", () => {
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
    const r = await invokeFunction("submitLead", pension);
    const html = r.mailTo(AGENCY).html!;
    for (const label of ["שלב חיים", "יעד עיקרי", "דאגה מרכזית", "מעסיק / מעמד תעסוקתי", "ותק", "מוצרים קיימים"]) {
      expect(html, label).toContain(label);
    }
    for (const value of ["בן 52, נשוי, שני ילדים", "שכיר בהייטק", "בערך 14 שנה", "לא ידוע למבקר"]) {
      expect(html, value).toContain(value);
    }
  });

  it("names the track it ran", async () => {
    const r = await invokeFunction("submitLead", pension);
    expect(r.mailTo(AGENCY).html).toContain("פנסיה, גמל והשתלמות");
    expect(r.mailTo(AGENCY).text).toContain("פנסיה, גמל והשתלמות");
  });

  it("drops a key the model invented", async () => {
    // The whitelist is the point: a schema the model can extend is not a schema.
    const r = await invokeFunction("submitLead", {
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
    const r = await invokeFunction("submitLead", {
      ...pension,
      profile: { ...pension.profile, health_flag: "יש נושא לדיון בפגישה" },
    });
    expect(r.mailTo(AGENCY).html).not.toContain("סוגיה בריאותית");
  });

  it("omits a field the visitor never answered, rather than printing a dash", async () => {
    const r = await invokeFunction("submitLead", {
      ...pension,
      profile: { life_stage: "בן 52", goal: "פרישה", concern: "דמי ניהול" },
    });
    const html = r.mailTo(AGENCY).html!;
    expect(html).toContain("שלב חיים");
    expect(html).not.toContain("ותק");
  });

  it("redacts an identifier the model echoed into a field", async () => {
    const r = await invokeFunction("submitLead", {
      ...pension,
      profile: { ...pension.profile, employer: "שכיר, ת״ז 123456789" },
    });
    for (const mail of r.emails) {
      expect(`${mail.html ?? ""}${mail.text ?? ""}`, mail.to).not.toContain("123456789");
    }
    expect(JSON.stringify(r.leads[0])).not.toContain("123456789");
  });

  it("stores the same fields it mailed, so record and mail cannot disagree", async () => {
    const r = await invokeFunction("submitLead", pension);
    const stored = r.leads[0].message as string;
    expect(stored).toContain("שלב חיים: בן 52, נשוי, שני ילדים");
    expect(stored).toContain("ותק: בערך 14 שנה");
  });

  it("carries the collect-not-advise declaration on every interview", async () => {
    const r = await invokeFunction("submitLead", pension);
    for (const to of [AGENCY, OPS]) {
      for (const part of [r.mailTo(to).html, r.mailTo(to).text]) {
        expect(part, to).toContain("אינו בירור צרכים");
      }
    }
  });

  it("runs the insurance track off the same machinery", async () => {
    const r = await invokeFunction("submitLead", {
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
    const r = await invokeFunction("submitLead", {
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
describe("submitLead — the operations mailboxes", () => {
  const lead = {
    name: "יעל כהן", phone: "0521234567", email: "",
    source: "consultation", topic: "פנסיה", timing: "השבוע",
  };

  it("sends the same operations copy to every mailbox", async () => {
    const r = await invokeFunction("submitLead", lead);
    const first = r.mailTo(OPS);
    const second = r.mailTo(OPS2);
    expect(second.subject).toBe(first.subject);
    expect(second.html).toBe(first.html);
    expect(second.text).toBe(first.text);
    // And it is the operations copy, not the agency's: appendix included.
    expect(second.html).toContain("מצב תפעולי");
  });

  it("keeps the agency copy free of the appendix, with the list in place", async () => {
    const r = await invokeFunction("submitLead", lead);
    expect(r.mailTo(AGENCY).html).not.toContain("מצב תפעולי");
  });

  it("delivers to the second mailbox when the first bounces", async () => {
    const r = await invokeFunction("submitLead", lead, { failEmailTo: [OPS] });
    expect(r.emails.map((e) => e.to)).toContain(OPS2);
    expect(r.json.warnings).toContain("notify_email_failed");
    // The lead still stored, and the agency still told.
    expect(r.status).toBe(200);
    expect(r.emails.map((e) => e.to)).toContain(AGENCY);
  });

  it("delivers to the first when the second bounces", async () => {
    const r = await invokeFunction("submitLead", lead, { failEmailTo: [OPS2] });
    expect(r.emails.map((e) => e.to)).toContain(OPS);
    expect(r.json.warnings).toContain("notify_email_failed");
  });
});
