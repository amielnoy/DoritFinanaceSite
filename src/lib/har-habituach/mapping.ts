/**
 * Har HaBituach's Excel export → policies. The one place that knows its
 * layout (checked against a real export, 2026-10-14):
 *
 *   a title row, a blank row, then the header row below; then sections, each
 *   a row with one cell "תחום - …" ("תחום - כללי", "תחום - בריאות ותאונות
 *   אישיות", "תחום - חיים ואבדן כושר עבודה") followed by one row per policy.
 *   Premiums are decimals ("123.45") with "שנתית" or "חודשית" beside them;
 *   the insurance period is "dd/mm/yyyy - dd/mm/yyyy", "לכל החיים" or "מתחדש".
 *
 * The ID number and the policy number are in the file and are never read
 * into a Policy: nothing downstream can show, keep or send them.
 */

export const HEADERS = {
  mainBranch: "ענף ראשי",
  subBranch: "ענף (משני)",
  productType: "סוג מוצר",
  company: "חברה",
  period: "תקופת ביטוח",
  premium: 'פרמיה בש"ח',
  premiumType: "סוג פרמיה",
} as const;

/** Present in the file, deliberately not read. */
export const IGNORED_HEADERS = ["תעודת זהות", "מספר פוליסה", "פרטים נוספים", "סיווג תכנית"] as const;

export type PremiumPeriod = "monthly" | "yearly";

export interface Policy {
  /** The section it was listed under, e.g. "תחום - בריאות ותאונות אישיות"; "" before any. */
  section: string;
  mainBranch: string;
  subBranch: string;
  productType: string;
  company: string;
  period: string;
  /** ₪, as the file states it; null when the cell is not a number. */
  premium: number | null;
  premiumPeriod: PremiumPeriod | null;
}

export class MappingError extends Error {
  constructor(readonly reason: "no_header") {
    super(reason);
  }
}

const SECTION = /^תחום\s*-\s*/;
const filled = (row: string[]) => row.filter((c) => c !== "").length;

export function readPolicies(rows: string[][]): Policy[] {
  const headerAt = rows.findIndex((row) => Object.values(HEADERS).every((h) => row.includes(h)));
  if (headerAt < 0) throw new MappingError("no_header");
  const header = rows[headerAt];
  const col = Object.fromEntries(Object.entries(HEADERS).map(([k, h]) => [k, header.indexOf(h)])) as Record<
    keyof typeof HEADERS,
    number
  >;

  const policies: Policy[] = [];
  let section = "";
  for (const row of rows.slice(headerAt + 1)) {
    if (filled(row) === 0) continue;
    if (filled(row) === 1) {
      const only = row.find((c) => c !== "")!;
      if (SECTION.test(only)) section = only;
      continue;
    }
    const cell = (k: keyof typeof HEADERS) => (row[col[k]] ?? "").trim();
    // A repeated header (a second page of the export) is not a policy.
    if (cell("mainBranch") === HEADERS.mainBranch) continue;
    if (!cell("mainBranch") && !cell("subBranch") && !cell("productType")) continue;
    const amount = Number(cell("premium").replace(/[,\s₪]/g, ""));
    const type = cell("premiumType");
    policies.push({
      section,
      mainBranch: cell("mainBranch"),
      subBranch: cell("subBranch"),
      productType: cell("productType"),
      company: cell("company"),
      period: cell("period"),
      premium: cell("premium") !== "" && Number.isFinite(amount) ? amount : null,
      premiumPeriod: type.startsWith("שנתי") ? "yearly" : type.startsWith("חודשי") ? "monthly" : null,
    });
  }
  return policies;
}
