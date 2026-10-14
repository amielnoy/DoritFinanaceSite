/**
 * A client's clearinghouse report, trimmed to what the analysis needs.
 *
 * This is the parser's output (PR B, docs/superpowers/specs/2026-10-13-
 * clearinghouse-route2-design.md) and the only shape the analysis reads. It is
 * defined before the parser on purpose: the analysis and Dorit's review screen
 * are built and tested against it now, and the parser — written once a real
 * ZIP is in hand — only has to fill it.
 *
 * Trimming is part of the contract, not a later step: no full ID number, no
 * names of family members, no free text from the files. A field the report
 * did not carry is `null`, never a guessed 0.
 */

/** The holdings interface's SUG-MUTZAR, split where the analysis treats them differently. */
export type ProductKind =
  /** קרן פנסיה (SUG-MUTZAR 2) */
  | "pension"
  /** קופת גמל, including גמל להשקעה (SUG-MUTZAR 3) */
  | "provident"
  /** קרן השתלמות (SUG-MUTZAR 3, its own plan type) */
  | "study"
  /** ביטוח מנהלים / פוליסת חיסכון (SUG-MUTZAR 1) */
  | "insurance";

export interface Coverage {
  /** Survivors' / death cover exists in this account. */
  death: boolean;
  /** Disability / loss-of-work-capacity cover exists in this account. */
  disability: boolean;
  /** Monthly cost of the covers, in ₪, when the report states it. */
  monthlyCost: number | null;
}

export interface Account {
  /** Opaque and stable within one snapshot; review decisions are keyed by it. */
  id: string;
  kind: ProductKind;
  /** The managing body, as the report names it (e.g. "מגדל"). */
  provider: string;
  /** The plan's name, as the report names it. */
  planName: string;
  /** The investment track's name, when the report states one. */
  track: string | null;
  /** Deposits arrived in the last few months (the report's own active flag). */
  active: boolean;
  /** Total balance, ₪. */
  balance: number;
  /** The last monthly deposit, ₪, or null when none is reported. */
  monthlyDeposit: number | null;
  /** Fee from deposits, percent (1 = 1%). */
  feeFromDeposits: number | null;
  /** Fee from the balance, percent a year. */
  feeFromBalance: number | null;
  coverage: Coverage;
}

export interface Snapshot {
  /** When the clearinghouse produced the report, ISO. */
  takenAt: string;
  /** The holdings interface's version, as the files declare it (e.g. "9.0"). */
  interfaceVersion: string;
  client: {
    idLast4: string;
    /** Whole years, from the report's birth date; null when it has none. */
    age: number | null;
    /** A spouse or children under 21 are reported — survivors' cover matters. */
    hasDependants: boolean;
  };
  accounts: Account[];
}

const KINDS = new Set<ProductKind>(["pension", "provident", "study", "insurance"]);
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 120): string | null => (typeof v === "string" && v.length <= max ? v : null);

/**
 * A stored snapshot read back from the database, checked field by field.
 *
 * The parser writes it from a staff member's browser, so the database holds
 * whatever that browser sent. An account that does not fit the shape is
 * dropped rather than half-read — the analysis never sees a guessed value —
 * and a snapshot without its header is null.
 */
export function readSnapshot(value: unknown): Snapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const client = v.client as Record<string, unknown> | undefined;
  const takenAt = str(v.takenAt, 40);
  const interfaceVersion = str(v.interfaceVersion, 16);
  if (!takenAt || !interfaceVersion || !client || !Array.isArray(v.accounts)) return null;
  const idLast4 = str(client.idLast4, 4);
  if (idLast4 === null || !/^\d{4}$/.test(idLast4)) return null;
  const age = finite(client.age);
  const accounts = v.accounts.flatMap((raw): Account[] => {
    if (!raw || typeof raw !== "object") return [];
    const a = raw as Record<string, unknown>;
    const cov = (a.coverage ?? {}) as Record<string, unknown>;
    const id = str(a.id, 64);
    const kind = a.kind as ProductKind;
    const balance = finite(a.balance);
    const provider = str(a.provider);
    const planName = str(a.planName);
    if (!id || !KINDS.has(kind) || balance === null || provider === null || planName === null) return [];
    return [{
      id,
      kind,
      provider,
      planName,
      track: str(a.track),
      active: a.active === true,
      balance,
      monthlyDeposit: finite(a.monthlyDeposit),
      feeFromDeposits: finite(a.feeFromDeposits),
      feeFromBalance: finite(a.feeFromBalance),
      coverage: { death: cov.death === true, disability: cov.disability === true, monthlyCost: finite(cov.monthlyCost) },
    }];
  });
  return {
    takenAt,
    interfaceVersion,
    client: { idLast4, age: age !== null && age >= 0 && age < 130 ? Math.floor(age) : null, hasDependants: client.hasDependants === true },
    accounts,
  };
}
