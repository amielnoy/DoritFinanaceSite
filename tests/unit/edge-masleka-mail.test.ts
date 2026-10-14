import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildClientHtml } from "../../supabase/functions/_shared/html.ts";
import {
  buildClientInvite,
  buildCodeFailureAlert,
  buildStaffNotice,
  buildWipeNotice,
} from "../../supabase/functions/_shared/masleka-mail.ts";

const LINK = `https://govari-fin.co.il/masleka#t=${"T".repeat(43)}`;
const hrefHosts = (html: string) => [...html.matchAll(/href="https?:\/\/([^/"]+)/g)].map((m) => m[1]);

describe("staff notices", () => {
  it("names the client in the subject and links the board", () => {
    const mail = buildStaffNotice("code_received", ["רונית מזרחי"]);
    expect(mail.subject).toBe("קוד מסלקה חדש לטיפול — רונית מזרחי");
    expect(mail.html).toContain('href="https://govari-fin.co.il/admin/masleka"');
    expect(mail.text).toContain("https://govari-fin.co.il/admin/masleka");
  });

  it("lists every client in one digest when there are several", () => {
    const mail = buildStaffNotice("ready", ["רונית מזרחי", "יעל כהן"]);
    expect(mail.subject).toBe("יש קבצים להורדה מהמסלקה — 2 לקוחות");
    expect(mail.html).toContain("רונית מזרחי");
    expect(mail.html).toContain("יעל כהן");
    expect(mail.text).toContain("• יעל כהן");
  });

  it("says the deadline plainly", () => {
    expect(buildStaffNotice("deadline", ["יעל כהן"]).subject).toBe("נמחק במסלקה בעוד יומיים — יעל כהן");
  });

  it("escapes a name that is really markup", () => {
    const mail = buildStaffNotice("code_received", ['<img src=x onerror="alert(1)">']);
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
  });

  it("keeps a line break in a name out of the subject", () => {
    expect(buildStaffNotice("code_received", ["רונית\nBcc: x@example.com"]).subject).not.toMatch(/\n/);
  });

  it("links only to the agency's own domain", () => {
    for (const kind of ["code_received", "ready", "deadline"] as const) {
      for (const host of hrefHosts(buildStaffNotice(kind, ["א"]).html)) expect(host).toBe("govari-fin.co.il");
    }
  });
});

describe("the alert when a client's code did not go through", () => {
  const RID = "a1b2c3d4";

  it("names the client, says nothing was stored and that the client was asked to retry", () => {
    const mail = buildCodeFailureAlert({ clientName: "רונית מזרחי", failure: "not_saved", rid: RID });
    expect(mail.subject).toBe("מסירת קוד מסלקה נכשלה — רונית מזרחי");
    for (const half of [mail.html, mail.text]) {
      expect(half).toContain("לפני שנשמר דבר");
      expect(half).toContain("התבקש לנסות שוב");
      expect(half).toContain("ממתין להגשה");
      expect(half).toContain(RID);
    }
    expect(mail.html).toContain('href="https://govari-fin.co.il/admin/masleka"');
  });

  it("says when the cause is the missing encryption key", () => {
    const mail = buildCodeFailureAlert({ clientName: null, failure: "unavailable", rid: RID });
    expect(mail.subject).toBe("מסירת קוד מסלקה נכשלה");
    expect(mail.text).toContain("MASLEKA_KEY");
  });

  it("says plainly when it is not known whether the code was stored", () => {
    const mail = buildCodeFailureAlert({ clientName: "יעל כהן", failure: "uncertain", rid: RID });
    expect(mail.text).toContain("לא ברור אם הקוד נשמר");
    expect(mail.text).toContain("דורית תיצור קשר");
    expect(mail.text).not.toContain("התבקש לנסות שוב");
  });

  it("escapes a name that is really markup and keeps it on one line", () => {
    const mail = buildCodeFailureAlert({ clientName: '<img src=x>\nBcc: x@example.com', failure: "not_saved", rid: RID });
    expect(mail.html).not.toContain("<img");
    expect(mail.subject).not.toMatch(/\n/);
  });

  it("links only to the agency's own domain", () => {
    for (const failure of ["not_saved", "unavailable", "uncertain"] as const) {
      for (const host of hrefHosts(buildCodeFailureAlert({ clientName: "א", failure, rid: RID }).html)) {
        expect(host).toBe("govari-fin.co.il");
      }
    }
  });
});

describe("the notice when an unsubmitted code was wiped", () => {
  const wiped = { clientName: "אורי לוי", contactEmail: "uri@example.com", codeReceivedAt: "2026-10-08T21:30:00.000Z" };

  it("names the client and says a new code must be requested", () => {
    const mail = buildWipeNotice(wiped);
    expect(mail.subject).toBe("קוד מסלקה נמחק לפני הגשה — אורי לוי");
    for (const half of [mail.html, mail.text]) {
      expect(half).toContain("אורי לוי");
      expect(half).toContain("uri@example.com");
      expect(half).toContain("9 ימים");
      expect(half).toContain("קוד חדש");
    }
  });

  it("dates the code's arrival on the Israeli calendar", () => {
    // 21:30 UTC on the 8th is 00:30 on the 9th in Israel.
    expect(buildWipeNotice(wiped).text).toContain("9.10.2026");
  });

  it("leaves out an address that is missing or not one", () => {
    for (const contactEmail of [null, "not an address"]) {
      const mail = buildWipeNotice({ ...wiped, contactEmail });
      expect(mail.text).not.toContain("מייל:");
      expect(mail.text).not.toContain("not an address");
    }
  });

  it("escapes a name that is really markup and keeps it on one line", () => {
    const mail = buildWipeNotice({ ...wiped, clientName: '<img src=x>\nBcc: x@example.com' });
    expect(mail.html).not.toContain("<img");
    expect(mail.subject).not.toMatch(/\n/);
  });

  it("links only to the agency's own domain", () => {
    for (const host of hrefHosts(buildWipeNotice(wiped).html)) expect(host).toBe("govari-fin.co.il");
  });
});

describe("the client invitation", () => {
  it("carries the personal link in both halves", () => {
    const mail = buildClientInvite("רונית מזרחי", LINK);
    expect(mail.subject).toBe("שליפת נתוני מסלקה — מסירת קוד · דורית גוב ארי");
    expect(mail.html).toContain(LINK);
    expect(mail.text).toContain(LINK);
    expect(mail.html).toContain("שלום רונית,");
  });

  it("says a reminder replaces the earlier link", () => {
    const mail = buildClientInvite("רונית מזרחי", LINK, true);
    expect(mail.subject).toBe("תזכורת: מסירת קוד המסלקה · דורית גוב ארי");
    expect(mail.text).toContain("מחליף");
  });

  it("greets without a name that is not a name", () => {
    const mail = buildClientInvite("<a href='https://evil.example'>x</a>", LINK);
    expect(mail.html).toContain("שלום,");
    expect(mail.html).not.toContain("evil.example");
    expect(mail.text).not.toContain("evil.example");
  });

  it("offers the link as a clickable button, and keeps it in the text too", () => {
    for (const reminder of [false, true]) {
      const mail = buildClientInvite("רונית מזרחי", LINK, reminder);
      expect(mail.html).toContain(`<a href="${LINK}"`);
      expect(mail.text).toContain(LINK);
    }
  });
});

describe("the shared client letter without an action", () => {
  it("is byte-for-byte what it was before the button existed", () => {
    const html = buildClientHtml({
      firstName: "דנה",
      eyebrow: "e",
      heading: "h",
      intro: "i",
      panelTitle: "p",
      details: [["a", "b"], ["c", "d<"]],
    });
    expect(createHash("sha256").update(html).digest("hex")).toBe(
      "5b27348d1644dae478801236621605f78733c56f505c95b526b200b7826703a6",
    );
  });
});
