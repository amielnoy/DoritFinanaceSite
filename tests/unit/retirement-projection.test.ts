import { describe, expect, it } from "vitest";
import { clampTo, CONVERSION_FACTOR, projectRetirement, RANGES, whatIf, WHAT_IF, type RetirementInput } from "@/lib/retirement-projection";

const BASE: RetirementInput = {
  currentAge: 40,
  retirementAge: 67,
  currentBalance: 200_000,
  monthlyDeposit: 2_000,
  feeOnBalance: 0.3,
  annualReturn: 4,
};

describe("projectRetirement", () => {
  it("compounds monthly at the return less the fee, deposit at each month's end", () => {
    const r = projectRetirement({ ...BASE, currentAge: 59, retirementAge: 60 });
    let b = 200_000;
    const net = (0.04 - 0.003) / 12;
    for (let m = 0; m < 12; m++) b = b * (1 + net) + 2_000;
    expect(r.finalBalance).toBeCloseTo(b, 6);
  });

  it("turns the balance into a pension at a factor of 200", () => {
    const r = projectRetirement(BASE);
    expect(CONVERSION_FACTOR).toBe(200);
    expect(r.monthlyPension).toBeCloseTo(r.finalBalance / 200, 9);
  });

  it("adds up every month's fee, and none when the fee is 0", () => {
    const r = projectRetirement(BASE);
    expect(r.cumulativeFees).toBeGreaterThan(0);
    const free = projectRetirement({ ...BASE, feeOnBalance: 0 });
    expect(free.cumulativeFees).toBe(0);
    expect(free.finalBalance).toBeGreaterThan(r.finalBalance);
  });

  it("charts one point per birthday, today first and retirement last", () => {
    const r = projectRetirement(BASE);
    expect(r.yearly).toHaveLength(28);
    expect(r.yearly[0]).toEqual({ age: 40, balance: 200_000 });
    expect(r.yearly.at(-1)).toEqual({ age: 67, balance: r.finalBalance });
  });

  it("projects nothing forward when retirement is not after today", () => {
    const r = projectRetirement({ ...BASE, currentAge: 64, retirementAge: 60 });
    expect(r.finalBalance).toBe(200_000);
    expect(r.cumulativeFees).toBe(0);
    expect(r.yearly).toEqual([{ age: 64, balance: 200_000 }]);
  });

  it("reads a value below its minimum, or not a number, as the minimum", () => {
    const r = projectRetirement({ ...BASE, monthlyDeposit: Number.NaN, currentBalance: -5, annualReturn: 0 });
    const same = projectRetirement({ ...BASE, monthlyDeposit: 0, currentBalance: 0, annualReturn: RANGES.annualReturn.min });
    expect(r).toEqual(same);
  });
});

describe("clampTo — what the sliders accept", () => {
  it("keeps a value inside its range", () => {
    expect(clampTo("currentAge", 12)).toBe(20);
    expect(clampTo("retirementAge", 80)).toBe(70);
    expect(clampTo("feeOnBalance", 3)).toBe(1.5);
    expect(clampTo("monthlyDeposit", Number.NaN)).toBe(0);
    expect(clampTo("currentBalance", 500_000)).toBe(500_000);
  });
});

describe("whatIf — the two variations", () => {
  it("adds ₪500 a month, even past the slider's top", () => {
    const top = { ...BASE, monthlyDeposit: RANGES.monthlyDeposit.max };
    expect(whatIf(top).moreDeposit.finalBalance).toBeGreaterThan(projectRetirement(top).finalBalance);
    expect(WHAT_IF.extraDeposit).toBe(500);
  });

  it("lowers the fee to 0.15%, and never raises one already below it", () => {
    expect(whatIf(BASE).lowerFee.finalBalance).toBeGreaterThan(projectRetirement(BASE).finalBalance);
    const cheap = { ...BASE, feeOnBalance: 0.1 };
    expect(whatIf(cheap).lowerFee).toEqual(projectRetirement(cheap));
  });
});
