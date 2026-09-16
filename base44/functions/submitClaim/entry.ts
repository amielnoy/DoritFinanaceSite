import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// כמה תיבות, אותו צוות. ראו את ההערה המקבילה ב-submitLead/entry.ts.
const NOTIFY_EMAILS = ["amielnoy@gmail.com", "amielnoy@outlook.com"];
const SECONDARY_EMAIL = "dorit@govari-fin.co.il";

// Include a safe delivery reason in the operations notification.
function deliveryWarning(label, error) {
  const reason = String(error?.message ?? error ?? '').slice(0, 120);
  return reason ? `${label} (${reason})` : label;
}

/**
 * The one way this app sends mail. Kept identical across the isolated entry points.
 *
 * It posts to the `dorit-mailer` Cloudflare Pages Function rather than to a
 * provider directly, so the Resend key, the sender identity and the recipient
 * list live in that project's environment and not in this one. What travels
 * from here is the finished message: these functions own the templates, the
 * HTML escaping and `redact()` on anything a model wrote, and the mailer sends
 * what it is given.
 *
 * `type: "rendered"` is the authenticated path — it names its own recipient, so
 * the mailer refuses it without the shared token. The contact/intake templates
 * on the other side are for a browser posting directly, which this is not.
 *
 * Failure is reported to the caller as a warning and never swallowed: the
 * enquiry is already stored by the time this runs.
 */
async function sendMail({ to, subject, html, text, body }) {
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


/**
 * מה שמשתנה בהודעה של submitClaim — התוכן בלבד. התבנית עצמה משותפת.
 */
function clientMailFor(data) {
  return {
    firstName: (data.name || '').split(' ')[0],
    eyebrow: 'אישור דיווח',
    heading: 'קיבלנו את דיווח האירוע',
    intro: 'קיבלתי את דיווח האירוע הביטוחי והפרטים תועדו בהצלחה. אחזור אליכם אישית בהקדם האפשרי להמשך טיפול התביעה וליווי צמוד ברגע האמת.',
    panelTitle: 'פרטי האירוע',
    // '—' rather than '': buildClientHtml drops rows with no value, so an empty
    // string would take the row out of the HTML while the plain-text twin went
    // on printing it — the two halves of one email disagreeing about which
    // fields exist. A claim filed without a date should say so in both.
    details: [
      ['סוג אירוע', data.claimType || 'כללי'],
      ['תאריך אירוע', data.eventDate || '—'],
    ],
  };
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

/**
 * המייל ללקוח — תבנית אחת לכל הודעה שיוצאת למבקר.
 *
 * זהו המכתב שהלקוח מקבל בשם הסוכנות, ולכן הוא צריך להיראות אותו דבר בכל פעם:
 * אישור בקשת ייעוץ, אישור פנייה ואישור דיווח תביעה. עד כאן היו שתי תבניות —
 * submitClaim החזיק עותק שנשר ממנה: בלי dir="rtl" (כלומר עמודות הפוכות בטבלת
 * הפרטים), בלי text-align, עם גוון פאנל אחר, ובלי escapeHtml על שם הלקוח.
 *
 * מה שמשתנה בין הודעה להודעה הוא תוכן ולא עיצוב, ולכן הוא נכנס כפרמטרים:
 * כותרת קטנה, כותרת, פסקת פתיחה ורשימת שדות. ההודעה עצמה זהה.
 *
 * One letter, three messages. Base44 gives these entry points no shared module,
 * so this function is duplicated by hand — and tests/contract/agents.contract.test.ts
 * fails when the copies stop being identical. Duplicated is fine; drifted is not.
 *
 * Callers pass raw values. Escaping happens here, at the binding site, so a new
 * field cannot be added without it.
 */
function buildClientHtml({ firstName, eyebrow, heading, intro, panelTitle, details }) {
  const rows = (details || []).filter(([, value]) => value);
  const divider =
    `
              <tr>
                <td colspan="2" style="padding:0; font-size:0; line-height:0; border-top:1px solid #E0D4C6;">&nbsp;</td>
              </tr>`;
  const detailRows = rows
    .map(([label, value]) => `
              <tr>
                <td style="padding:10px 0; font-size:13px; color:#7D6B5D; font-family:Arial,sans-serif; width:130px; text-align:right;">${escapeHtml(label)}</td>
                <td style="padding:10px 0; font-size:15px; color:#1A1A1B; font-family:Georgia,serif; font-weight:bold; text-align:right;">${escapeHtml(value)}</td>
              </tr>`)
    .join(divider);

  const detailsBlock = rows.length ? `
        <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:32px 0; background:#F6F1EA; border:1px solid #E0D4C6; border-radius:6px;">
          <tr><td style="padding:28px 32px;">
            <p style="margin:0 0 20px; font-size:11px; letter-spacing:0.25em; text-transform:uppercase; color:#7D6B5D; font-family:Arial,sans-serif; text-align:right;">${escapeHtml(panelTitle)}</p>
            <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%">${detailRows}
            </table>
          </td></tr>
        </table>` : '';

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#F9F7F2; font-family:Arial,Helvetica,sans-serif; color:#1A1A1B; line-height:1.7; -webkit-text-size-adjust:100%;">
  <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9F7F2;">
    <tr><td align="center" style="padding:32px 16px;">
      <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:600px; background:#FFFFFF; border:1px solid #E5DDD0; border-radius:6px; overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:40px 48px 30px; border-bottom:1px solid #E5DDD0; text-align:center;">
          <p style="margin:0 0 6px; font-family:Georgia,serif; font-size:24px; font-weight:bold; color:#1A1A1B; letter-spacing:-0.02em;">דורית גוב ארי</p>
          <p style="margin:0; font-size:10px; letter-spacing:0.3em; text-transform:uppercase; color:#7D6B5D;">התכנון שלי — הרווח שלך</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:44px 48px 36px; text-align:right;">
          <p style="margin:0 0 20px; font-size:11px; letter-spacing:0.3em; text-transform:uppercase; color:#7D6B5D;">${escapeHtml(eyebrow)}</p>
          <h1 style="margin:0 0 24px; font-family:Georgia,serif; font-size:28px; font-weight:bold; color:#1A1A1B; line-height:1.3; letter-spacing:-0.02em; text-align:right;">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 16px; font-size:15px; color:#3D3D3F; line-height:1.8; text-align:right;">שלום ${escapeHtml(firstName)},</p>
          <p style="margin:0 0 16px; font-size:15px; color:#3D3D3F; line-height:1.8; text-align:right;">${escapeHtml(intro)}</p>
          ${detailsBlock}
          <div style="height:2px; width:48px; background:#C3AD96; margin:32px 0 20px;"></div>
          <p style="margin:0; font-size:15px; color:#3D3D3F; line-height:1.8; text-align:right;">לכל שאלה או עדכון — ניתן להשיב ישירות למייל זה.</p>
        </td></tr>
        <!-- Signature -->
        <tr><td style="padding:0 48px 40px; text-align:right;">
          <p style="margin:0; font-family:Georgia,serif; font-size:18px; font-weight:bold; color:#1A1A1B;">דורית גוב ארי</p>
          <p style="margin:4px 0 0; font-size:13px; color:#7D6B5D;">מתכננת פיננסית בכירה · רישיון L-00107009</p>
          <p style="margin:8px 0 0; font-size:13px; color:#7D6B5D; direction:ltr; text-align:right;">dorit@govari-fin.co.il</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:26px 48px; background:#1A1A1B; text-align:center;">
          <p style="margin:0 0 4px; font-size:11px; color:rgba(249,247,242,0.5); line-height:1.6;">דורית גוב ארי — סוכנות ביטוח בע״מ · רישיון סוכן מרשות שוק ההון מספר L-00107009</p>
          <p style="margin:0; font-size:10px; color:rgba(249,247,242,0.35); letter-spacing:0.15em; text-transform:uppercase;">Designed with Structural Serenity</p>
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
    const { name, phone, email, claimType, eventDate, policyNumber, description, documents } = body || {};

    if (!name || !phone) {
      return Response.json({ error: 'נדרשים שם וטלפון' }, { status: 400 });
    }

    const docList = Array.isArray(documents) ? documents : [];
    const docLines = docList.length
      ? [``, `מסמכים מצורפים (${docList.length}):`, ...docList.map((d, i) => `${i + 1}. ${d}`)]
      : ['', 'מסמכים מצורפים: אין'];

    const agentBody = [
      `דיווח אירוע ביטוחי חדש — ${new Date().toLocaleString("he-IL")}`,
      ``,
      `שם: ${name}`,
      `טלפון: ${phone}`,
      `אימייל: ${email || '—'}`,
      `סוג אירוע: ${claimType || '—'}`,
      `תאריך אירוע: ${eventDate || '—'}`,
      `מספר פוליסה: ${policyNumber || '—'}`,
      ``,
      `תיאור האירוע:`,
      description || '—',
      ...docLines,
    ].join('\n');

    const subject = `דיווח אירוע ביטוחי — ${name} (${claimType || 'כללי'})`;

    // הפנייה נשמרת ראשונה — ראו את ההסבר ב-submitLead.
    // The record is written first; see submitLead for the reasoning.
    const messageBody = [
      `סוג: ${claimType || ''}`,
      `תאריך אירוע: ${eventDate || ''}`,
      `פוליסה: ${policyNumber || ''}`,
      ``,
      description || '',
      ``,
      docList.length ? `מסמכים: ${docList.join(' | ')}` : '',
    ].filter(Boolean).join('\n');

    let leadId = null;
    try {
      const lead = await base44.entities.Lead.create({
        name,
        phone,
        email: email || '',
        source: 'claim',
        topic: claimType || '',
        timing: eventDate || '',
        message: messageBody,
        status: 'new',
      });
      leadId = lead?.id ?? null;
    } catch (e) {
      return Response.json(
        { error: 'לא הצלחנו לשמור את הדיווח. נסו שוב או צרו קשר ישירות.', details: e?.message },
        { status: 500 }
      );
    }

    const warnings = [];

    // הודעה לצוות התפעול — תיבה אחת שנכשלת אינה מונעת את השאר.
    for (const to of NOTIFY_EMAILS) {
      try {
        await sendMail({
          to,
          subject,
          body: agentBody,
        });
      } catch (e) {
        warnings.push(deliveryWarning('notify_email_failed', e));
      }
    }

    // עותק לדורית
    try {
      await sendMail({
        to: SECONDARY_EMAIL,
        subject,
        body: agentBody,
      });
    } catch (e) {
      warnings.push(deliveryWarning('secondary_email_failed', e));
    }

    // אישור ללקוח — מיטבי
    if (email) {
      try {
        const firstName = (name || '').split(' ')[0];
        const clientText = [
          `שלום ${firstName}, קיבלתי את דיווח האירוע הביטוחי והפרטים תועדו בהצלחה.`,
          `סוג אירוע: ${claimType || 'כללי'} · תאריך: ${eventDate || '—'}`,
          `אחזור אליכם אישית בהקדם האפשרי להמשך טיפול התביעה.`,
          `לכל שאלה — ניתן להשיב ישירות למייל זה.`,
          `בברכה, דורית גוב ארי · dorit@govari-fin.co.il`,
        ].join('\n');
        await sendMail({
          to: email,
          subject: `אישור — קיבלנו את דיווח האירוע שלכם · דורית גוב ארי`,
          html: buildClientHtml(clientMailFor({ name, claimType, eventDate })),
          text: clientText,
        });
      } catch (e) {
        warnings.push(deliveryWarning('client_confirmation_failed', e));
      }
    }

    return Response.json({ ok: true, leadId, warnings });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}