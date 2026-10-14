/**
 * The retirement calculator's arithmetic (the /tools section "מחשבון פרישה").
 *
 * Monthly compounding at the net return — the yearly return less the yearly
 * fee on the balance, both divided by twelve — with the monthly deposit added
 * at the end of each month. The pension is the final balance over a
 * conversion factor of 200. No tax, no salary growth, no inflation: the
 * section's disclaimer says so, and the figures are an estimate only.
 */

/** The balance per ₪1 of monthly pension — the common default-fund factor, assumed. */
export const CONVERSION_FACTOR = 200;

export interface RetirementInput {
  currentAge: number;
  retirementAge: number;
  /** ₪ saved today. */
  currentBalance: number;
  /** ₪ deposited each month. */
  monthlyDeposit: number;
  /** Fee on the balance, percent a year. */
  feeOnBalance: number;
  /** Gross return, percent a year. */
  annualReturn: number;
}

export interface YearPoint {
  age: number;
  balance: number;
}

export interface RetirementResult {
  finalBalance: number;
  /** finalBalance / CONVERSION_FACTOR. */
  monthlyPension: number;
  /** Every month's fee on the balance, added up, ₪. */
  cumulativeFees: number;
  /** The balance at each birthday from today to retirement, today first. */
  yearly: YearPoint[];
}

/** The slider ranges — also the clamp for anything typed in. */
export const RANGES = {
  currentAge: { min: 20, max: 64, step: 1 },
  retirementAge: { min: 60, max: 70, step: 1 },
  currentBalance: { min: 0, max: 2_000_000, step: 10_000 },
  monthlyDeposit: { min: 0, max: 10_000, step: 100 },
  feeOnBalance: { min: 0, max: 1.5, step: 0.01 },
  annualReturn: { min: 1, max: 7, step: 0.1 },
} as const satisfies Record<keyof RetirementInput, { min: number; max: number; step: number }>;

/** A value inside its range; anything not a number is the range's minimum. */
export function clampTo(field: keyof RetirementInput, value: number): number {
  const { min, max } = RANGES[field];
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

/**
 * The projection takes any value at or above a field's minimum: the sliders
 * clamp what a visitor enters (`clampTo`), and "ומה אם?" may go past a
 * slider's top (₪500 more than the ₪10,000 maximum). Below the minimum, or not
 * a number, a field is its minimum.
 */
export function projectRetirement(raw: RetirementInput): RetirementResult {
  const input = Object.fromEntries(
    (Object.keys(RANGES) as (keyof RetirementInput)[]).map((k) => {
      const v = raw[k];
      return [k, Number.isFinite(v) && v >= RANGES[k].min ? v : RANGES[k].min];
    }),
  ) as unknown as RetirementInput;
  const years = Math.max(0, input.retirementAge - input.currentAge);
  const growth = input.annualReturn / 100 / 12;
  const fee = input.feeOnBalance / 100 / 12;

  let balance = input.currentBalance;
  let cumulativeFees = 0;
  const yearly: YearPoint[] = [{ age: input.currentAge, balance }];
  for (let year = 1; year <= years; year++) {
    for (let month = 0; month < 12; month++) {
      const charged = balance * fee;
      balance += balance * growth - charged + input.monthlyDeposit;
      cumulativeFees += charged;
    }
    yearly.push({ age: input.currentAge + year, balance });
  }
  return { finalBalance: balance, monthlyPension: balance / CONVERSION_FACTOR, cumulativeFees, yearly };
}

/** The "ומה אם?" box's two variations, as the brief sets them. */
export const WHAT_IF = { extraDeposit: 500, lowerFee: 0.15 } as const;

export function whatIf(input: RetirementInput): { moreDeposit: RetirementResult; lowerFee: RetirementResult } {
  return {
    moreDeposit: projectRetirement({ ...input, monthlyDeposit: input.monthlyDeposit + WHAT_IF.extraDeposit }),
    lowerFee: projectRetirement({ ...input, feeOnBalance: Math.min(input.feeOnBalance, WHAT_IF.lowerFee) }),
  };
}
