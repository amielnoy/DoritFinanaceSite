import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// כמה תיבות, אותו צוות. ראו את ההערה המקבילה ב-submitLead/entry.ts.
const NOTIFY_EMAILS = ["amielnoy@gmail.com", "amielnoy@outlook.com"];

// מי מהם אפשר להגיע אליו דרך Core של Base44.
//
// Core מוסרת אך ורק למשתמש רשום של האפליקציה, ורישום אינו דבר שאפשר להוסיף
// בצד: הוא נוצר כשהכתובת נכנסת לאפליקציה עצמה. לכן הרשימה הזו אינה "מי בצוות"
// אלא "למי הפלטפורמה מסוגלת למסור", והיא מכוונת להצטמצם לאפס — כל כתובת שעוברת
// לשירות הדואר מפסיקה להיות תלויה בחשבון.
//
// כל השאר — הסוכנת, התיבה השנייה והמבקר — עוברים דרך dorit-mailer.
const CORE_EMAILS = ["amielnoy@gmail.com"];
const SECONDARY_EMAIL = "dorit@govari-fin.co.il";

// Include a safe delivery reason in the operations notification.
function deliveryWarning(label, error) {
  const reason = String(error?.message ?? error ?? '').slice(0, 300);
  return reason ? `${label} (${reason})` : label;
}

/**
 * The one way this app sends mail, over two transports chosen by recipient.
 *
 * `CORE_EMAILS` go through Base44's own `Core.SendEmail`, which delivers only
 * to registered users of the app. Everyone else — the agency, the second
 * operations mailbox and the visitor — goes through the `dorit-mailer` Pages
 * Function, which sends from the agency's verified domain via Resend.
 *
 * The split is not about who they are, it is about what each transport can
 * reach. Core needs an account that only exists once the address has signed
 * into the app, which is a dependency worth shedding: `CORE_EMAILS` is meant
 * to shrink to nothing once the sending domain is verified.
 *
 * Two transports is what caused the original silent failure — the agency was on
 * a path that could not deliver to her and nobody noticed, because the copy
 * that *did* arrive looked like success. The split is deliberate this time and
 * each failure carries its reason, but it is worth remembering which is which
 * when only some of the three arrive.
 *
 * What travels is the finished message: these functions own the templates, the
 * escaping and `redact()` on anything a model wrote.
 */
async function sendMail({ base44, to, subject, html, text, body }) {
  if (CORE_EMAILS.includes(to)) {
    // `html` and `body` are alternatives, not companions: passing both makes
    // Base44 reject the whole call with "SendEmail accepts only …", and the
    // rejection is a validation error rather than a delivery failure — so the
    // enquiry is saved, a warning is recorded, and nobody is told. That is what
    // stopped the operations copy arriving after the transports were split.
    const plain = text ?? body;
    await base44.asServiceRole.integrations.Core.SendEmail(
      html ? { to, subject, html, text: plain } : { to, subject, body: plain },
    );
    return;
  }

  const endpoint = Deno.env.get('MAILER_URL')?.trim();
  const token = Deno.env.get('MAILER_TOKEN')?.trim();
  if (!endpoint || !token) throw new Error('mailer_not_configured');

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'rendered',
        to,
        subject,
        html,
        text: text ?? body,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error('mailer_network_error');
  }
  // Never surface provider response bodies or credentials in public warnings.
  if (!response.ok) throw new Error(`mailer_http_${response.status}`);
  const result = await response.json().catch(() => null);
  if (!result?.ok) throw new Error('mailer_rejected');
}


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
// מזהה הגיליון מגיע מהסביבה ולא מהקוד: המאגר ציבורי, ופריסה בלי גיליון צריכה
// להמשיך לעבוד. ריק = הרישום מדולג בשקט ומדווח כ"לא מוגדר" בנספח התפעולי.
const SHEET_ID = (Deno.env.get('SHEET_ID') || '').trim();
const SHEET_TAB = (Deno.env.get('SHEET_TAB') || 'Events').trim();

const SHEET_COLUMNS = [
  'מועד', 'סוג האירוע', 'מקור', 'מסלול', 'סוכן', 'נושא', 'מועד מבוקש',
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

/** לוח הצבעים של המיילים — אותם ערכים כמו src/index.css, בקוד שאינו רואה טוקנים. */
const MAIL = {
  page: '#F9F7F2',      // --background · Warm Parchment
  card: '#FFFFFF',
  panel: '#F6F1EA',
  ink: '#1A1A1B',       // --foreground · Obsidian Matte
  body: '#3D3D3F',
  muted: '#7D6B5D',     // --accent · Deep Taupe
  border: '#E5DDD0',
  panelBorder: '#E0D4C6',
  rule: '#C3AD96',      // --highlight-muted
  alert: '#EF4444',     // --destructive
};

/** שורת "תווית: ערך" אחת בתוך בלוק. */
function detailRow(label, value, { link = '', last = false } = {}) {
  const shown = escapeHtml(value || '—');
  const cell = link
    ? `<a href="${escapeHtml(link)}" style="color:${MAIL.ink}; text-decoration:none;">${shown}</a>`
    : shown;
  const divider = last
    ? ''
    : `<tr><td colspan="2" style="padding:0; font-size:0; line-height:0; border-top:1px solid ${MAIL.panelBorder};">&nbsp;</td></tr>`;
  return `
              <tr>
                <td style="padding:9px 0; font-size:13px; color:${MAIL.muted}; font-family:Arial,sans-serif; width:120px; text-align:right; vertical-align:top;">${escapeHtml(label)}</td>
                <td style="padding:9px 0; font-size:15px; color:${MAIL.ink}; font-family:Arial,sans-serif; font-weight:bold; text-align:right;">${cell}</td>
              </tr>${divider}`;
}

/** בלוק אחד: כותרת קטנה ומסגרת סביב תוכן. */
function block(title, inner, { tone = 'panel' } = {}) {
  const bg = tone === 'plain' ? MAIL.card : MAIL.panel;
  const edge = tone === 'alert' ? MAIL.alert : MAIL.panelBorder;
  return `
        <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px; background:${bg}; border:1px solid ${edge}; border-radius:6px;">
          <tr><td style="padding:22px 26px;">
            <p style="margin:0 0 14px; font-size:11px; letter-spacing:0.22em; text-transform:uppercase; color:${MAIL.muted}; font-family:Arial,sans-serif; text-align:right;">${escapeHtml(title)}</p>
            <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%">${inner}
            </table>
          </td></tr>
        </table>`;
}

/** פסקת טקסט חופשי בתוך בלוק — הודעה, הערות, תקציר. */
function proseRow(text) {
  return `
              <tr><td style="padding:2px 0 0; font-size:15px; color:${MAIL.body}; font-family:Arial,sans-serif; line-height:1.8; text-align:right; white-space:pre-line;">${escapeHtml(text || '—')}</td></tr>`;
}

/**
 * בריחת תווים לפני שילוב טקסט מהמבקר בגוף HTML.
 *
 * המייל הזה נשלח לכתובת שהמבקר הקליד, מהדומיין המאומת של הסוכנות, והשם והנושא
 * מגיעים ממנו. בלי בריחה אפשר להגיש טופס עם המייל של מישהו אחר ועם שם שהוא
 * בעצם תגית — והנמען מקבל מייל ממותג של דורית שמכיל קישור של התוקף. זה אינו
 * XSS בדפדפן של המבקר אלא וקטור פישינג על חשבון המוניטין של הסוכנות.
 */
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── ההתראה, בעיצוב של האתר ────────────────────────────────────────────────
//
// עד כה היא נשלחה כטקסט בלבד, ולקוח הדואר קיפל אותה לפסקה אחת רצה: סיבת
// ההעברה, השם, הטלפון והתקציר בשורה אחת בלי הפרדה. זו ההודעה שדורית פותחת
// בטלפון כדי להחליט אם לחזור למישהו עכשיו, וזה בדיוק מה שלא היה אפשרי — אותו
// ליקוי שתוקן בפניות הרגילות (A-14) ונשאר כאן.
//
// אותו מידע בדיוק, באותה פלטה של submitLead, בבלוקים מופרדים. הטקסט ממשיך
// להישלח לצידו ולא במקומו.

/** ההעברה כ-HTML. מסגרת אדומה כשהסיבה דחופה, כדי שתיראה מהמסך הראשון. */
function buildEscalationHtml(reason, data) {
  const urgent = URGENT.has(reason);

  const who = block('מי פנה', [
    detailRow('שם', data.name || 'לא נמסר'),
    detailRow('טלפון', data.phone || 'לא נמסר', {
      link: data.phone ? `tel:${String(data.phone).replace(/[^\d+]/g, '')}` : '',
    }),
    detailRow('אימייל', data.email, { link: data.email ? `mailto:${data.email}` : '', last: true }),
  ].join(''));

  const why = block('ההעברה', [
    detailRow('סיבה', REASONS[reason] || reason),
    detailRow('דחיפות', urgent ? 'דחוף — לטפל היום' : 'רגילה'),
    detailRow('סוכן', data.agent || '—', { last: true }),
  ].join(''), { tone: urgent ? 'alert' : 'panel' });

  const summary = block('תקציר השיחה · לאחר השמטת פרטים רגישים', proseRow(data.summary));

  const stored = block('מצב', proseRow(
    data.contactable
      ? 'הפנייה נשמרה במאגר בסטטוס "escalated".'
      : 'המבקר לא מסר שם וטלפון — אין רשומה במאגר, וזו ההודעה היחידה על הפנייה.',
  ), { tone: data.contactable ? 'panel' : 'alert' });

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:${MAIL.page}; font-family:Arial,Helvetica,sans-serif; color:${MAIL.ink}; line-height:1.7; -webkit-text-size-adjust:100%;">
  <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${MAIL.page};">
    <tr><td align="center" style="padding:28px 16px;">
      <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:600px; background:${MAIL.card}; border:1px solid ${urgent ? MAIL.alert : MAIL.border}; border-radius:6px; overflow:hidden;">
        <tr><td style="padding:34px 40px 24px; border-bottom:1px solid ${MAIL.border}; text-align:right;">
          <p style="margin:0 0 10px; font-size:11px; letter-spacing:0.3em; text-transform:uppercase; color:${urgent ? MAIL.alert : MAIL.muted};">${urgent ? 'העברה דחופה' : 'העברה לאדם'}</p>
          <h1 style="margin:0; font-family:Georgia,serif; font-size:26px; font-weight:bold; color:${MAIL.ink}; line-height:1.3; letter-spacing:-0.02em;">${escapeHtml('פנייה שהועברה לטיפול אישי')}</h1>
          <div style="height:2px; width:44px; background:${urgent ? MAIL.alert : MAIL.rule}; margin:18px 0 0;"></div>
          <p style="margin:14px 0 0; font-size:13px; color:${MAIL.muted};">${escapeHtml(new Date().toLocaleString('he-IL'))}</p>
        </td></tr>
        <tr><td style="padding:26px 40px 10px;">${who}${why}${summary}${stored}</td></tr>
        <tr><td style="padding:20px 40px; background:${MAIL.ink}; text-align:center;">
          <p style="margin:0; font-size:11px; color:rgba(249,247,242,0.5);">הודעה אוטומטית מאתר דורית גוב ארי · אין להשיב לכתובת זו</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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
    const escalationHtml = buildEscalationHtml(safeReason, {
      name, phone, email, agent, summary: safeSummary, contactable,
    });

    let notified = false;
    // One sender for all three. The branch that used to be here sent Dorit's
    // copy through Resend and the operations copies through Base44, which meant
    // the outlook mailbox silently received nothing — Base44 delivers only to
    // registered users, and it is not one.
    for (const to of [...NOTIFY_EMAILS, SECONDARY_EMAIL]) {
      try {
        await sendMail({
          base44,
          to,
          subject,
          html: escalationHtml,
          text: notification,
          body: notification,
        });
        notified = true;
      } catch (e) {
        warnings.push(deliveryWarning('notify_email_failed', e));
      }
    }

    // רישום ביומן האירועים — מיטבי, ואחרי ההתראה. התראה שלא יצאה היא כשל
    // רגולטורי; שורה שלא נרשמה בגיליון אינה, ולכן הגיליון אף פעם לא חוסם.
    try {
      await appendEventRow(base44, [
        new Date().toISOString(),
        'conversation_escalation',
        'escalation',
        '',                       // מסלול — רלוונטי רק בראיון
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
