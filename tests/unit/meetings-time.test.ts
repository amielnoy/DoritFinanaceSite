import { describe, expect, it } from "vitest";
import { israelInstant, israelWallClock } from "@/lib/wall-clock";
import { meetingWhen } from "@/lib/meetings";

/**
 * A staff member types "14.12 at 17:30" and means Israel's clock (A-63). The
 * instant must be right on both sides of a daylight-saving change — Israel
 * leaves summer time on Sunday 25 October 2026 at 02:00.
 */
describe("a meeting's time on Israel's wall clock", () => {
  it("reads summer time (+03:00) before the change", () => {
    expect(israelInstant("2026-10-24", "10:00")).toBe("2026-10-24T07:00:00.000Z");
  });

  it("reads winter time (+02:00) after the change", () => {
    expect(israelInstant("2026-10-26", "10:00")).toBe("2026-10-26T08:00:00.000Z");
  });

  it("reads winter time in December too", () => {
    expect(israelInstant("2026-12-14", "17:30")).toBe("2026-12-14T15:30:00.000Z");
  });

  it("refuses a day or time that does not parse", () => {
    expect(israelInstant("14.12.2026", "17:30")).toBeNull();
    expect(israelInstant("2026-12-14", "5pm")).toBeNull();
  });

  it("round-trips: the instant shows the same day and hour", () => {
    for (const [ymd, hhmm] of [["2026-10-24", "23:30"], ["2026-10-26", "00:15"], ["2026-03-27", "09:00"]]) {
      expect(israelWallClock(israelInstant(ymd, hhmm)!)).toEqual({ ymd, hhmm });
    }
  });

  it("names a meeting by Israel's day, not UTC's, near midnight", () => {
    // 23:30 in Israel on the 24th is 20:30Z the same day; 00:30 on the 15th is 22:30Z on the 14th.
    expect(meetingWhen("2026-12-14T22:30:00.000Z")).toBe("15.12 · 00:30");
    expect(meetingWhen(null)).toBe("לא נקבע מועד");
  });
});
