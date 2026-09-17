import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

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
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { channel, phone, topic, transcript, outcome, messageCount } = body || {};

    // אין גיליון — אין מה לעשות, וזה אינו כשל. הסוכן קורא לפונקציה הזו בסוף
    // כל שיחה, וסביבה בלי גיליון עדיין צריכה לענות על שאלות.
    if (!SHEET_ID) return Response.json({ ok: true, sheet: 'לא מוגדר' });

    const safeTranscript = redact(transcript);
    const safeTopic = redact(topic).slice(0, 200);
    if (!safeTranscript && !safeTopic) {
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
      return Response.json({ ok: true, sheet });
    } catch (e) {
      return Response.json({ ok: true, sheet: 'נכשל', warnings: [deliveryWarning('sheet_append_failed', e)] });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
