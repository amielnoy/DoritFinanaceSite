import { describe, expect, it } from "vitest";
import { httpsUrl, PENSION_CHECK, YEAR_END } from "@/config/offers";

describe("offers — the wording and the outside links", () => {
  it("says no 'חינם' until Dorit confirms she absorbs the clearinghouse's cost", () => {
    expect(JSON.stringify(PENSION_CHECK)).not.toMatch(/חינם|ללא עלות/);
    expect(PENSION_CHECK.calculatorHeadline).toBe("רוצים לדעת כמה אתם משלמים בפועל? בדיקת מסלקה אישית");
  });

  it("points the year-end page at the article its figures come from", () => {
    expect(YEAR_END).toEqual({ path: "/atzmaim-31-12", article: "/blog/sof-shana-atzmaim" });
  });

  it.each([
    ["https://cal.com/dorit/15min", /(^|\.)cal\.com$/, "https://cal.com/dorit/15min"],
    [" https://app.cal.com/dorit ", /(^|\.)cal\.com$/, "https://app.cal.com/dorit"],
    ["http://cal.com/dorit", /(^|\.)cal\.com$/, null],
    ["https://evil.example/cal.com", /(^|\.)cal\.com$/, null],
    ["https://notcal.com/x", /(^|\.)cal\.com$/, null],
    ["", /(^|\.)cal\.com$/, null],
    [undefined, /(^|\.)cal\.com$/, null],
    ["https://whatsapp.com/channel/0029Va", /(^|\.)whatsapp\.com$/, "https://whatsapp.com/channel/0029Va"],
  ])("takes %j only as an https link to its own host", (value, host, expected) => {
    expect(httpsUrl(value, host)).toBe(expected);
  });
});
