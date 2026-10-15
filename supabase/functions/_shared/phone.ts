/**
 * Any Israeli number Dorit can call back, mobile or landline: 0 and eight or
 * nine digits, or the same after +972 / 972 without the 0. Dashes and spaces
 * allowed.
 *
 * `submit-lead` and `submit-claim` refuse a quick-contact, form or claim whose
 * phone fails it. The browser's copy is `isContactPhone` in `src/lib/phone.ts`;
 * `tests/unit/phone.test.ts` runs both over one table, so they cannot drift.
 */
export function contactPhone(value: unknown): boolean {
  const digits = String(value ?? '').replace(/[-\s]/g, '');
  return /^0\d{8,9}$/.test(digits) || /^\+?972[1-9]\d{7,8}$/.test(digits);
}
