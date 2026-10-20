import { describe, expect, it } from "vitest";
import type { LeadRecord } from "@/services";
import { broughtThisMonth, nationalPhone, sameNumberLeads, staffLeadLine } from "@/lib/staff-leads";

const lead = (over: Partial<LeadRecord>): LeadRecord =>
  ({ id: "l", name: "x", phone: "050-1", email: "", source: "staff", status: "new", created_date: "2026-10-10T08:00:00Z", ...over }) as LeadRecord;

describe("nationalPhone", () => {
  it("is the same for a landline in two shapes", () => {
    expect(nationalPhone("03-1234567")).toBe("31234567");
    expect(nationalPhone("+972-3-1234567")).toBe("31234567");
  });
  it("is the same for a mobile in two shapes", () => {
    expect(nationalPhone("050-1234567")).toBe("501234567");
    expect(nationalPhone("+972501234567")).toBe("501234567");
    expect(nationalPhone("050-123 4567")).toBe("501234567");
  });
  it("is empty for no digits", () => {
    expect(nationalPhone("abc")).toBe("");
  });
});

describe("broughtThisMonth", () => {
  const now = new Date("2026-11-15T10:00:00Z");
  it("counts per member, in Israel time: 31 Oct 22:30Z is November", () => {
    const map = broughtThisMonth(
      [
        lead({ id: "1", broughtBy: "u1", created_date: "2026-10-31T22:30:00Z" }),
        lead({ id: "2", broughtBy: "u1", created_date: "2026-11-03T08:00:00Z" }),
        lead({ id: "3", broughtBy: "u2", created_date: "2026-11-04T08:00:00Z" }),
        lead({ id: "4", broughtBy: "u2", created_date: "2026-10-31T21:30:00Z" }),
      ],
      now,
    );
    expect(map.get("u1")).toBe(2);
    expect(map.get("u2")).toBe(1);
  });
  it("skips a lead nobody brought", () => {
    const map = broughtThisMonth([lead({ broughtBy: null, created_date: "2026-11-03T08:00:00Z" }), lead({ created_date: "2026-11-03T08:00:00Z" })], now);
    expect(map.size).toBe(0);
  });
});

describe("staffLeadLine", () => {
  const label = (id: string | null) => (id === "u1" ? "dana@x.co" : "חבר/ה שכבר לא בסוכנות");
  it("reads member, intake and notice", () => {
    expect(staffLeadLine(lead({ broughtBy: "u1", intake: "phone", noticeMethod: "email" }), label)).toBe(
      "נוספה ידנית ע״י dana@x.co · שיחת טלפון · יידוע: במייל",
    );
  });
  it("names a member who left", () => {
    expect(staffLeadLine(lead({ broughtBy: "gone", intake: "event", noticeMethod: "verbal" }), label)).toContain("חבר/ה שכבר לא בסוכנות");
    expect(staffLeadLine(lead({ broughtBy: null, intake: "event", noticeMethod: "verbal" }), label)).toContain("חבר/ה שכבר לא בסוכנות");
  });
  it("is null for a lead that came in through the site", () => {
    expect(staffLeadLine(lead({ source: "quick" }), label)).toBeNull();
  });
});

describe("sameNumberLeads", () => {
  it("finds the others with the same national number, not itself", () => {
    const a = lead({ id: "a", phone: "050-1234567", possibleDuplicate: true });
    const b = lead({ id: "b", phone: "+972501234567" });
    const c = lead({ id: "c", phone: "052-1234567" });
    expect(sameNumberLeads([a, b, c], a).map((l) => l.id)).toEqual(["b"]);
  });
});
