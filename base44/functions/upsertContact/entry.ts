import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

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

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { phone, name, email, channel, notes } = body || {};

    const key = normalisePhone(phone);
    if (!key || !validPhone(key)) {
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
      } catch (e) {
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
      } catch (e) {
        return Response.json(
          { error: 'לא הצלחנו לשמור את איש הקשר.', details: e?.message },
          { status: 500 },
        );
      }
    }

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
      } catch (e) {
        warnings.push(deliveryWarning('sheet_append_failed', e));
      }
    }

    // התשובה נבנית כדי שהסוכן יוכל להקריא אותה: הוא מתבקש לאשר מול האדם מה
    // נשמר, ומה שהוא מקריא צריך להיות מה שנשמר בפועל ולא מה שהוא זוכר.
    return Response.json({
      ok: true,
      contactId,
      created,
      saved: { phone: key, name: name || '', email: email || '' },
      sheet,
      warnings,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
