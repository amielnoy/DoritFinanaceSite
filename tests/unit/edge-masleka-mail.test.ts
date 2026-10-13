import { describe, expect, it } from "vitest";
import { buildClientInvite, buildStaffNotice } from "../../supabase/functions/_shared/masleka-mail.ts";

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
});
