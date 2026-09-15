import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// כמה תיבות, אותו צוות. ראו את ההערה המקבילה ב-submitLead/entry.ts.
const NOTIFY_EMAILS = ["amielnoy@gmail.com", "amielnoy@outlook.com"];
const SECONDARY_EMAIL = "dorit@govari-fin.co.il";

// ערוצי הקשר האנושיים שהסוכן מוסר למבקר. מקור האמת בצד הדפדפן הוא
// src/config/contact.js — כאן הם משוכפלים בכוונה, כדי שהעברה לאדם תמשיך
// לעבוד גם כשהקריאה מגיעה מכלי של הסוכן ולא מהאתר.
const HUMAN_CONTACT = {
  phoneDisplay: '050-831-1776',
  phoneE164: '+972508311776',
  whatsapp: '972508311776',
  email: 'dorit@govari-fin.co.il',
};

/**
 * הסיבות שבגללן סוכן אוטומטי חייב להפסיק לטפל ולהעביר לאדם.
 * כל ערך כאן חייב להופיע גם ב-enum של Lead.escalation_reason.
 */
const REASONS = {
  regulated_advice: 'ייעוץ/שיווק פנסיוני — טעון רישיון',
  product_recommendation: 'בקשה להמלצה על מוצר או גוף מוסדי',
  numbers_or_returns: 'בקשה למספרים, תשואות, דמי ניהול או חישוב',
  claim_or_policy: 'פרשנות פוליסה או טיפול בתביעה',
  complaint: 'תלונה או טענה לנזק',
  privacy_request: 'בקשת עיון/תיקון/מחיקה לפי חוק הגנת הפרטיות',
  sensitive_data: 'המבקר מסר מידע רגיש בצ׳אט',
  out_of_scope: 'נושא מחוץ לתחום הסוכן',
  user_request: 'המבקר ביקש לדבר עם אדם',
  uncertain: 'הסוכן לא היה בטוח שמותר לו לענות',
};

const URGENT = new Set(['complaint', 'claim_or_policy', 'privacy_request', 'sensitive_data']);

/**
 * הסרת מזהים רגישים לפני שהתקציר נשמר או נשלח במייל.
 *
 * הסוכן כבר מונחה לא לבקש ולא לחזור על פרטים כאלה, אבל מבקר יכול להקליד
 * ת"ז או מספר חשבון מיוזמתו והתקציר נכתב על ידי מודל. זו השכבה שמבטיחה
 * שמידע כזה לא ייכתב למאגר — עמידה בעקרון צמצום המידע.
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

// ── יומן האירועים בגיליון Google ──────────────────────────────────────────
//
// משוכפל מ-submitLead/entry.ts, כמו redact(), מאותה סיבה: אין מודול משותף בין
// פונקציות Base44. tests/contract/agents.contract.test.ts נכשל אם העמודות או
// הפונקציה מתפצלות — שורה שנכתבת בסדר אחר הורסת את הגיליון בלי שדבר ייכשל.
const SHEET_ID = '';
const SHEET_TAB = 'Events';

const SHEET_COLUMNS = [
  'מועד', 'סוג האירוע', 'מקור', 'סוכן', 'נושא', 'מועד מבוקש',
  'שם', 'טלפון', 'אימייל', 'מזהה רשומה', 'סיבת העברה', 'תקציר',
];

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

/** מספר טלפון ישראלי תקין — אותה בדיקה שהסוכנים מבצעים בשיחה. */
const validPhone = (phone) => /^0\d{8,9}$/.test(String(phone).replace(/[-\s]/g, ''));

function buildNotification(reason, data) {
  const flag = URGENT.has(reason) ? '🔴 דחוף' : '🟠';
  return [
    `${flag} פנייה שהועברה מהסוכן האוטומטי לטיפול אנושי`,
    `התקבל: ${new Date().toLocaleString("he-IL")}`,
    ``,
    `סיבת ההעברה: ${REASONS[reason] || reason}`,
    `סוכן: ${data.agent || '—'}`,
    ``,
    `שם: ${data.name || 'לא נמסר'}`,
    `טלפון: ${data.phone || 'לא נמסר'}`,
    `אימייל: ${data.email || '—'}`,
    ``,
    `תקציר השיחה (לאחר השמטת פרטים רגישים):`,
    data.summary || '—',
    ``,
    data.name && data.phone
      ? 'הפנייה נשמרה במאגר בסטטוס "escalated".'
      : 'המבקר לא מסר שם וטלפון — אין רשומה במאגר, זו ההודעה היחידה על הפנייה.',
  ].join('\n');
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { reason, summary, name, phone, email, agent, topic, consentVersion, consentAt } = body || {};

    const safeReason = Object.prototype.hasOwnProperty.call(REASONS, reason) ? reason : 'uncertain';
    const safeSummary = redact(summary);
    const contactable = Boolean(name && phone && validPhone(phone));

    // ── סדר הפעולות ─────────────────────────────────────────────────────
    // ההודעה לדורית היא העיקר: העברה לאדם שלא הגיעה לאדם היא כישלון
    // רגולטורי, לא רק תקלה. לכן היא נשלחת גם כשאין פרטי קשר לשמור, וכשל
    // בשמירה במאגר אינו מונע אותה.
    const warnings = [];
    let leadId = null;

    if (contactable) {
      try {
        const lead = await base44.entities.Lead.create({
          name,
          phone,
          email: email || '',
          source: 'escalation',
          topic: topic || REASONS[safeReason],
          timing: '',
          message: `[הועבר לטיפול אנושי — ${REASONS[safeReason]}]\n\n${safeSummary}`,
          status: 'escalated',
          escalation_reason: safeReason,
          handled_by_agent: agent || '',
          consent_version: consentVersion || '',
          consent_at: consentAt || '',
        });
        leadId = lead?.id ?? null;
      } catch (e) {
        warnings.push('lead_write_failed');
      }
    } else {
      warnings.push('no_contact_details');
    }

    const notification = buildNotification(safeReason, { name, phone, email, agent, summary: safeSummary });
    const subject = `${URGENT.has(safeReason) ? '🔴 ' : ''}העברה לטיפול אנושי — ${REASONS[safeReason]}${name ? ` · ${name}` : ''}`;

    let notified = false;
    for (const to of [...NOTIFY_EMAILS, SECONDARY_EMAIL]) {
      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to,
          subject,
          body: notification,
        });
        notified = true;
      } catch (e) {
        warnings.push('notify_email_failed');
      }
    }

    // רישום ביומן האירועים — מיטבי, ואחרי ההתראה. התראה שלא יצאה היא כשל
    // רגולטורי; שורה שלא נרשמה בגיליון אינה, ולכן הגיליון אף פעם לא חוסם.
    try {
      await appendEventRow(base44, [
        new Date().toISOString(),
        'conversation_escalation',
        'escalation',
        agent || '',
        topic || REASONS[safeReason],
        '',                       // מועד מבוקש — אין בהעברה לאדם
        name || '',
        phone || '',
        email || '',
        leadId || '',
        safeReason,
        safeSummary,
      ]);
    } catch (e) {
      warnings.push('sheet_append_failed');
    }

    // התשובה נבנית כדי שהסוכן יוכל להקריא אותה כמות שהיא. גם כשהכל נכשל
    // המבקר מקבל דרך ישירה לאדם — זו הנקודה שבה אסור להשאיר אותו בלי מענה.
    const acknowledgement = contactable
      ? 'הפרטים הועברו לדורית והיא תחזור אישית תוך יום עסקים אחד.'
      : 'אפשר לפנות לדורית ישירות בכל אחד מהערוצים הבאים.';

    return Response.json({
      ok: true,
      leadId,
      recorded: leadId !== null,
      notified,
      reason: safeReason,
      contact: HUMAN_CONTACT,
      acknowledgement,
      warnings,
    });
  } catch (error) {
    // גם מסלול הכישלון מחזיר ערוצי קשר — סוכן שנתקל בשגיאה עדיין חייב
    // להיות מסוגל למסור למבקר איך להגיע לאדם.
    return Response.json(
      {
        ok: false,
        error: error.message,
        contact: HUMAN_CONTACT,
        acknowledgement: 'אפשר לפנות לדורית ישירות בטלפון או בוואטסאפ.',
      },
      { status: 200 }
    );
  }
}
