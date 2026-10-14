import { describe, expect, it } from "vitest";
import { isIsraeliMobile, isIsraeliPhone } from "@/lib/phone";

describe("isIsraeliMobile", () => {
  it.each(["050-1234567", "0521234567", "054 123 4567", "+972-50-1234567", "972501234567", "+972 58 123 4567"])("accepts %s", (v) => {
    expect(isIsraeliMobile(v)).toBe(true);
  });

  it.each([
    ["a landline", "03-1234567"],
    ["a 9-digit mobile", "050123456"],
    ["an 11-digit mobile", "05012345678"],
    ["letters", "050-12a4567"],
    ["nothing", ""],
    ["a foreign number", "+1 202 555 0143"],
  ])("refuses %s (%s)", (_label, v) => {
    expect(isIsraeliMobile(v)).toBe(false);
  });
});

describe("isIsraeliPhone", () => {
  it("still accepts a landline — escalateToHuman's rule, unchanged", () => {
    expect(isIsraeliPhone("03-1234567")).toBe(true);
  });
});
