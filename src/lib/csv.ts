/**
 * One CSV cell, safe to open in Excel or Google Sheets.
 *
 * The leads export carries what visitors typed. A cell starting with `=`,
 * `+`, `-`, `@`, a tab or a carriage return is read by a spreadsheet as a
 * formula, and a formula can reach out (`=HYPERLINK`, `=WEBSERVICE`) — so such a
 * value is written with a leading apostrophe, which the spreadsheet shows as
 * text and does not display (review 2026-10-15; OWASP "CSV injection"). Then
 * the ordinary CSV quoting: a comma, a quote, or a line break.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
