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
