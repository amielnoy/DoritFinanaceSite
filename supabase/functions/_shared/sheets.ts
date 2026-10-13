/**
 * One row appended to a tab of the leads sheet, by the service account Dorit
 * gave editor access. The body of base44/functions/submitLead's appendEventRow,
 * with the connector token replaced by googleAccessToken().
 */
import { googleAccessToken } from './google.ts';

/** A1 column letters for the n-th column (1 → A, 27 → AA). */
function columnLetters(n: number): string {
  let s = '';
  for (let k = n; k > 0; ) {
    const r = (k - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    k = (k - r - 1) / 26;
  }
  return s;
}

export async function appendSheetRow(tab: string, columnCount: number, row: unknown[]): Promise<string> {
  const sheetId = (Deno.env.get('SHEET_ID') || '').trim();
  if (!sheetId) return 'לא מוגדר';
  const token = await googleAccessToken();
  // USER_ENTERED would read '0549988754' as a number and drop the zero.
  const cells = row.map((v) => {
    const s = v == null ? '' : String(v);
    return /^0\d+$/.test(s) ? `'${s}` : s;
  });
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
