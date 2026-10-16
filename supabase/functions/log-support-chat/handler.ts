/**
 * A support or procedures chat, logged to the sheet's Support tab. The Edge
 * twin of base44/functions/logSupportChat — same input, same redaction, same
 * row — through the service account instead of a connector.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { clientIp, sha256Hex, withinLimit } from '../_shared/guard.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { deliveryWarning } from '../_shared/mail.ts';
import { appendSheetRow } from '../_shared/sheets.ts';
import { redact } from './redact.js';

const FN = 'log-support-chat';
const log = createLog(FN);
const SHEET_TAB = (Deno.env.get('SHEET_TAB_SUPPORT') || 'Support').trim();
export const SHEET_COLUMNS = ['מועד', 'ערוץ', 'טלפון', 'נושא', 'תוצאה', 'הודעות', 'תמלול'];

/** תוצאות מוכרות. מה שאינו ברשימה נרשם כ'לא ידוע' ולא כטקסט חופשי. */
const OUTCOMES: Record<string, string> = {
  answered: 'נענה',
  escalated: 'הועבר לדורית',
  referred_to_interview: 'הופנה לראיון היכרות',
  abandoned: 'נקטע',
};

/**
 * Rows per caller, and for every caller together. The chat sweep logs at most
 * 10 conversations every 15 minutes, in-process; Base44's agents call from
 * Base44's server, so one address stands for all of them. Both fit well under.
 */
const ROWS_PER_IP_PER_HOUR = 60;
const ROWS_PER_HOUR = 300;

/** ערוצים מוכרים. */
const CHANNELS = ['site', 'whatsapp'];

/** אותו נרמול כמו ב-upsertContact: הטלפון הוא אותו מפתח בשתי הלשוניות. */
function normalisePhone(raw: unknown) {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (digits.startsWith('972')) return '0' + digits.slice(3);
  if (digits.startsWith('0')) return digits;
  return digits ? '0' + digits : '';
}

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    const body = await req.json().catch(() => null);
    const { channel, phone, topic, transcript, outcome, messageCount } = body || {};

    // אין גיליון — אין מה לעשות, וזה אינו כשל. הסוכן קורא לפונקציה הזו בסוף
    // כל שיחה, וסביבה בלי גיליון עדיין צריכה לענות על שאלות.
    if (!(Deno.env.get('SHEET_ID') || '').trim()) {
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, sheet: 'unconfigured' });
      return Response.json({ ok: true, rid, sheet: 'לא מוגדר' }, { headers: cors });
    }

    // A public door that writes to a sheet a person reads: one caller, or a
    // flood from many, may not fill it.
    const ip = clientIp(req);
    const allowed =
      (!ip || (await withinLimit(log, rid, `support-ip:${await sha256Hex(ip)}`, 3600, ROWS_PER_IP_PER_HOUR))) &&
      (await withinLimit(log, rid, 'support-log', 3600, ROWS_PER_HOUR));
    if (!allowed) {
      log('warn', 'request.rejected', { rid, reason: 'rate_limited' });
      return Response.json({ error: 'יותר מדי רישומים ברצף.', rid }, { status: 429, headers: cors });
    }

    const safeTranscript: string = redact(transcript);
    const safeTopic: string = redact(topic).slice(0, 200);
    if (!safeTranscript && !safeTopic) {
      log('warn', 'support.empty', { rid });
      return Response.json({ error: 'אין מה לרשום', rid }, { status: 400, headers: cors });
    }

    const row = [
      new Date().toISOString(),
      CHANNELS.includes(channel) ? channel : 'site',
      // רק אם הערוץ מסר אותו. בצ׳אט באתר אין טלפון, ואין לבקש אחד כדי למלא עמודה.
      normalisePhone(phone),
      safeTopic,
      OUTCOMES[outcome] || 'לא ידוע',
      Number.isFinite(Number(messageCount)) ? String(Number(messageCount)) : '',
      safeTranscript,
    ];

    // כשל ברישום אינו כשל של השיחה: היא כבר קרתה, והמבקר כבר קיבל את תשובתו.
    // מחזירים 200 עם אזהרה כדי שהסוכן לא יספר למבקר על תקלה שאינה נוגעת לו.
    try {
      const sheet = await appendSheetRow(SHEET_TAB, SHEET_COLUMNS.length, row);
      // התוצאה והערוץ בלבד. הנושא והתמלול הם מה שהמבקר אמר, והם נשארים בגיליון.
      log('info', 'support.logged', { rid, ms: Date.now() - startedAt, channel: row[1], outcome: row[4], status: sheet });
      return Response.json({ ok: true, rid, sheet }, { headers: cors });
    } catch (e) {
      log('warn', 'sheet.append_failed', { rid, tab: SHEET_TAB, err: String((e as Error)?.message ?? e).slice(0, 200) });
      return Response.json({ ok: true, rid, sheet: 'נכשל', warnings: [deliveryWarning('sheet_append_failed', e)] }, { headers: cors });
    }
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((error as Error)?.message ?? error).slice(0, 200) });
    // The id, not the message. `error.message` reached the browser as-is: it
    // told the visitor nothing they could use, and told anyone reading it the
    // shape of our internals. The id is the one thing that is useful to both —
    // they can quote it, and it finds the request in one search.
    return Response.json({ error: 'השמירה נכשלה. אפשר לנסות שוב, או לפנות לדורית ישירות.', rid }, { status: 500, headers: cors });
  }
}
