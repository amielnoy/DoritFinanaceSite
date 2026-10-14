import type { Account, Snapshot } from "@/lib/clearinghouse/snapshot";

/**
 * A made-up client for the analysis tests and the review screen. Every number
 * is invented; nothing here comes from a real report. When the parser lands
 * (PR B), a real report with its details replaced becomes a second fixture.
 */
export const account = (over: Partial<Account> & Pick<Account, "id" | "kind">): Account => ({
  provider: "מגדל",
  planName: "מגדל מקפת אישית",
  track: "מסלול כללי",
  active: true,
  balance: 100_000,
  monthlyDeposit: 2_000,
  feeFromDeposits: 1,
  feeFromBalance: 0.22,
  coverage: { death: false, disability: false, monthlyCost: null },
  ...over,
});

export const SNAPSHOT: Snapshot = {
  takenAt: "2026-10-12T09:00:00.000Z",
  interfaceVersion: "9.0",
  client: { idLast4: "0018", age: 40, hasDependants: true },
  accounts: [
    account({
      id: "p1", kind: "pension", provider: "מגדל", planName: "מגדל מקפת אישית",
      balance: 300_000, monthlyDeposit: 3_000, feeFromDeposits: 1.49, feeFromBalance: 0.25,
      coverage: { death: true, disability: true, monthlyCost: 120 },
    }),
    account({
      id: "p2", kind: "pension", provider: "כלל", planName: "כלל פנסיה",
      balance: 50_000, monthlyDeposit: 1_000, feeFromDeposits: 1, feeFromBalance: 0.22,
      coverage: { death: true, disability: true, monthlyCost: 60 },
    }),
    account({
      id: "s1", kind: "study", provider: "הראל", planName: "הראל השתלמות",
      balance: 120_000, monthlyDeposit: 1_500, feeFromDeposits: 0, feeFromBalance: 0.8,
    }),
    account({
      id: "g1", kind: "provident", provider: "הפניקס", planName: "הפניקס גמל",
      active: false, balance: 8_000, monthlyDeposit: null, feeFromDeposits: 0, feeFromBalance: 1.05,
    }),
    account({
      id: "i1", kind: "insurance", provider: "מנורה", planName: "מנורה מבטחים מנהלים",
      active: false, balance: 15_000, monthlyDeposit: null, feeFromDeposits: 0, feeFromBalance: 0.6,
    }),
  ],
};
