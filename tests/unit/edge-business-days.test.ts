import { describe, expect, it } from "vitest";
import { addBusinessDays } from "../../supabase/functions/_shared/business-days.ts";

/**
 * The clearinghouse keeps a download for 7 business days and the site warns
 * on day 5. 2026-10-11 is a Sunday. Holidays are not modelled (README).
 */
describe("addBusinessDays", () => {
  const sunday = new Date("2026-10-11T09:00:00Z");

  it("skips Friday and Saturday: day 5 after a Sunday is the next Sunday", () => {
    expect(addBusinessDays(sunday, 5).toISOString()).toBe("2026-10-18T09:00:00.000Z");
  });

  it("puts day 7 after a Sunday on the Tuesday after", () => {
    expect(addBusinessDays(sunday, 7).toISOString()).toBe("2026-10-20T09:00:00.000Z");
  });

  it("goes from a Thursday straight to Sunday", () => {
    expect(addBusinessDays(new Date("2026-10-15T09:00:00Z"), 1).toISOString()).toBe("2026-10-18T09:00:00.000Z");
  });

  it("reads the weekday in Israel, not in UTC", () => {
    // 22:30 UTC on Thursday is 01:30 on Friday in Israel. One business day on
    // is 01:30 on Sunday in Israel — 22:30 UTC on Saturday.
    expect(addBusinessDays(new Date("2026-10-15T22:30:00Z"), 1).toISOString()).toBe("2026-10-17T22:30:00.000Z");
  });

  it("leaves the instant alone for zero days", () => {
    expect(addBusinessDays(sunday, 0).toISOString()).toBe(sunday.toISOString());
  });

  it("keeps the Israeli wall-clock time and calendar day across the end of daylight saving (25 Oct 2026)", () => {
    // Thursday 22 Oct 00:30 Israel (UTC+3). Four business days on is Wednesday
    // 28 Oct 00:30 Israel (UTC+2, clocks went back on Sunday 25 Oct) = 22:30Z Tuesday.
    // Adding fixed 24 h steps would land on Tuesday 23:30 Israel time.
    expect(addBusinessDays(new Date("2026-10-21T21:30:00Z"), 4).toISOString()).toBe("2026-10-27T22:30:00.000Z");
    // Submitted Thursday 22 Oct 12:00 Israel, day 3 is Tuesday 27 Oct 12:00 Israel (10:00Z).
    expect(addBusinessDays(new Date("2026-10-22T09:00:00Z"), 3).toISOString()).toBe("2026-10-27T10:00:00.000Z");
  });
});
