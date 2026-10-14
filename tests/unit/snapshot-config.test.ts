import { describe, expect, it } from "vitest";
import { isSnapshotOn, SNAPSHOT_REVIEW_BUSINESS_DAYS } from "@/config/snapshot";
import { stepTiming } from "@/components/dorit/sections/SnapshotHome";
import { TOOL_SECTION, toolHref } from "@/config/tools";

describe("the snapshot switch and its copy", () => {
  it.each([
    ["true", true],
    [" true ", true],
    ["TRUE", false],
    ["1", false],
    ["", false],
    [undefined, false],
  ])("reads %j as %s — on only for exactly \"true\"", (value, on) => {
    expect(isSnapshotOn(value)).toBe(on);
  });

  it("shows no timing until Dorit has confirmed one", () => {
    expect(SNAPSHOT_REVIEW_BUSINESS_DAYS).toBeNull();
    expect(stepTiming(null)).toBeNull();
    expect(stepTiming(0)).toBeNull();
    expect(stepTiming(2.5)).toBeNull();
  });

  it("words a confirmed timing in Hebrew", () => {
    expect(stepTiming(1)).toBe("תוך יום עסקים אחד");
    expect(stepTiming(5)).toBe("תוך 5 ימי עסקים");
  });

  it("links every tool to its own section on /tools", () => {
    expect(Object.values(TOOL_SECTION).map(toolHref)).toEqual([
      "/tools#fee-calculator",
      "/tools#assessment",
      "/tools#retirement",
      "/tools#har-habituach",
    ]);
  });
});
