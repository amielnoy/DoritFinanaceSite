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

describe("staff-added clients", () => {
  const base = { id: "x", name: "n", phone: "0500000000", source: "staff" as const, status: "client" as const, created_date: "2026-10-12T08:00:00Z" };

  it("counts this month's clients added by hand, per member, in Israel time", async () => {
    const { clientsThisMonth } = await import("@/lib/staff-leads");
    const counts = clientsThisMonth(
      [
        { ...base, id: "a", broughtBy: "u1", openedAs: "client" },
        { ...base, id: "b", broughtBy: "u1", openedAs: "lead" },
        // 31 Oct 22:30 UTC is already November in Israel
        { ...base, id: "c", broughtBy: "u2", openedAs: "client", created_date: "2026-10-31T22:30:00Z" },
      ],
      new Date("2026-11-02T08:00:00Z"),
    );
    expect([...counts]).toEqual([["u2", 1]]);
  });

  it("writes the drawer line of a client added by hand; a lead's line is unchanged", async () => {
    const { staffLeadLine } = await import("@/lib/staff-leads");
    const label = () => "נועה";
    expect(staffLeadLine({ ...base, openedAs: "client", clientSince: "2019-03", products: ["pension", "health"], broughtBy: "u1" }, label)).toBe(
      "נפתח/ה כלקוח/ה ע״י נועה · לקוח/ה מאז 03/2019 · פנסיה, בריאות וסיעוד",
    );
    expect(staffLeadLine({ ...base, status: "new", openedAs: "lead", intake: "phone", noticeMethod: "verbal", broughtBy: "u1" }, label)).toBe(
      "נוספה ידנית ע״י נועה · שיחת טלפון · יידוע: בעל פה",
    );
  });

  it("labels products and months, and nothing for none", async () => {
    const { productsLabel, sinceLabel } = await import("@/lib/staff-leads");
    expect(productsLabel([])).toBe("");
    expect(productsLabel(null)).toBe("");
    expect(productsLabel(["claims", "other"])).toBe("ליווי תביעות, אחר");
    expect(sinceLabel("2019-03")).toBe("03/2019");
    expect(sinceLabel(null)).toBe("");
  });
});
