// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { readFirstSheet, XlsxError } from "@/lib/har-habituach/xlsx";
import { HEADERS, IGNORED_HEADERS, MappingError, readPolicies } from "@/lib/har-habituach/mapping";
import { checkCoverage, checkSummary, coverageType, monthlyPremium } from "@/lib/har-habituach/check";
import { buildXlsx, HB_ROWS } from "../fixtures/har-habituach";

const trimmed = (rows: string[][]) => rows.map((r) => r.map((c) => c.trim()));

describe("readFirstSheet — the export read in the browser", () => {
  it("reads Har HaBituach's prefixed XML (x:row) and Excel's plain XML alike", () => {
    for (const prefixed of [true, false]) {
      const rows = readFirstSheet(buildXlsx(HB_ROWS, prefixed));
      expect(rows[3]).toEqual(HB_ROWS[3]);
      expect(rows[5].slice(1, 9)).toEqual(HB_ROWS[5].slice(1, 9));
      expect(rows[1][10]).toBe("01/01/2026"); // an inline string
    }
  });

  it("refuses a file that is not an xlsx, and an xlsx with no sheet", () => {
    expect(() => readFirstSheet(strToU8("not a zip"))).toThrow(XlsxError);
    expect(() => readFirstSheet(zipSync({ "xl/workbook.xml": strToU8("<workbook/>") }))).toThrowError(
      expect.objectContaining({ reason: "no_sheet" }),
    );
  });
});

describe("readPolicies — the column mapping", () => {
  const policies = readPolicies(trimmed(HB_ROWS));

  it("finds the header below the title and reads one policy per row, in its section", () => {
    expect(policies.map((p) => p.section)).toEqual([
      ...Array(4).fill("תחום - כללי"),
      ...Array(3).fill("תחום - בריאות ותאונות אישיות"),
      "תחום - חיים ואבדן כושר עבודה",
    ]);
  });

  it("reads the premium as a number and its period as monthly or yearly", () => {
    expect(policies[0]).toMatchObject({ premium: 1800, premiumPeriod: "yearly" });
    expect(policies[4]).toMatchObject({ premium: 45.5, premiumPeriod: "monthly" });
  });

  it("never reads the ID number, the policy number or the free text into a policy", () => {
    const text = JSON.stringify(policies);
    expect(text).not.toContain("000000018");
    expect(text).not.toContain("FAKE-0001");
    expect(IGNORED_HEADERS).toEqual(["תעודת זהות", "מספר פוליסה", "פרטים נוספים", "סיווג תכנית"]);
    expect(Object.values(HEADERS)).not.toEqual(expect.arrayContaining([...IGNORED_HEADERS]));
  });

  it("skips a repeated header and reads an unreadable premium as unknown", () => {
    const rows = trimmed(HB_ROWS);
    rows.push(HB_ROWS[3], ["", "ביטוח בריאות", "ייעוץ ובדיקות", "פוליסת ביטוח", "חברה ג", "", "", "—", "חודשית"]);
    const read = readPolicies(rows);
    expect(read).toHaveLength(9);
    expect(read.at(-1)).toMatchObject({ premium: null, subBranch: "ייעוץ ובדיקות" });
  });

  it("says so when the file has no Har HaBituach table", () => {
    expect(() => readPolicies([["a", "b"], ["c"]])).toThrow(MappingError);
  });
});

describe("checkCoverage — the double-coverage check", () => {
  const check = checkCoverage(readPolicies(trimmed(HB_ROWS)));

  it("flags a type held in two policies, but never per-asset car or home policies", () => {
    const flagged = check.groups.filter((g) => g.possibleDuplicate).map((g) => [g.type, g.policies.length]);
    expect(flagged).toEqual([["תרופות - בסיס", 2]]);
    expect(check.groups.find((g) => g.type === "רכב חובה")).toMatchObject({ possibleDuplicate: false });
    expect(check.possibleDuplicates).toBe(1);
  });

  it("keeps a service rider apart from the policy it rides on", () => {
    const [rider, policy] = [check.groups.find((g) => g.type === "כתב שירות שמשות"), check.groups.find((g) => g.type === "ביטוח מקיף")];
    expect(rider?.policies).toHaveLength(1);
    expect(policy?.policies).toHaveLength(1);
    expect(coverageType({ ...policy!.policies[0], productType: "כתב שירות שמשות" })).toBe("כתב שירות שמשות");
  });

  it("lists the expected coverages no policy has", () => {
    expect(check.missing).toEqual(["ניתוחים", "השתלות וטיפולים מיוחדים בחו\"ל", "אובדן כושר עבודה"]);
  });

  it("totals every premium as a monthly amount", () => {
    const yearly = (1800 + 1500 + 120 + 2400) / 12;
    expect(check.totalMonthlyPremium).toBeCloseTo(yearly + 45.5 + 39.9 + 60 + 80, 6);
    expect(monthlyPremium({ ...readPolicies(trimmed(HB_ROWS))[0], premium: null })).toBe(0);
  });

  it("puts possible duplicates first", () => {
    expect(check.groups[0].possibleDuplicate).toBe(true);
  });
});

describe("checkSummary — what goes to Dorit", () => {
  it("names counts, the flagged types with their companies and the missing types — and no identifier", () => {
    const text = checkSummary(checkCoverage(readPolicies(trimmed(HB_ROWS))));
    expect(text).toContain("8 פוליסות");
    expect(text).toContain("- תרופות - בסיס (2 פוליסות: חברה ג, חברה ב)");
    expect(text).toContain("כדאי לבדוק (לא נמצא בקובץ): ניתוחים");
    expect(text).not.toMatch(/000000018|FAKE-0001/);
    expect(text.length).toBeLessThanOrEqual(1800);
  });

  it("says when nothing looks duplicated", () => {
    expect(checkSummary(checkCoverage([]))).toContain("לא נמצא כפל אפשרי.");
  });
});
