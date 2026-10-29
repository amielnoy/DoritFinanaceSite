// What escalate-to-human says and stores: the reasons, the notification text
// and HTML, the redaction and the sheet's columns. Plain JavaScript.
// escapeHtml and channelLine are the shared copies.
import { channelLine } from '../_shared/attribution.ts';
import { escapeHtml } from '../_shared/html.ts';

// Who is told — one list for every Edge function: ../_shared/recipients.ts.
export { NOTIFY_EMAILS, SECONDARY_EMAIL } from '../_shared/recipients.ts';


// ערוצי הקשר האנושיים שהסוכן מוסר למבקר. מקור האמת בצד הדפדפן הוא
// src/config/contact.js — כאן הם משוכפלים בכוונה, כדי שהעברה לאדם תמשיך
// לעבוד גם כשהקריאה מגיעה מכלי של הסוכן ולא מהאתר.
export const HUMAN_CONTACT = {
  phoneDisplay: '050-831-1776',
  phoneE164: '+972508311776',
  whatsapp: '972508311776',
  email: 'dorit@govari-fin.co.il',
};

/**
 * הסיבות שבגללן סוכן אוטומטי חייב להפסיק לטפל ולהעביר לאדם.
 * כל ערך כאן חייב להופיע גם ב-enum של Lead.escalation_reason.
 */
export const REASONS = {
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

export const URGENT = new Set(['complaint', 'claim_or_policy', 'privacy_request', 'sensitive_data']);

/**
 * הסרת מזהים רגישים לפני שהתקציר נשמר או נשלח במייל.
 *
 * הסוכן כבר מונחה לא לבקש ולא לחזור על פרטים כאלה, אבל מבקר יכול להקליד
 * ת"ז או מספר חשבון מיוזמתו והתקציר נכתב על ידי מודל. זו השכבה שמבטיחה
 * שמידע כזה לא ייכתב למאגר — עמידה בעקרון צמצום המידע.
 */
export function redact(text) {
  if (!text) return '';
  return String(text)
    .replace(/(?<![0-9])[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}(?![0-9])/g, '[הושמט — מספר כרטיס]')
    .replace(/(?<![A-Za-z0-9])[Ii][Ll][0-9]{2}[A-Za-z0-9]{17,}(?![A-Za-z0-9])/g, '[הושמט — חשבון בנק]')
    .replace(/(?<![0-9])[0-9]{9}(?![0-9])/g, '[הושמט — מספר מזהה]')
    .replace(/(?<![0-9])[0-9]{6,8}(?![0-9])/g, '[הושמט — מספר]')
    .slice(0, 2000)
    .replace(/[\uD800-\uDBFF]$/, ''); // a cut through an emoji leaves half of it, which is not valid JSON
}

export const SHEET_TAB = (Deno.env.get('SHEET_TAB') || 'Events').trim();

export const SHEET_COLUMNS = [
  'מועד', 'סוג האירוע', 'מקור', 'מסלול', 'סוכן', 'נושא', 'מועד מבוקש',
  'שם', 'טלפון', 'אימייל', 'מזהה רשומה', 'סיבת העברה', 'תקציר',
  'מועד הפגישה', 'שלב חיים', 'יעד עיקרי', 'דאגה מרכזית', 'מסלקה', 'שלמות',
];

/** מספר טלפון ישראלי תקין — אותה בדיקה שהסוכנים מבצעים בשיחה. */
export const validPhone = (phone) => /^0\d{8,9}$/.test(String(phone).replace(/[-\s]/g, ''));

export function buildNotification(reason, data) {
  const flag = URGENT.has(reason) ? '🔴 דחוף' : '🟠';
  const escalationChannelText = channelLine(data);
  return [
    `${flag} פנייה שהועברה מהסוכן האוטומטי לטיפול אנושי`,
    `התקבל: ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`,
    ``,
    `סיבת ההעברה: ${REASONS[reason] || reason}`,
    `סוכן: ${data.agent || '—'}`,
    ...(escalationChannelText ? [`הגיע/ה דרך: ${escalationChannelText}`] : []),
    ``,
    `שם: ${data.name || 'לא נמסר'}`,
    `טלפון: ${data.phone || 'לא נמסר'}`,
    `אימייל: ${data.email || '—'}`,
    `נשלח מ: ${data.device || 'לא ידוע'}`,
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
export const MAIL = {
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
export function detailRow(label, value, { link = '', last = false } = {}) {
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
export function block(title, inner, { tone = 'panel' } = {}) {
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
export function proseRow(text) {
  return `
              <tr><td style="padding:2px 0 0; font-size:15px; color:${MAIL.body}; font-family:Arial,sans-serif; line-height:1.8; text-align:right; white-space:pre-line;">${escapeHtml(text || '—')}</td></tr>`;
}


//
// עד כה היא נשלחה כטקסט בלבד, ולקוח הדואר קיפל אותה לפסקה אחת רצה: סיבת
// ההעברה, השם, הטלפון והתקציר בשורה אחת בלי הפרדה. זו ההודעה שדורית פותחת
// בטלפון כדי להחליט אם לחזור למישהו עכשיו, וזה בדיוק מה שלא היה אפשרי — אותו
// ליקוי שתוקן בפניות הרגילות (A-14) ונשאר כאן.
//
// אותו מידע בדיוק, באותה פלטה של submitLead, בבלוקים מופרדים. הטקסט ממשיך
// להישלח לצידו ולא במקומו.

/** ההעברה כ-HTML. מסגרת אדומה כשהסיבה דחופה, כדי שתיראה מהמסך הראשון. */
export function buildEscalationHtml(reason, data) {
  const urgent = URGENT.has(reason);

  const who = block('מי פנה', [
    detailRow('שם', data.name || 'לא נמסר'),
    detailRow('טלפון', data.phone || 'לא נמסר', {
      link: data.phone ? `tel:${String(data.phone).replace(/[^\d+]/g, '')}` : '',
    }),
    detailRow('אימייל', data.email, { link: data.email ? `mailto:${data.email}` : '' }),
    detailRow('נשלח מ', data.device || 'לא ידוע', { last: true }),
  ].join(''));

  const whyChannelText = channelLine(data);
  const why = block('ההעברה', [
    detailRow('סיבה', REASONS[reason] || reason),
    detailRow('דחיפות', urgent ? 'דחוף — לטפל היום' : 'רגילה'),
    detailRow('סוכן', data.agent || '—', { last: !whyChannelText }),
    ...(whyChannelText ? [detailRow('הגיע/ה דרך', whyChannelText, { last: true })] : []),
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
          <p style="margin:14px 0 0; font-size:13px; color:${MAIL.muted};">${escapeHtml(new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }))}</p>
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

