import { describe, expect, it } from "vitest";
import { analyse, pct, totals, type Finding } from "@/lib/clearinghouse/analysis";
import { DEFAULT_FUND_FEES, LEGAL_MAX } from "@/lib/clearinghouse/reference";
import { readSnapshot, type Snapshot } from "@/lib/clearinghouse/snapshot";
import { customRecommendations, forPrint, pendingCount, priorityOfSeverity, publishItems, withReviews } from "@/lib/clearinghouse/review";
import { account, SNAPSHOT } from "../fixtures/clearinghouse-snapshot";

const rules = (findings: Finding[]) => findings.map((f) => f.rule);
const only = (over: Partial<Snapshot>): Snapshot => ({ ...SNAPSHOT, ...over });
const byRule = (s: Snapshot, rule: Finding["rule"]) => analyse(s).filter((f) => f.rule === rule);

describe("the clearinghouse analysis", () => {
  it("finds what the made-up client's report holds, and nothing it does not", () => {
    expect(rules(analyse(SNAPSHOT)).sort()).toEqual(
      [
        "duplicate_cover",
        "duplicate_cover",
        "pension_fee_above_default",
        "savings_fee_high",
        "savings_fee_high",
        "several_active_pensions",
        "small_inactive_accounts",
      ].sort(),
    );
  });

  it("adds up the balance and this year's fees", () => {
    const t = totals(SNAPSHOT);
    expect(t.balance).toBe(493_000);
    expect(t.accounts).toBe(5);
    expect(t.activeAccounts).toBe(3);
    // 300k×0.25% + 36k×1.49% + 50k×0.22% + 12k×1% + 120k×0.8% + 8k×1.05% + 15k×0.6%
    expect(t.yearlyFees).toBeCloseTo(750 + 536.4 + 110 + 120 + 960 + 84 + 90, 6);
  });

  it("prices a pension fund above the default funds' fee by retirement", () => {
    const [f] = byRule(SNAPSHOT, "pension_fee_above_default");
    expect(f.accountIds).toEqual(["p1"]);
    expect(f.costToRetirement).toBeGreaterThan(10_000);
    expect(f.body).toContain("1.49%");
    expect(f.body).toContain(pct(DEFAULT_FUND_FEES.fromBalance));
    expect(f.body).toContain("27 שנים עד גיל 67");
  });

  it("leaves the cost out, rather than guessing, when the report has no age", () => {
    const [f] = byRule(only({ client: { ...SNAPSHOT.client, age: null } }), "pension_fee_above_default");
    expect(f.costToRetirement).toBeNull();
    expect(f.body).not.toContain("עד הפרישה");
  });

  it("does not raise a pension fund at or below the default funds' fee, or one with no deposits", () => {
    const cheap = account({ id: "p", kind: "pension", feeFromDeposits: 1, feeFromBalance: 0.22 });
    const dormant = account({ id: "q", kind: "pension", active: false, feeFromDeposits: 3, feeFromBalance: 0.4 });
    expect(byRule(only({ accounts: [cheap, dormant] }), "pension_fee_above_default")).toEqual([]);
  });

  it("flags a fee above the legal maximum, for pension and provident funds only", () => {
    const over = [
      account({ id: "a", kind: "pension", feeFromBalance: LEGAL_MAX.pension.fromBalance + 0.1 }),
      account({ id: "b", kind: "provident", feeFromDeposits: LEGAL_MAX.provident.fromDeposits + 1, feeFromBalance: 0.5 }),
      account({ id: "c", kind: "insurance", feeFromDeposits: 10, feeFromBalance: 2 }),
    ];
    const found = byRule(only({ accounts: over }), "fee_above_legal_max");
    expect(found.map((f) => f.accountIds[0])).toEqual(["a", "b"]);
    expect(found.every((f) => f.severity === "high")).toBe(true);
  });

  it("asks about disability cover when no product has it, below retirement age", () => {
    const bare = [account({ id: "a", kind: "pension" })];
    expect(byRule(only({ accounts: bare }), "no_disability_cover")).toHaveLength(1);
    expect(byRule(only({ accounts: bare, client: { ...SNAPSHOT.client, age: 67 } }), "no_disability_cover")).toEqual([]);
  });

  it("asks about survivors' cover only when there are dependants", () => {
    const bare = [account({ id: "a", kind: "pension" })];
    expect(byRule(only({ accounts: bare }), "no_survivors_cover")).toHaveLength(1);
    expect(byRule(only({ accounts: bare, client: { ...SNAPSHOT.client, hasDependants: false } }), "no_survivors_cover")).toEqual([]);
  });

  it("words duplicate disability and duplicate survivors' cover differently", () => {
    const [disability, death] = ["disability", "death"].map(
      (field) => byRule(SNAPSHOT, "duplicate_cover").find((f) => f.key.endsWith(`:${field}`))!,
    );
    expect(disability.body).toContain("התגמול מכמה מקורות מוגבל");
    expect(death.body).not.toContain("התגמול מכמה מקורות מוגבל");
    expect(disability.body).toContain("₪"); // 120 + 60 a month
  });

  it("gathers small dormant accounts that still pay fees into one finding", () => {
    const [f] = byRule(SNAPSHOT, "small_inactive_accounts");
    expect(f.accountIds).toEqual(["g1", "i1"]);
    expect(f.severity).toBe("low");
  });

  it("keys a finding by rule and accounts, whatever order the report lists them in", () => {
    const reversed = only({ accounts: [...SNAPSHOT.accounts].reverse() });
    expect(analyse(reversed).map((f) => f.key)).toEqual(analyse(SNAPSHOT).map((f) => f.key));
    expect(new Set(analyse(SNAPSHOT).map((f) => f.key)).size).toBe(analyse(SNAPSHOT).length);
  });

  it("puts the most serious first", () => {
    const order = { high: 0, medium: 1, low: 2 };
    const severities = analyse(SNAPSHOT).map((f) => order[f.severity]);
    expect(severities).toEqual([...severities].sort((a, b) => a - b));
  });

  it("writes a percentage the way people read it", () => {
    expect(pct(0.22)).toBe("0.22%");
    expect(pct(1)).toBe("1%");
    expect(pct(1.049999)).toBe("1.05%");
  });
});

describe("readSnapshot — a stored report read back", () => {
  it("reads back exactly what the parser's shape holds", () => {
    expect(readSnapshot(JSON.parse(JSON.stringify(SNAPSHOT)))).toEqual(SNAPSHOT);
  });

  it("drops an account that does not fit, rather than guessing its values", () => {
    const raw = JSON.parse(JSON.stringify(SNAPSHOT));
    raw.accounts.push({ id: "x", kind: "crypto", provider: "y", planName: "z", balance: 1 });
    raw.accounts.push({ id: "y", kind: "pension", provider: "y", planName: "z", balance: "a lot" });
    expect(readSnapshot(raw)?.accounts.map((a) => a.id)).toEqual(SNAPSHOT.accounts.map((a) => a.id));
  });

  it("refuses a report without its header or with more than the ID's last four digits", () => {
    expect(readSnapshot(null)).toBeNull();
    expect(readSnapshot({ ...SNAPSHOT, takenAt: undefined })).toBeNull();
    expect(readSnapshot({ ...SNAPSHOT, client: { ...SNAPSHOT.client, idLast4: "123456782" } })).toBeNull();
  });

  it("reads a missing or impossible age as unknown", () => {
    expect(readSnapshot({ ...SNAPSHOT, client: { ...SNAPSHOT.client, age: -3 } })?.client.age).toBeNull();
    expect(readSnapshot({ ...SNAPSHOT, client: { ...SNAPSHOT.client, age: "40" } })?.client.age).toBeNull();
  });
});

describe("withReviews — Dorit's decisions on the drafts", () => {
  const findings = analyse(SNAPSHOT);
  const [first, second] = findings;

  it("starts every finding as a draft in the draft's own words", () => {
    const merged = withReviews(findings, []);
    expect(merged.every((f) => f.state === "draft" && f.text === f.body && !f.edited)).toBe(true);
    expect(pendingCount(merged)).toBe(findings.length);
    expect(forPrint(merged)).toEqual([]);
  });

  it("prints approved findings only, in Dorit's words when she edited them", () => {
    const merged = withReviews(findings, [
      { findingKey: first.key, status: "approved", finalText: "הנוסח של דורית", reviewedAt: "t" },
      { findingKey: second.key, status: "rejected", finalText: null, reviewedAt: "t" },
      { findingKey: "a_rule_that_is_gone:", status: "approved", finalText: null, reviewedAt: "t" },
    ]);
    expect(forPrint(merged).map((f) => [f.key, f.text, f.edited])).toEqual([[first.key, "הנוסח של דורית", true]]);
    expect(pendingCount(merged)).toBe(findings.length - 2);
  });

  it("does not call a text 'edited' when it is the draft's own", () => {
    const [merged] = withReviews([first], [{ findingKey: first.key, status: "approved", finalText: first.body, reviewedAt: "t" }]);
    expect(merged.edited).toBe(false);
  });
});

describe("review — priorities, Dorit's own recommendations, what a publish sends (phase 4)", () => {
  const findings = analyse(SNAPSHOT);

  it("takes a finding's priority from its severity until Dorit sets one", () => {
    const merged = withReviews(findings, []);
    expect(merged.every((f) => f.priority === (f.severity === "high" ? "important" : "check"))).toBe(true);
    const [first] = findings;
    const [set] = withReviews([first], [{ findingKey: first.key, status: "approved", finalText: null, title: "כותרת שלה", priority: "important", reviewedAt: "t" }]);
    expect(set).toMatchObject({ priority: "important", title: "כותרת שלה" });
  });

  it("reads her own recommendations in the order she wrote them, skipping one without a title or text", () => {
    const custom = customRecommendations([
      { findingKey: "custom:b", status: "approved", finalText: "גוף ב", title: "ב", priority: "important", reviewedAt: "2026-10-15T10:00:00Z" },
      { findingKey: "custom:a", status: "approved", finalText: "גוף א", title: "א", priority: null, reviewedAt: "2026-10-15T09:00:00Z" },
      { findingKey: "custom:c", status: "approved", finalText: null, title: "ג", priority: null, reviewedAt: "t" },
      { findingKey: findings[0].key, status: "approved", finalText: null, reviewedAt: "t" },
    ]);
    expect(custom.map((c) => [c.title, c.priority, c.rule])).toEqual([["א", "check", "custom"], ["ב", "important", "custom"]]);
  });

  it("publishes the approved rule findings first, in Dorit's words, then hers", () => {
    const [first, second] = findings;
    const merged = withReviews(findings, [
      { findingKey: first.key, status: "approved", finalText: "נוסח שלה", reviewedAt: "t" },
      { findingKey: second.key, status: "rejected", finalText: null, reviewedAt: "t" },
    ]);
    const custom = customRecommendations([{ findingKey: "custom:x", status: "approved", finalText: "שלה", title: "שלה", priority: "check", reviewedAt: "t" }]);
    expect(publishItems(merged, custom)).toEqual([
      { title: first.title, body: "נוסח שלה", priority: priorityOfSeverity(first.severity) },
      { title: "שלה", body: "שלה", priority: "check" },
    ]);
  });
});
