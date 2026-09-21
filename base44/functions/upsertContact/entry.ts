import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/** שם הפונקציה כפי שהוא מופיע בכל שורת יומן שלה. */
const FN = 'upsertContact';

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


// ── יומן אנשי הקשר ────────────────────────────────────────────────────────
//
// אותו גיליון כמו יומן האירועים, לשונית אחרת: אירוע הוא מה שקרה, איש קשר הוא
// מי שפנה. ריק = הרישום מדולג בשקט, כדי שפריסה בלי גיליון תמשיך לעבוד.
const SHEET_ID = (Deno.env.get('SHEET_ID') || '').trim();
const SHEET_TAB = (Deno.env.get('SHEET_TAB_CONTACTS') || 'Contacts').trim();

/**
 * סדר העמודות בלשונית אנשי הקשר.
 *
 * שורה נכתבת רק כשנוצר איש קשר חדש. עדכון של קיים אינו מוסיף שורה: הגיליון
 * נועד להיות רשימת האנשים, ואם כל הודעה תוסיף שורה הוא יהפוך ליומן שני.
 */
const SHEET_COLUMNS = ['מועד', 'טלפון', 'שם', 'אימייל', 'ערוץ', 'הערות'];

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

/** מספר טלפון ישראלי תקין — אותה בדיקה שהסוכנים מבצעים בשיחה. */
const validPhone = (phone) => /^0\d{8,9}$/.test(String(phone).replace(/[-\s]/g, ''));

/**
 * נרמול המספר למפתח יציב.
 *
 * וואטסאפ מוסר `972501234567`, טופס באתר מוסר `050-123-4567`, ואדם מקליד
 * `+972 50 123 4567`. שלושתם אותו אדם, ובלי נרמול הם שלוש רשומות — וזו בדיוק
 * הכפילות שהמפתח הזה קיים כדי למנוע.
 */
function normalisePhone(raw) {
  const digits = String(raw ?? '').replace(/[^\d]/g, '');
  if (digits.startsWith('972')) return '0' + digits.slice(3);
  if (digits.startsWith('0')) return digits;
  return digits ? '0' + digits : '';
}

/**
 * שיקוף איש הקשר ל-Supabase. לעולם לא זורק.
 *
 * Base44 הוא המקור הסמכותי בשלב הזה: הרשומה כבר נשמרה לפני שמגיעים לכאן, וכשל
 * בשיקוף הוא אי-התאמה בין שני מאגרים — לא איש קשר שאבד.
 *
 * `on_conflict=phone` ולא `base44_id`, בניגוד לפניות: הטלפון הוא המפתח שהישות
 * בנויה סביבו — רשומה אחת לאדם, לא אחת לפנייה — וזה גם המפתח שלפיו הפונקציה
 * עצמה חיפשה קודם. התנגשות על השדה השני הייתה יוצרת אדם שני עם אותו מספר,
 * שזה בדיוק מה שהישות קיימת כדי למנוע.
 *
 * מפתח השירות עוקף RLS, כנדרש: עדכון אנשי קשר חסום למנהלים ואין משתמש מחובר
 * מאחורי הפונקציה.
 */
async function mirrorContactToSupabase(rid, base44Id, row) {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  // לא מוגדר — אין שיקוף ואין רעש. כך נראית הפונקציה לפני שההגירה הופעלה.
  if (!url || !key) return;

  try {
    const res = await fetch(`${url}/rest/v1/contacts?on_conflict=phone`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(base44Id ? { ...row, base44_id: base44Id } : row),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 140)}`);
    log('info', 'contact.mirrored', { rid, base44Id });
  } catch (e) {
    log('warn', 'contact.mirror_failed', { rid, base44Id, err: String(e?.message ?? e).slice(0, 200) });
  }
}

export default async function(req) {
  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { phone, name, email, channel, notes } = body || {};

    const key = normalisePhone(phone);
    if (!key || !validPhone(key)) {
      // הטלפון עצמו אינו נרשם — רק שנדחה, וזה מה שצריך כדי לאבחן ערוץ
      // שמוסר מספרים בפורמט שלא ציפינו לו.
      log('warn', 'contact.rejected', { rid, reason: 'invalid_phone' });
      return Response.json({ error: 'נדרש מספר טלפון תקין' }, { status: 400 });
    }

    // ההערות נכתבות על ידי מודל ששמע אדם מקליד לוואטסאפ, שם אנשים שולחים
    // ת"ז ומספרי פוליסה בלי לחשוב. אותו סינון כמו בכל טקסט של מודל.
    const safeNotes = redact(notes);
    const now = new Date().toISOString();

    // ── קיים או חדש ─────────────────────────────────────────────────────
    // החיפוש מיטבי: אם הוא נכשל נוצרת רשומה חדשה, כי איש קשר כפול הוא טרחה
    // ואיש קשר שאבד הוא פנייה שאיש לא יחזור אליה.
    let existing = null;
    try {
      const found = await base44.asServiceRole.entities.Contact.filter({ phone: key });
      existing = (found || [])[0] ?? null;
    } catch (e) {
      // נופלים למסלול היצירה.
    }

    const warnings = [];
    let contactId = null;
    let created = false;

    if (existing?.id) {
      // עדכון משלים ולא דורס: שם שכבר ידוע לא נמחק על ידי פנייה שלא מסרה אותו.
      try {
        await base44.asServiceRole.entities.Contact.update(existing.id, {
          name: name || existing.name || '',
          email: email || existing.email || '',
          notes: safeNotes || existing.notes || '',
          last_seen: now,
        });
        contactId = existing.id;
        log('info', 'contact.updated', { rid, contactId });
      } catch (e) {
        log('error', 'contact.update_failed', { rid, contactId: existing.id, err: String(e?.message ?? e).slice(0, 200) });
        return Response.json(
          { error: 'לא הצלחנו לעדכן את איש הקשר.', details: e?.message },
          { status: 500 },
        );
      }
    } else {
      try {
        const contact = await base44.entities.Contact.create({
          phone: key,
          name: name || '',
          email: email || '',
          channel: ['whatsapp', 'site', 'phone', 'other'].includes(channel) ? channel : 'other',
          notes: safeNotes,
          last_seen: now,
        });
        contactId = contact?.id ?? null;
        created = true;
        log('info', 'contact.created', { rid, contactId });
      } catch (e) {
        log('error', 'contact.create_failed', { rid, err: String(e?.message ?? e).slice(0, 200) });
        return Response.json(
          { error: 'לא הצלחנו לשמור את איש הקשר.', details: e?.message },
          { status: 500 },
        );
      }
    }

    // שיקוף ל-Supabase. אחרי ששני הענפים התכנסו, כך שהוא נקרא פעם אחת בדיוק
    // ורק אחרי שהכתיבה הסמכותית הצליחה.
    await mirrorContactToSupabase(rid, contactId, {
      phone: key,
      name: name || existing?.name || '',
      email: email || existing?.email || '',
      channel: ['whatsapp', 'site', 'phone', 'other'].includes(channel) ? channel : 'other',
      notes: safeNotes || existing?.notes || '',
      last_seen: now,
    });

    // ── הגיליון ─────────────────────────────────────────────────────────
    // רק על יצירה. הרשומה כבר נשמרה, ולכן כשל כאן מדווח ואינו מפיל דבר.
    let sheet = created ? 'לא נרשם' : 'לא רלוונטי';
    if (created) {
      try {
        sheet = await appendEventRow(base44, [
          now,
          key,
          name || '',
          email || '',
          channel || 'other',
          safeNotes,
        ]);
        log('info', 'sheet.appended', { rid, tab: SHEET_TAB, status: sheet });
      } catch (e) {
        log('warn', 'sheet.append_failed', { rid, tab: SHEET_TAB, err: String(e?.message ?? e).slice(0, 200) });
        warnings.push(deliveryWarning('sheet_append_failed', e));
      }
    }

    // התשובה נבנית כדי שהסוכן יוכל להקריא אותה: הוא מתבקש לאשר מול האדם מה
    // נשמר, ומה שהוא מקריא צריך להיות מה שנשמר בפועל ולא מה שהוא זוכר.
    log('info', 'request.end', { rid, ms: Date.now() - startedAt, created, warnings: warnings.length });
    return Response.json({
      ok: true,
      contactId,
      created,
      saved: { phone: key, name: name || '', email: email || '' },
      sheet,
      warnings,
    });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String(error?.message ?? error).slice(0, 200) });
    return Response.json({ error: error.message }, { status: 500 });
  }
}
