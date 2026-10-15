import { describe, expect, it } from "vitest";
import { isContactPhone, isIsraeliMobile, isIsraeliPhone } from "@/lib/phone";
import { contactPhone } from "../../supabase/functions/_shared/phone";

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

/**
 * The free-text forms' rule, spelled twice: `isContactPhone` in the browser and
 * `contactPhone` in submit-lead / submit-claim. One table for both, so a number
 * the form lets through is never one the backend refuses (D-01).
 */
describe("isContactPhone and the backend's contactPhone", () => {
  const accepted = [
    "050-1234567", "0521234567", "054 123 4567", "03-1234567", "021234567", "077-1234567",
    "+972-50-1234567", "972501234567", "+972 3 123 4567", "97231234567",
  ];
  const refused = [
    ["letters", "abc"],
    ["too short", "123"],
    ["a 7-digit local number", "1234567"],
    ["no leading 0", "501234567"],
    ["too long", "050123456789"],
    ["a 0 after +972", "+9720501234567"],
    ["a foreign number", "+1 202 555 0143"],
    ["nothing", ""],
  ];

  it.each(accepted)("accepts %s", (v) => {
    expect(isContactPhone(v)).toBe(true);
    expect(contactPhone(v)).toBe(true);
  });

  it.each(refused)("refuses %s (%s)", (_label, v) => {
    expect(isContactPhone(v)).toBe(false);
    expect(contactPhone(v)).toBe(false);
  });

  it("accepts everything the questionnaire's rules accept", () => {
    for (const v of ["0501234567", "03 123 4567", "+972 58 123 4567", "972501234567"]) {
      if (isIsraeliPhone(v) || isIsraeliMobile(v)) expect(contactPhone(v), v).toBe(true);
    }
  });

  it("treats a missing phone as refused on the backend", () => {
    expect(contactPhone(undefined)).toBe(false);
    expect(contactPhone(null)).toBe(false);
  });
});
