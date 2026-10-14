import { EXPECTED_COVERAGE, NO_DUPLICATE_SECTIONS } from "@/config/har-habituach";
import { formatIls } from "@/lib/pension-fee";
import type { Policy } from "@/lib/har-habituach/mapping";

/**
 * The double-coverage check over a Har HaBituach export: policies grouped by
 * coverage type, a type held in two or more policies flagged "כפל אפשרי", and
 * expected types none of them has flagged "כדאי לבדוק". It compares the type
 * only — never the terms, amounts or exclusions — which the page says.
 */

export interface CoverageGroup {
  /** The coverage type: a service rider's product type, else the sub-branch, else the branch. */
  type: string;
  section: string;
  policies: Policy[];
  /** Two or more policies of this type, outside the per-asset sections. */
  possibleDuplicate: boolean;
  monthlyPremium: number;
}

export interface CoverageCheck {
  groups: CoverageGroup[];
  /** Expected coverages no policy has. */
  missing: string[];
  possibleDuplicates: number;
  /** Every policy's premium as a monthly amount, ₪. */
  totalMonthlyPremium: number;
  policyCount: number;
}

/**
 * A service rider (כתב שירות) is its own type: a car policy's towing,
 * windscreen and replacement-car riders share its sub-branch, and grouping by
 * that would call each of them a duplicate of the policy.
 */
export function coverageType(p: Policy): string {
  if (p.productType.startsWith("כתב שירות")) return p.productType;
  return p.subBranch || p.mainBranch || p.productType;
}

export function monthlyPremium(p: Policy): number {
  if (p.premium === null) return 0;
  return p.premiumPeriod === "yearly" ? p.premium / 12 : p.premium;
}

export function checkCoverage(policies: Policy[], expected = EXPECTED_COVERAGE): CoverageCheck {
  const byType = new Map<string, CoverageGroup>();
  for (const p of policies) {
    const type = coverageType(p);
    const key = `${p.section}|${type}`;
    const group =
      byType.get(key) ?? { type, section: p.section, policies: [], possibleDuplicate: false, monthlyPremium: 0 };
    group.policies.push(p);
    group.monthlyPremium += monthlyPremium(p);
    byType.set(key, group);
  }
  const groups = [...byType.values()];
  for (const g of groups) g.possibleDuplicate = g.policies.length >= 2 && !NO_DUPLICATE_SECTIONS.includes(g.section);

  const text = (p: Policy) => `${p.mainBranch} ${p.subBranch} ${p.productType}`;
  const missing = expected
    .filter((e) => !policies.some((p) => e.match.some((m) => text(p).includes(m))))
    .map((e) => e.label);

  return {
    // Duplicates first, then by section as the file lists them.
    groups: groups.sort((a, b) => Number(b.possibleDuplicate) - Number(a.possibleDuplicate)),
    missing,
    possibleDuplicates: groups.filter((g) => g.possibleDuplicate).length,
    totalMonthlyPremium: policies.reduce((sum, p) => sum + monthlyPremium(p), 0),
    policyCount: policies.length,
  };
}

/**
 * What "לשלוח לדורית לבדיקה" sends: counts, the flagged types with their
 * companies, and the missing types. No ID number, no policy number — the
 * mapping never read them — and nothing from the free-text column.
 */
export function checkSummary(check: CoverageCheck): string {
  const lines = [
    `בדיקת כפל ביטוחים מקובץ הר הביטוח: ${check.policyCount} פוליסות, פרמיה חודשית כוללת כ-${formatIls(check.totalMonthlyPremium)}.`,
  ];
  const duplicates = check.groups.filter((g) => g.possibleDuplicate);
  if (duplicates.length) {
    lines.push("כפל אפשרי:");
    for (const g of duplicates) {
      const companies = [...new Set(g.policies.map((p) => p.company))].join(", ");
      lines.push(`- ${g.type} (${g.policies.length} פוליסות: ${companies})`);
    }
  } else {
    lines.push("לא נמצא כפל אפשרי.");
  }
  if (check.missing.length) lines.push(`כדאי לבדוק (לא נמצא בקובץ): ${check.missing.join(", ")}.`);
  return lines.join("\n").slice(0, 1800);
}
