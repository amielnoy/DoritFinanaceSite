import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/** שם הפונקציה כפי שהוא מופיע בכל שורת יומן שלה. */
const FN = 'submitClaim';

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
async function sendMail({ base44, to, subject, html, text, body, rid, role }) {
  // התפקיד ולא הכתובת. אחד הנמענים הוא המבקר עצמו, וכתובתו לא תיכתב ליומן
  // שנשמר לאורך זמן — `role` מספיק כדי לדעת איזה עותק לא יצא.
  const started = Date.now();
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
    log('info', 'mail.sent', { rid, role, transport: 'core', ms: Date.now() - started });
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
  log('info', 'mail.sent', { rid, role, transport: 'mailer', ms: Date.now() - started });
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

/**
 * שיקוף הפנייה ל-Supabase. לעולם לא זורק.
 *
 * Base44 הוא המקור הסמכותי בשלב הזה: הפנייה כבר נשמרה לפני שמגיעים לכאן, וכשל
 * בשיקוף הוא עניין של התאמה בין שני מאגרים — לא של פנייה שאבדה. לכן הוא נרשם
 * ביומן ואינו מחזיר שגיאה למבקר, שאצלו הכל הצליח.
 *
 * `on_conflict=base44_id` עם merge-duplicates: מסלול הראיון מעדכן רשומה קיימת
 * במקום ליצור חדשה, ואותה קריאה משרתת את שני המסלולים בלי לדעת מי מהם קרא לה.
 *
 * מפתח השירות עוקף RLS. זה נדרש: קריאת העדכון של ראיון פתוח חסומה למנהלים
 * בלבד, ולפונקציה אין משתמש מחובר מאחוריה.
 */
async function mirrorLeadToSupabase(rid, base44Id, row) {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  // לא מוגדר — אין שיקוף, ואין רעש ביומן. כך נראית הפונקציה לפני שההגירה
  // הופעלה, וזה מצב תקין ולא תקלה.
  if (!url || !key || !base44Id) return;

  try {
    const res = await fetch(`${url}/rest/v1/leads?on_conflict=base44_id`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ ...row, base44_id: base44Id }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 140)}`);
    log('info', 'lead.mirrored', { rid, base44Id });
  } catch (e) {
    log('warn', 'lead.mirror_failed', { rid, base44Id, err: String(e?.message ?? e).slice(0, 200) });
  }
}

export default async function(req) {
  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid, source: 'claim' });
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { name, phone, email, claimType, eventDate, policyNumber, description, documents } = body || {};

    if (!name || !phone) {
      log('warn', 'request.rejected', { rid, reason: 'missing_contact_fields' });
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
      log('info', 'lead.created', { rid, leadId, source: 'claim' });
    } catch (e) {
      // הכשל הקשה היחיד כאן: הדיווח לא נשמר, ולכן גם לא יישלח.
      log('error', 'lead.create_failed', { rid, err: String(e?.message ?? e).slice(0, 200) });
      return Response.json(
        { error: 'לא הצלחנו לשמור את הדיווח. נסו שוב או צרו קשר ישירות.', details: e?.message },
        { status: 500 }
      );
    }

    // שיקוף ל-Supabase, אחרי שהדיווח כבר נשמר. דיווח תביעה הוא פנייה לכל דבר:
    // מי שמסר כאן את פרטיו נמצא באותו מאגר כמו מי שמילא טופס יצירת קשר.
    await mirrorLeadToSupabase(rid, leadId, {
      name,
      phone,
      email: email || '',
      source: 'claim',
      topic: claimType || '',
      timing: eventDate || '',
      message: messageBody,
      status: 'new',
    });

    const warnings = [];

    // הודעה לצוות התפעול — תיבה אחת שנכשלת אינה מונעת את השאר.
    for (const to of NOTIFY_EMAILS) {
      try {
        await sendMail({
          base44,
          to,
          subject,
          body: agentBody,
          rid,
          role: 'ops',
        });
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'ops', err: String(e?.message ?? e).slice(0, 200) });
        warnings.push(deliveryWarning('notify_email_failed', e));
      }
    }

    // עותק לדורית
    try {
      await sendMail({
        base44,
        to: SECONDARY_EMAIL,
        subject,
        body: agentBody,
        rid,
        role: 'agency',
      });
    } catch (e) {
      log('warn', 'mail.failed', { rid, role: 'agency', err: String(e?.message ?? e).slice(0, 200) });
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
          base44,
          to: email,
          subject: `אישור — קיבלנו את דיווח האירוע שלכם · דורית גוב ארי`,
          html: buildClientHtml(clientMailFor({ name, claimType, eventDate })),
          text: clientText,
          rid,
          role: 'visitor',
        });
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'visitor', err: String(e?.message ?? e).slice(0, 200) });
        warnings.push(deliveryWarning('client_confirmation_failed', e));
      }
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, leadId, warnings: warnings.length });
    return Response.json({ ok: true, leadId, warnings });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String(error?.message ?? error).slice(0, 200) });
    return Response.json({ error: error.message }, { status: 500 });
  }
}