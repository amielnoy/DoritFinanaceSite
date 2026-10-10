import { describe, expect, it } from "vitest";
import { HEBREW_CHARS_PER_MINUTE, readingMinutes } from "@/lib/reading-time";

describe("readingMinutes", () => {
  it("reads Hebrew at about 1,100 characters a minute", () => {
    expect(HEBREW_CHARS_PER_MINUTE).toBe(1100);
    expect(readingMinutes("א".repeat(5500))).toBe(5);
  });

  it("rounds to the nearest minute", () => {
    expect(readingMinutes("א".repeat(1100 * 3 + 549))).toBe(3);
    expect(readingMinutes("א".repeat(1100 * 3 + 550))).toBe(4);
  });

  it("never says zero minutes, even for an empty or missing body", () => {
    expect(readingMinutes("קצר")).toBe(1);
    expect(readingMinutes("")).toBe(1);
    expect(readingMinutes(undefined)).toBe(1);
  });
});
