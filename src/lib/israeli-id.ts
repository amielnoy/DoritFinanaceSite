/**
 * The Israeli ID number (ת״ז) check digit.
 *
 * Nine digits, left-padded with zeros. Each digit is multiplied by 1 and 2 in
 * turn, a two-digit product is reduced by 9, and the sum must divide by 10. A
 * single mistyped digit always fails it, which is why /masleka checks it
 * before anything is sent and `masleka-code` checks it again before anything
 * is stored.
 *
 * The Edge Functions keep an identical copy in
 * supabase/functions/_shared/israeli-id.ts — Deno cannot import from src/.
 * tests/unit/israeli-id.test.ts runs both over one table and compares their
 * code, so they cannot drift.
 */
export function normalizeIsraeliId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^\d{5,9}$/.test(digits)) return null;
  const padded = digits.padStart(9, "0");
  if (/^0+$/.test(padded)) return null;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    let step = Number(padded[i]) * (i % 2 === 0 ? 1 : 2);
    if (step > 9) step -= 9;
    sum += step;
  }
  return sum % 10 === 0 ? padded : null;
}

export function isValidIsraeliId(raw: unknown): boolean {
  return normalizeIsraeliId(raw) !== null;
}
