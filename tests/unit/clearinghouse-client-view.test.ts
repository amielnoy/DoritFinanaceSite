import { describe, expect, it } from "vitest";
import { clientTiles, coverageLines } from "@/lib/clearinghouse/client-view";
import { totals } from "@/lib/clearinghouse/analysis";
import { projectRetirement } from "@/lib/retirement-projection";
import type { PublishedRecommendation } from "@/services/ports";
import { account, SNAPSHOT } from "../fixtures/clearinghouse-snapshot";

const item = (over: Partial<PublishedRecommendation>): PublishedRecommendation => ({
  id: "i", title: "t", body: "b", priority: "check", clientStatus: "open", clientNote: null, ...over,
});

describe("clientTiles — the four tiles of the client's snapshot", () => {
  it("adds up savings and this year's fees as the analysis does", () => {
    const t = clientTiles(SNAPSHOT, []);
    expect(t.totalSavings).toBe(totals(SNAPSHOT).balance);
    expect(t.yearlyFees).toBe(totals(SNAPSHOT).yearlyFees);
  });

  it("projects each pension fund to 67 on its own fee and deposit, and nothing without an age", () => {
    const one = { ...SNAPSHOT, accounts: [account({ id: "p", kind: "pension", balance: 200_000, monthlyDeposit: 2_000, feeFromBalance: 0.3 })] };
    const expected = projectRetirement({ currentAge: 40, retirementAge: 67, currentBalance: 200_000, monthlyDeposit: 2_000, feeOnBalance: 0.3, annualReturn: 4 }).monthlyPension;
    expect(clientTiles(one, []).pensionAt67).toBeCloseTo(expected, 6);
    expect(clientTiles({ ...one, client: { ...one.client, age: null } }, []).pensionAt67).toBeNull();
  });

  it("prices only what is above the yardsticks: default funds for pensions, Dorit's threshold for savings, never insurance", () => {
    const s = {
      ...SNAPSHOT,
      accounts: [
        account({ id: "p", kind: "pension", balance: 100_000, monthlyDeposit: 1_000, feeFromBalance: 0.32, feeFromDeposits: 2 }),
        account({ id: "g", kind: "provident", balance: 100_000, monthlyDeposit: null, feeFromBalance: 0.8, feeFromDeposits: 0 }),
        account({ id: "i", kind: "insurance", balance: 100_000, monthlyDeposit: null, feeFromBalance: 2, feeFromDeposits: 0 }),
        account({ id: "c", kind: "pension", balance: 100_000, monthlyDeposit: 1_000, feeFromBalance: 0.1, feeFromDeposits: 0.5 }),
      ],
    };
    // 100k × 0.10% + 12k × 1% (pension) + 100k × 0.10% (provident) = 100 + 120 + 100
    expect(clientTiles(s, []).feesAboveUsual).toBeCloseTo(320, 6);
  });

  it("counts the recommendations the client has not answered", () => {
    const items = [item({ id: "a" }), item({ id: "b", clientStatus: "accepted" }), item({ id: "c", clientStatus: "question" }), item({ id: "d" })];
    expect(clientTiles(SNAPSHOT, items).openRecommendations).toBe(2);
  });
});

describe("coverageLines — survivors' and disability cover", () => {
  const withCover = (accounts: ReturnType<typeof account>[]) => coverageLines({ ...SNAPSHOT, accounts });
  const cover = (death: boolean, disability: boolean) => ({ death, disability, monthlyCost: null });

  it("one active product: covered; two: a possible duplicate", () => {
    const lines = withCover([
      account({ id: "a", kind: "pension", coverage: cover(true, true) }),
      account({ id: "b", kind: "pension", coverage: cover(false, true) }),
    ]);
    expect(lines.map((l) => [l.kind, l.status])).toEqual([["death", "covered"], ["disability", "duplicate"]]);
  });

  it("only in a dormant product: partial; in none: not found", () => {
    const lines = withCover([account({ id: "a", kind: "pension", active: false, coverage: cover(true, false) })]);
    expect(lines.map((l) => l.status)).toEqual(["partial", "not_found"]);
  });
});
