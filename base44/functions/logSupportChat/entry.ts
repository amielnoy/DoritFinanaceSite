import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/** שם הפונקציה כפי שהוא מופיע בכל שורת יומן שלה. */
const FN = 'logSupportChat';

/**
 * שורת יומן מובנית — JSON בשורה אחת, לפלט הפונקציה.
 *
 * Base44 אוסף את פלט הקונסולה ומגיש אותו ב-`base44 logs`, ומשם job יומי שומר
 * אותו תחת `logs/` במאגר. עד כה הפונקציות לא כתבו לשם דבר, והאבחון היחיד היה
 * נספח האזהרות שבמייל — כלומר אפשר היה לאבחן רק פנייה שהמייל שלה בכלל יצא.
 *
 * הכלל שקובע מה נכנס לכאן: **מה קרה, לא מה נאמר.** אירוע, תוצאה, משך ומזהה
 * בקשה — ולעולם לא שם, טלפון, אימייל, הודעה, תקציר או פרופיל. יומן הוא המקום
 * היחיד שבקשת מחיקה אינה מגיעה אליו, ולכן הקשירה בין שורות נעשית דרך `rid`
 * ולא דרך זהות האדם. tests/contract/logging.contract.test.ts נכשל אם שדה אסור
 * מגיע לכאן.
 *
 * משוכפלת בכל פונקציה בכוונה — אין מודול משותף ב-Base44. משוכפל זה בסדר,
 * מפוצל זה לא.
 */
function log(level, event, fields) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, fn: FN, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** מזהה קצר שקושר את כל שורות היומן של בקשה אחת. */
const newRequestId = () => crypto.randomUUID().slice(0, 8);


// ── יומן שיחות התמיכה ──────────────────────────────────────────────────────
//
// אותו גיליון, לשונית שלישית. לשונית האירועים אומרת מי פנה, לשונית אנשי הקשר
// אומרת מי הם, וזו אומרת מה בעצם נשאל — מה שאין בשתי האחרות ואי אפשר לנחש
// ממנו: אילו שאלות חוזרות, איפה הסוכן נעצר, ומה היה צריך אדם.
// ריק = הרישום מדולג בשקט, כדי שפריסה בלי גיליון תמשיך לעבוד.
const SHEET_ID = (Deno.env.get('SHEET_ID') || '').trim();
const SHEET_TAB = (Deno.env.get('SHEET_TAB_SUPPORT') || 'Support').trim();

/** סדר העמודות בלשונית התמיכה. */
const SHEET_COLUMNS = ['מועד', 'ערוץ', 'טלפון', 'נושא', 'תוצאה', 'הודעות', 'תמלול'];

// אורך התמלול: redact() כבר חותכת ל-2000 תווים, וזו המגבלה בפועל. היא אינה
// טכנית — תא בגיליון מחזיק הרבה יותר — אלא מידתית: שיחת תמיכה שנשמרת במלואה
// לנצח היא איסוף רחב יותר מהמטרה שהוצהרה. הסוכן מתבקש ממילא לשלוח תמצית של
// שורה לכל צד, ולכן החיתוך הוא רשת ביטחון ולא ההתנהגות הרגילה.

/**
 * הסרת מזהים רגישים מתקציר שנכתב על ידי מודל.
 *
 * משוכפל מ-escalateToHuman/entry.ts בכוונה: כל פונקציה ב-Base44 היא נקודת
 * כניסה עצמאית ואין ביניהן מודול משותף. שתי העותקות חייבות להישאר זהות —
 * tests/contract/agents.contract.test.ts נכשל אם אחת מהן מתפצלת.
 */
function redact(text) {
  if (!text) return '';
  return String(text)
    .replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, '[הושמט — מספר כרטיס]')
    .replace(/\bIL\d{2}[A-Z0-9]{17,}\b/gi, '[הושמט — חשבון בנק]')
    .replace(/\b\d{9}\b/g, '[הושמט — מספר מזהה]')
    .replace(/\b\d{6,8}\b/g, '[הושמט — מספר]')
    .slice(0, 2000);
}

/** הוספת שורה אחת ליומן. מחזירה מחרוזת מצב לנספח התפעולי. */
async function appendEventRow(base44, row) {
  if (!SHEET_ID) return 'לא מוגדר';
  const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlesheets');
  if (!accessToken) return 'אין חיבור';

  const range = `${SHEET_TAB}!A:${String.fromCharCode(64 + SHEET_COLUMNS.length)}`;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}` +
      `:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    },
  );
  if (!res.ok) throw new Error(`sheets ${res.status}`);
  return 'נרשם ✓';
}

// Include a safe delivery reason in the operations notification.
function deliveryWarning(label, error) {
  const reason = String(error?.message ?? error ?? '').slice(0, 300);
  return reason ? `${label} (${reason})` : label;
}

/** תוצאות מוכרות. מה שאינו ברשימה נרשם כ'לא ידוע' ולא כטקסט חופשי. */
const OUTCOMES = {
  answered: 'נענה',
  escalated: 'הועבר לדורית',
  referred_to_interview: 'הופנה לראיון היכרות',
  abandoned: 'נקטע',
};

/** ערוצים מוכרים. */
const CHANNELS = ['site', 'whatsapp'];

/** אותו נרמול כמו ב-upsertContact: הטלפון הוא אותו מפתח בשתי הלשוניות. */
function normalisePhone(raw) {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (digits.startsWith('972')) return '0' + digits.slice(3);
  if (digits.startsWith('0')) return digits;
  return digits ? '0' + digits : '';
}

export default async function(req) {
  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { channel, phone, topic, transcript, outcome, messageCount } = body || {};

    // אין גיליון — אין מה לעשות, וזה אינו כשל. הסוכן קורא לפונקציה הזו בסוף
    // כל שיחה, וסביבה בלי גיליון עדיין צריכה לענות על שאלות.
    if (!SHEET_ID) {
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, sheet: 'unconfigured' });
      return Response.json({ ok: true, sheet: 'לא מוגדר' });
    }

    const safeTranscript = redact(transcript);
    const safeTopic = redact(topic).slice(0, 200);
    if (!safeTranscript && !safeTopic) {
      log('warn', 'support.empty', { rid });
      return Response.json({ error: 'אין מה לרשום' }, { status: 400 });
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
      const sheet = await appendEventRow(base44, row);
      // התוצאה והערוץ בלבד. הנושא והתמלול הם מה שהמבקר אמר, והם נשארים בגיליון.
      log('info', 'support.logged', { rid, ms: Date.now() - startedAt, channel: row[1], outcome: row[4], status: sheet });
      return Response.json({ ok: true, sheet });
    } catch (e) {
      log('warn', 'sheet.append_failed', { rid, tab: SHEET_TAB, err: String(e?.message ?? e).slice(0, 200) });
      return Response.json({ ok: true, sheet: 'נכשל', warnings: [deliveryWarning('sheet_append_failed', e)] });
    }
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String(error?.message ?? error).slice(0, 200) });
    return Response.json({ error: error.message }, { status: 500 });
  }
}
