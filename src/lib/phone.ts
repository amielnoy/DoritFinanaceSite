/**
 * An Israeli phone number: starts with 0, nine or ten digits, dashes and spaces
 * allowed while typing.
 *
 * The same rule `escalateToHuman` applies (`validPhone`), so the browser and the
 * backend agree on what counts as a number Dorit can call back.
 */
export function isIsraeliPhone(value: string): boolean {
  return /^0\d{8,9}$/.test(value.replace(/[-\s]/g, ""));
}

/**
 * An Israeli mobile number — what the questionnaire asks for, so Dorit can call
 * or WhatsApp back: 05X and seven digits, or the same after +972 / 972 without
 * the 0. Dashes and spaces allowed while typing. Submit-lead stores it as typed.
 */
export function isIsraeliMobile(value: string): boolean {
  const digits = value.replace(/[-\s]/g, "");
  return /^05\d{8}$/.test(digits) || /^\+?9725\d{8}$/.test(digits);
}

/**
 * Any Israeli number Dorit can call back, mobile or landline: 0 and eight or
 * nine digits, or the same after +972 / 972 without the 0. Dashes and spaces
 * allowed while typing.
 *
 * The rule the free-text forms (quick contact, claim report) apply, and the
 * one `submit-lead` and `submit-claim` apply to them —
 * `supabase/functions/_shared/phone.ts` spells it again, and
 * `tests/unit/phone.test.ts` holds the two to one table. It accepts everything
 * `isIsraeliPhone` and `isIsraeliMobile` accept, so no form that checks with
 * either can send a number the backend refuses.
 */
export function isContactPhone(value: string): boolean {
  const digits = value.replace(/[-\s]/g, "");
  return /^0\d{8,9}$/.test(digits) || /^\+?972[1-9]\d{7,8}$/.test(digits);
}
