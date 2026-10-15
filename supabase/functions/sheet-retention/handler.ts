/**
 * The leads sheet, held to the same retention as the database (Architecture
 * N-02). Called nightly by pg_cron through pg_net
 * (`public.lead_sheet_call_retention`, migration
 * 20261026000000_lead_sheet_retention.sql) with the site's cron secret in
 * `x-site-cron` — the secret and Vault entries claim-documents-purge uses.
 *
 * Events tab — one row per enquiry, its lead's id in 'מזהה רשומה':
 *   - a row whose lead is no longer live — anonymized by the 03:45 job
 *     (24 months after the last contact; a client is exempt) or deleted from
 *     /admin/leads, as a deletion request asks — loses its personal columns.
 *     The database decides (`lead_sheet_live`), so the client exemption and
 *     the 24 months are written once, in SQL.
 *   - a row with no lead (a hand-off before any lead existed) has no record
 *     to follow, so it goes by its own date: cleared after 24 months.
 *   Date, event type, source, track, agent, topic, the id, the hand-off
 *   reason, the meeting time and completeness stay — what the database keeps.
 *
 * Support tab — one row per support chat, with a phone and a transcript and
 * no lead: both cleared 12 months after the row's date, the chat's own
 * retention (v6 notice).
 *
 * Cells are emptied (values:batchClear), never rows deleted: the rows below
 * keep their places, and the counts in the sheet stay true. A row already
 * empty is not touched again. Nothing personal is logged — counts only.
 */
import { sha256Hex } from '../_shared/guard.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { callRpc } from '../_shared/rest.ts';
import { clearSheetRanges, columnLetters, readSheetRange, type SheetCell } from '../_shared/sheets.ts';
import { SHEET_COLUMNS as SUPPORT_COLUMNS } from '../log-support-chat/handler.ts';
import { SHEET_COLUMNS as EVENTS_COLUMNS, SHEET_TAB as EVENTS_TAB } from '../submit-lead/lead.js';

const FN = 'sheet-retention';
const log = createLog(FN);
const MIN_SECRET_LENGTH = 32;
const SUPPORT_TAB = (Deno.env.get('SHEET_TAB_SUPPORT') || 'Support').trim();

export const EVENTS_MONTHS = 24;
export const SUPPORT_MONTHS = 12;
/** The columns emptied in an Events row — the visitor's details and what they told us. */
export const EVENTS_PERSONAL = ['מועד מבוקש', 'שם', 'טלפון', 'אימייל', 'תקציר', 'שלב חיים', 'יעד עיקרי', 'דאגה מרכזית', 'מסלקה'];
export const SUPPORT_PERSONAL = ['טלפון', 'תמלול'];
/** Ids asked of the database per call. */
export const LIVE_CHUNK = 1000;

const at = (columns: readonly string[], name: string): number => {
  const i = columns.indexOf(name);
  if (i < 0) throw new Error(`no_column_${name}`);
  return i;
};

/** Days from the sheet's epoch (1899-12-30) to 1970-01-01. */
const SERIAL_UNIX_DAYS = 25569;

/**
 * A row's date as `YYYY-MM-DD`, from what the sheet holds: a serial day number
 * (a cell the sheet took for a date), `2026-10-15 09:00:00` / ISO text as the
 * functions write it, or `15.10.2026` / `15/10/2026` from older rows. Null when
 * it is none of these — such a row is left alone, not guessed at.
 */
export function rowDay(cell: SheetCell | undefined): string | null {
  if (typeof cell === 'number' && Number.isFinite(cell) && cell > 0) {
    return new Date((cell - SERIAL_UNIX_DAYS) * 86_400_000).toISOString().slice(0, 10);
  }
  if (typeof cell !== 'string') return null;
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})/.exec(cell);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^\s*(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(cell);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return null;
}

/** The date `months` before `now`, as `YYYY-MM-DD`: a row dated before it is past retention. */
export function cutoffDay(now: Date, months: number): string {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

const filled = (cell: SheetCell | undefined) => cell !== undefined && cell !== null && String(cell).trim() !== '';

/** A1 ranges covering `cols` (0-based) on one sheet row, adjacent columns merged: G-J, M, O-R. */
export function rowRanges(tab: string, rowNumber: number, cols: number[]): string[] {
  const sorted = [...cols].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    const from = `${columnLetters(sorted[i] + 1)}${rowNumber}`;
    const to = `${columnLetters(sorted[j] + 1)}${rowNumber}`;
    out.push(`${tab}!${from === to ? from : `${from}:${to}`}`);
    i = j + 1;
  }
  return out;
}

export interface EventsPlan {
  /** 0-based indexes into the data rows (sheet row = index + 2). */
  clear: number[];
  undated: number;
}

/**
 * Which Events rows to empty: a row with personal cells left whose lead is
 * not live, or — with no lead — whose date is past `cutoff`.
 */
export function eventsToClear(rows: SheetCell[][], live: ReadonlySet<string>, cutoff: string): EventsPlan {
  const idCol = at(EVENTS_COLUMNS, 'מזהה רשומה');
  const dateCol = at(EVENTS_COLUMNS, 'מועד');
  const personal = EVENTS_PERSONAL.map((c) => at(EVENTS_COLUMNS, c));
  const clear: number[] = [];
  let undated = 0;
  rows.forEach((row, i) => {
    if (!personal.some((c) => filled(row[c]))) return;
    const id = filled(row[idCol]) ? String(row[idCol]).trim() : '';
    if (id) {
      if (!live.has(id)) clear.push(i);
      return;
    }
    const day = rowDay(row[dateCol]);
    if (day === null) undated += 1;
    else if (day < cutoff) clear.push(i);
  });
  return { clear, undated };
}

/** Which Support rows to empty: phone or transcript left, dated before `cutoff`. */
export function supportToClear(rows: SheetCell[][], cutoff: string): EventsPlan {
  const dateCol = at(SUPPORT_COLUMNS, 'מועד');
  const personal = SUPPORT_PERSONAL.map((c) => at(SUPPORT_COLUMNS, c));
  const clear: number[] = [];
  let undated = 0;
  rows.forEach((row, i) => {
    if (!personal.some((c) => filled(row[c]))) return;
    const day = rowDay(row[dateCol]);
    if (day === null) undated += 1;
    else if (day < cutoff) clear.push(i);
  });
  return { clear, undated };
}

/** The ids, of those given, whose lead exists and is not anonymized — asked in chunks. */
async function liveIds(ids: string[]): Promise<Set<string>> {
  const live = new Set<string>();
  for (let i = 0; i < ids.length; i += LIVE_CHUNK) {
    const answer = await callRpc('lead_sheet_live', { p_ids: ids.slice(i, i + LIVE_CHUNK) });
    if (!Array.isArray(answer)) throw new Error('rpc_unexpected_answer');
    for (const id of answer) if (typeof id === 'string') live.add(id);
  }
  return live;
}

/** Equal secrets in constant time: both hashed first, as claim-documents-purge does. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)]);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length && i < b.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const lastColumn = (columns: readonly string[]) => columnLetters(columns.length);

// Every `err:` below is truncated inline: tests/contract/logging.contract.test.ts
// reads each log call's text and requires the `.slice(0, N)` to be visible there.

export async function handler(req: Request): Promise<Response> {
  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    const secret = (Deno.env.get('MASLEKA_CRON_SECRET') || '').trim();
    if (secret.length < MIN_SECRET_LENGTH) {
      log('error', 'cron.not_configured', { rid });
      return Response.json({ error: 'unavailable', rid }, { status: 503 });
    }
    if (!(await sameSecret(req.headers.get('x-site-cron') || '', secret))) {
      log('warn', 'request.rejected', { rid, reason: 'unauthorized' });
      return Response.json({ error: 'unauthorized', rid }, { status: 401 });
    }

    const events = await readSheetRange(`${EVENTS_TAB}!A2:${lastColumn(EVENTS_COLUMNS)}`);
    if (events === null) {
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, skipped: 'sheet_not_configured' });
      return Response.json({ ok: true, skipped: 'sheet_not_configured', rid });
    }
    const now = new Date();
    const idCol = at(EVENTS_COLUMNS, 'מזהה רשומה');
    const ids = [...new Set(events.map((r) => (filled(r[idCol]) ? String(r[idCol]).trim() : '')).filter(Boolean))];
    const eventsPlan = eventsToClear(events, await liveIds(ids), cutoffDay(now, EVENTS_MONTHS));
    const eventsCols = EVENTS_PERSONAL.map((c) => at(EVENTS_COLUMNS, c));
    await clearSheetRanges(eventsPlan.clear.flatMap((i) => rowRanges(EVENTS_TAB, i + 2, eventsCols)));

    const support = (await readSheetRange(`${SUPPORT_TAB}!A2:${lastColumn(SUPPORT_COLUMNS)}`)) ?? [];
    const supportPlan = supportToClear(support, cutoffDay(now, SUPPORT_MONTHS));
    const supportCols = SUPPORT_PERSONAL.map((c) => at(SUPPORT_COLUMNS, c));
    await clearSheetRanges(supportPlan.clear.flatMap((i) => rowRanges(SUPPORT_TAB, i + 2, supportCols)));

    const result = {
      events: { rows: events.length, cleared: eventsPlan.clear.length, undated: eventsPlan.undated },
      support: { rows: support.length, cleared: supportPlan.clear.length, undated: supportPlan.undated },
    };
    log('info', 'request.end', { rid, ms: Date.now() - startedAt, ...result });
    return Response.json({ ok: true, ...result, rid });
  } catch (e) {
    log('error', 'retention.failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return Response.json({ error: 'failed', rid }, { status: 500 });
  }
}
