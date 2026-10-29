/**
 * The leads sheet, through the service account Dorit gave editor access.
 * appendSheetRow writes with googleAccessToken(); readSheetRange and
 * clearSheetRanges serve the nightly retention job (sheet-retention).
 */
import { googleAccessToken } from './google.ts';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

/** A range in a URL path: encoded, with the `!` between tab and cells left as it is. */
const pathRange = (range: string) => encodeURIComponent(range).replace(/%21/g, '!');

/** A1 column letters for the n-th column (1 → A, 27 → AA). */
export function columnLetters(n: number): string {
  let s = '';
  for (let k = n; k > 0; ) {
    const r = (k - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    k = (k - r - 1) / 26;
  }
  return s;
}

/**
 * A cell as the visitor typed it. USER_ENTERED would read '0549988754' as a
 * number and drop the zero, and would run a value starting with = + - @ (or a
 * tab or carriage return) as a formula — a visitor's name could then fetch a
 * URL or rewrite the sheet. A leading apostrophe stores either as text and is
 * not shown. upsertContact's appendEventRow carries the same rule (contract).
 */
export function sheetCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /^[=+\-@\t\r]/.test(s) || /^0\d+$/.test(s) ? `'${s}` : s;
}

export async function appendSheetRow(tab: string, columnCount: number, row: unknown[]): Promise<string> {
  const sheetId = (Deno.env.get('SHEET_ID') || '').trim();
  if (!sheetId) return 'לא מוגדר';
  const token = await googleAccessToken();
  const cells = row.map(sheetCell);
  const range = `${tab}!A:${columnLetters(columnCount)}`;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range).replace(/%21/g, '!')}` +
      ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [cells] }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!res.ok) throw new Error(`sheets_http_${res.status}`);
  return `נרשם ✓ — https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
}

/** A sheet cell as the API answers it unformatted: text, a number (a date is a serial day number), or a boolean. */
export type SheetCell = string | number | boolean;

/**
 * The cells of `range` (`Events!A2:S`), row by row, unformatted — so a cell
 * the sheet took for a date comes back as its serial number, whatever the
 * sheet's locale would have displayed. Trailing empty cells are absent, as
 * the API leaves them out. Null when no sheet is configured.
 */
export async function readSheetRange(range: string): Promise<SheetCell[][] | null> {
  const sheetId = (Deno.env.get('SHEET_ID') || '').trim();
  if (!sheetId) return null;
  const token = await googleAccessToken();
  const res = await fetch(
    `${SHEETS_API}/${sheetId}/values/${pathRange(range)}` +
      '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER',
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) },
  );
  if (!res.ok) throw new Error(`sheets_http_${res.status}`);
  const body = (await res.json()) as { values?: SheetCell[][] };
  return Array.isArray(body.values) ? body.values : [];
}

/** At most this many ranges in one batchClear. */
export const CLEAR_CHUNK = 500;

/** Empties the given A1 ranges' values (formatting stays), in chunks. Nothing to do for none. */
export async function clearSheetRanges(ranges: string[]): Promise<void> {
  if (ranges.length === 0) return;
  const sheetId = (Deno.env.get('SHEET_ID') || '').trim();
  if (!sheetId) throw new Error('sheet_not_configured');
  const token = await googleAccessToken();
  for (let i = 0; i < ranges.length; i += CLEAR_CHUNK) {
    const res = await fetch(`${SHEETS_API}/${sheetId}/values:batchClear`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ranges: ranges.slice(i, i + CLEAR_CHUNK) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`sheets_http_${res.status}`);
  }
}
