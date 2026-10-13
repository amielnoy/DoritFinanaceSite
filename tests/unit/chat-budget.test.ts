import { describe, expect, it } from "vitest";
import { monthKey, monthStartIso, parseBudget, spendUsd } from "../../supabase/functions/chat/budget.ts";

describe("spendUsd", () => {
  it("prices Haiku tokens per million", () => {
    expect(spendUsd([{ model: "claude-haiku-5-5", input_tokens: 1_000_000, cached_tokens: 1_000_000, output_tokens: 1_000_000 }])).toBeCloseTo(0.61, 6);
  });

  it("prices an unknown model at the most expensive known rate, never at zero", () => {
    expect(spendUsd([{ model: "claude-new", input_tokens: 1_000_000, cached_tokens: 0, output_tokens: 0 }])).toBeCloseTo(2, 6);
  });

  it("accepts the totals as PostgREST sends bigints", () => {
    expect(spendUsd([{ model: "claude-haiku-5-5", input_tokens: "2000000" as unknown as number, cached_tokens: 0, output_tokens: 0 }])).toBeCloseTo(0.2, 6);
  });
});

describe("the month", () => {
  const t = Date.UTC(2026, 9, 13, 21, 30);
  it("starts at the first of the UTC month", () => expect(monthStartIso(t)).toBe("2026-10-01T00:00:00.000Z"));
  it("is keyed YYYY-MM", () => expect(monthKey(t)).toBe("2026-10"));
});

describe("parseBudget", () => {
  it("defaults to 50", () => expect(parseBudget(undefined)).toBe(50));
  it("reads a number", () => expect(parseBudget(" 120 ")).toBe(120));
  it("takes 0 as the kill switch", () => expect(parseBudget("0")).toBe(0));
  it("falls back to 50 on nonsense", () => {
    expect(parseBudget("lots")).toBe(50);
    expect(parseBudget("-5")).toBe(50);
  });
});
