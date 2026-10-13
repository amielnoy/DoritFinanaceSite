/**
 * The Israeli ID number (ת״ז) check digit — the Edge copy.
 *
 * Identical to src/lib/israeli-id.ts, which the page uses before sending;
 * tests/unit/israeli-id.test.ts compares the two. `masleka-code` checks again
 * here because the page is not the only thing that can post.
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
