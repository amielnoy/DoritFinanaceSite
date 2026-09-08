import { describe, expect, it } from "vitest";
import { computePensionFees, formatIls } from "@/lib/pension-fee";

const BASE = {
  monthlyDeposit: 2000,
  depositFee: 2,
  annualFee: 0.5,
  years: 25,
  annualReturn: 5,
};

describe("computePensionFees — sanity", () => {
  it("returns the site's default scenario with coherent totals", () => {
    const r = computePensionFees(BASE);

    // 25 years × 12 months × ₪2,000
    expect(r.totalDeposited).toBe(600_000);
    // 2% of every deposit
    expect(r.totalDepositFees).toBeCloseTo(12_000, 6);
    expect(r.totalFees).toBeCloseTo(r.totalDepositFees + r.totalAnnualFees, 6);
    // Compounding at 5% must beat the nominal contributions.
    expect(r.balance).toBeGreaterThan(r.totalDeposited);
    expect(r.lostToFees).toBeGreaterThan(0);
  });

  it("is fee-free when both fee rates are zero", () => {
    const r = computePensionFees({ ...BASE, depositFee: 0, annualFee: 0 });

    expect(r.totalDepositFees).toBe(0);
    expect(r.totalAnnualFees).toBe(0);
    expect(r.totalFees).toBe(0);
    // With no fees the balance equals the ideal scenario.
    expect(r.lostToFees).toBeCloseTo(0, 6);
  });

  it("compounds nothing when the expected return is zero", () => {
    const r = computePensionFees({
      monthlyDeposit: 1000,
      depositFee: 0,
      annualFee: 0,
      years: 10,
      annualReturn: 0,
    });

    expect(r.balance).toBeCloseTo(120_000, 6);
    expect(r.totalDeposited).toBe(120_000);
  });

  it("charges deposit fees exactly as a share of gross contributions", () => {
    const r = computePensionFees({ ...BASE, depositFee: 6 });
    expect(r.totalDepositFees).toBeCloseTo(r.totalDeposited * 0.06, 6);
  });

  it("monotonically shrinks the balance as fees rise", () => {
    const low = computePensionFees({ ...BASE, annualFee: 0.1 });
    const mid = computePensionFees({ ...BASE, annualFee: 0.5 });
    const high = computePensionFees({ ...BASE, annualFee: 1.5 });

    expect(low.balance).toBeGreaterThan(mid.balance);
    expect(mid.balance).toBeGreaterThan(high.balance);
    expect(low.lostToFees).toBeLessThan(high.lostToFees);
  });

  it("grows the balance as the horizon lengthens", () => {
    const short = computePensionFees({ ...BASE, years: 5 });
    const long = computePensionFees({ ...BASE, years: 30 });
    expect(long.balance).toBeGreaterThan(short.balance);
    expect(long.totalDeposited).toBeGreaterThan(short.totalDeposited);
  });
});

describe("computePensionFees — hostile input", () => {
  it("treats empty strings, junk and undefined as zero instead of NaN", () => {
    const r = computePensionFees({
      monthlyDeposit: "",
      depositFee: "abc",
      annualFee: "",
      years: "",
      annualReturn: "",
    });

    for (const v of Object.values(r)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBe(0);
    }
  });

  it("accepts numeric strings from the <input type=number> fields", () => {
    const fromStrings = computePensionFees({
      monthlyDeposit: "2000",
      depositFee: "2",
      annualFee: "0.5",
      years: "25",
      annualReturn: "5",
    });
    expect(fromStrings).toEqual(computePensionFees(BASE));
  });

  it("never produces negative or non-finite figures for negative years", () => {
    const r = computePensionFees({ ...BASE, years: -5 });
    expect(r.totalDeposited).toBe(0);
    expect(r.balance).toBe(0);
    expect(Number.isFinite(r.lostToFees)).toBe(true);
  });

  it("floors fractional years to whole months rather than looping oddly", () => {
    const r = computePensionFees({ ...BASE, years: 1.5 });
    expect(r.totalDeposited).toBe(2000 * 18);
  });
});

describe("formatIls", () => {
  it("renders whole shekels with the ILS symbol", () => {
    const out = formatIls(1234.6);
    expect(out).toContain("₪");
    expect(out).toMatch(/1,235/);
    expect(out).not.toMatch(/\.\d/); // no agorot
  });

  it("survives NaN and undefined-ish values", () => {
    expect(formatIls(Number.NaN)).toContain("₪");
    expect(formatIls(0)).toContain("₪");
  });
});
