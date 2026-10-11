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
