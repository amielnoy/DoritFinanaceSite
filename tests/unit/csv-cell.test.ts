import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/csv";

/* The leads export: a visitor's text must reach Excel as text, never as a formula (review 2026-10-15). */

describe("csvCell", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["+972501234567", "'+972501234567"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\t=cmd", "'\t=cmd"],
    ["\r=cmd", "\"'\r=cmd\""],
  ])("neutralises a value Excel would run: %j → %j", (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });

  it("quotes commas, quotes and newlines, after neutralising", () => {
    expect(csvCell('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
    expect(csvCell("שורה\nשנייה")).toBe('"שורה\nשנייה"');
  });

  it("leaves ordinary text, numbers and empties as they were", () => {
    expect(csvCell("יעל כהן")).toBe("יעל כהן");
    expect(csvCell("0521234567")).toBe("0521234567");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});
