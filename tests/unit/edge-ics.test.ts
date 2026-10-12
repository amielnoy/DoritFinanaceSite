import { describe, expect, it } from "vitest";
import { buildInvitation, MAX_ICS_BYTES } from "../../supabase/functions/_shared/ics";

const invite = {
  uid: "abc123@google.com",
  start: new Date("2026-10-14T07:00:00Z"),
  end: new Date("2026-10-14T07:30:00Z"),
  summary: "בקשת ייעוץ חדשה — רונית, מזרחי; בדיקה",
  description: "שם: רונית מזרחי\nטלפון: 0536667788\nתחום ייעוץ: פנסיה, גמל והשתלמות; ביטוח בריאות משלים",
  organizer: "govaridorit@gmail.com",
  organizerName: "דורית גוב ארי",
  attendee: "dorit@govari-fin.co.il",
  stamp: new Date("2026-10-13T08:00:00Z"),
};

const unfold = (ics: string) => ics.replace(/\r\n /g, "");

describe("buildInvitation", () => {
  it("is a REQUEST for one event, in UTC, with the Google event's UID", () => {
    const ics = unfold(buildInvitation(invite));
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain("\r\nMETHOD:REQUEST\r\n");
    expect(ics).toContain("\r\nUID:abc123@google.com\r\n");
    expect(ics).toContain("\r\nDTSTART:20261014T070000Z\r\n");
    expect(ics).toContain("\r\nDTEND:20261014T073000Z\r\n");
    expect(ics).toContain("\r\nDTSTAMP:20261013T080000Z\r\n");
    expect(ics).toContain('\r\nORGANIZER;CN="דורית גוב ארי":mailto:govaridorit@gmail.com\r\n');
    expect(ics).toContain("\r\nATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:dorit@govari-fin.co.il\r\n");
    expect(ics).toMatch(/END:VEVENT\r\nEND:VCALENDAR\r\n$/);
  });

  it("escapes commas, semicolons, backslashes and newlines in text", () => {
    const ics = unfold(buildInvitation({ ...invite, summary: "א, ב; ג\\ד" }));
    expect(ics).toContain("\r\nSUMMARY:א\\, ב\\; ג\\\\ד\r\n");
    expect(ics).toContain("DESCRIPTION:שם: רונית מזרחי\\nטלפון: 0536667788\\nתחום ייעוץ: פנסיה\\, גמל והשתלמות\\; ביטוח בריאות משלים");
  });

  it("folds every line at 75 octets without splitting a Hebrew character", () => {
    const raw = buildInvitation({ ...invite, description: "דורית ".repeat(80) });
    for (const line of raw.split("\r\n")) {
      const bytes = new TextEncoder().encode(line);
      expect(bytes.length, `line too long: ${line.slice(0, 20)}…`).toBeLessThanOrEqual(75);
      // A split sequence decodes to U+FFFD.
      expect(new TextDecoder().decode(bytes)).not.toContain("�");
    }
    expect(unfold(raw)).toContain(`DESCRIPTION:${"דורית ".repeat(80)}`);
  });

  it("refuses an invitation over the size the mailer accepts", () => {
    expect(() => buildInvitation({ ...invite, description: "x".repeat(MAX_ICS_BYTES) })).toThrow("ics_too_large");
  });
});
