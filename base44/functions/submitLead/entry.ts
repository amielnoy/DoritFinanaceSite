import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

// שני נמענים, שניהם מקבלים את הפנייה המלאה.
//
// SECONDARY_EMAIL הוא הסוכנת. NOTIFY_EMAIL הוא הצוות שמתפעל את האתר מטעמה,
// ומקבל בנוסף נספח מצב על השמירה, היומן והמיילים.
//
// זה מחייב גילוי, וקיים כזה: נוסח ההסכמה ב-src/config/compliance.ts ומדיניות
// הפרטיות אומרים "אצל דורית ואצל הצוות שמתפעל את האתר מטעמה" — ולא "אצל
// דורית בלבד", שהיה הנוסח הקודם והיה הופך להצהרה לא נכונה ברגע שנשלח עותק
// החוצה. tests/contract/agents.contract.test.ts אוכף שהקוד והנוסח מסכימים,
// לשני הכיוונים: מי שיצמצם כאן את השליחה חייב להחזיר גם את הנוסח.
const NOTIFY_EMAIL = "amielnoy@gmail.com";
const SECONDARY_EMAIL = "dorit@govari-fin.co.il";

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

// ── יומן האירועים בגיליון Google ──────────────────────────────────────────
//
// מזהה הגיליון מתוך כתובת ה-URL שלו:
//   https://docs.google.com/spreadsheets/d/<המזהה>/edit
// ריק = הרישום מדולג בשקט, כדי שהתקנה בלי גיליון תמשיך לעבוד.
//
// זהו עותק שלישי של פרטי המבקר, אחרי המאגר והמיילים, והיחיד שאינו נמחק על ידי
// מחיקת רשומה במאגר. ראו את ההערה על שמירה ב-base44/agents/COMPLIANCE.md §6.
const SHEET_ID = '';
const SHEET_TAB = 'Events';

/**
 * סדר העמודות בגיליון.
 *
 * משוכפל בכל פונקציה שכותבת ליומן, ו-tests/contract/agents.contract.test.ts
 * נכשל אם שתי הרשימות מתפצלות — שורה שנכתבת בסדר אחר הורסת את הגיליון בשקט,
 * בלי שדבר ייכשל.
 */
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

/** סוג האירוע כפי שהוא נרשם בגיליון — הערך שמאפשר לסנן את הגיליון לפי סוג. */
function eventTypeFor(source) {
  if (source === 'consultation') return 'consultation_request';
  if (source === 'detailed') return 'detailed_enquiry';
  return 'quick_contact';
}

/** נספח תפעולי — מה עלה בגורלם של השמירה, היומן והמיילים. */
function buildOpsFooter(source, { leadId, topic, calendar, sheet, warnings }) {
  return [
    `── מצב תפעולי ──`,
    `מקור: ${source || 'quick'}`,
    `נושא: ${topic || '—'}`,
    `מזהה רשומה: ${leadId || '—'}`,
    `יומן: ${calendar}`,
    `גיליון: ${sheet}`,
    `תקלות: ${warnings.length ? warnings.join(', ') : 'אין'}`,
  ].join('\n');
}

function buildAgentBody(source, data) {
  const header = source === 'consultation'
    ? 'בקשת ייעוץ חדשה'
    : source === 'detailed'
    ? 'פנייה מפורטת מהאתר'
    : 'פנייה חדשה מהאתר';
  const lines = [
    `${header} — ${new Date().toLocaleString("he-IL")}`,
    ``,
    `שם: ${data.name}`,
    `טלפון: ${data.phone}`,
    `אימייל: ${data.email || '—'}`,
  ];
  if (source === 'consultation') {
    lines.push(`תחום ייעוץ: ${data.topic || '—'}`);
    lines.push(`מועד מבוקש: ${data.timing || 'לפי תיאום'}`);
    lines.push(`הערות: ${data.notes || '—'}`);
  } else if (source === 'detailed') {
    lines.push(`שירות מבוקש: ${data.topic || '—'}`);
    lines.push(`מועד מועדף ליצירת קשר: ${data.timing || '—'}`);
    lines.push(``, `הודעה אישית:`, data.message || '—');
  } else {
    lines.push(``, `הודעה:`, data.message || '—');
  }
  if (data.summary) {
    lines.push(``, `תקציר השיחה (לאחר השמטת פרטים רגישים):`, data.summary);
  }
  return lines.join('\n');
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

function buildClientHtml(source, data) {
  const firstName = escapeHtml((data.name || '').split(' ')[0]);
  const when = escapeHtml(data.timing || 'לפי תיאום');
  const topic = escapeHtml(data.topic || 'ייעוץ כללי');
  const isConsultation = source === 'consultation';

  const heading = isConsultation ? 'קיבלנו את בקשת הייעוץ' : 'קיבלנו את פנייתכם';
  const intro = isConsultation
    ? 'תודה שבחרתם לשתף אותי בצרכים שלכם. הפרטים תועדו בהצלחה, ואחזור אליכם אישית תוך יום עסקים אחד לתיאום פגישה מדויקת.'
    : 'תודה שפניתם אליי. הפרטים תועדו בהצלחה, ואחזור אליכם אישית בהקדם האפשרי.';

  const detailsBlock = isConsultation ? `
        <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:32px 0; background:#F6F1EA; border:1px solid #E0D4C6; border-radius:6px;">
          <tr><td style="padding:28px 32px;">
            <p style="margin:0 0 20px; font-size:11px; letter-spacing:0.25em; text-transform:uppercase; color:#7D6B5D; font-family:Arial,sans-serif; text-align:right;">פרטי הבקשה</p>
            <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="padding:10px 0; font-size:13px; color:#7D6B5D; font-family:Arial,sans-serif; width:130px; text-align:right;">תחום ייעוץ</td>
                <td style="padding:10px 0; font-size:15px; color:#1A1A1B; font-family:Georgia,serif; font-weight:bold; text-align:right;">${topic}</td>
              </tr>
              <tr>
                <td colspan="2" style="padding:0; font-size:0; line-height:0; border-top:1px solid #E0D4C6;">&nbsp;</td>
              </tr>
              <tr>
                <td style="padding:10px 0; font-size:13px; color:#7D6B5D; font-family:Arial,sans-serif; text-align:right;">מועד מבוקש</td>
                <td style="padding:10px 0; font-size:15px; color:#1A1A1B; font-family:Georgia,serif; font-weight:bold; text-align:right;">${when}</td>
              </tr>
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
          <p style="margin:0 0 20px; font-size:11px; letter-spacing:0.3em; text-transform:uppercase; color:#7D6B5D;">אישור קבלה</p>
          <h1 style="margin:0 0 24px; font-family:Georgia,serif; font-size:28px; font-weight:bold; color:#1A1A1B; line-height:1.3; letter-spacing:-0.02em; text-align:right;">${heading}</h1>
          <p style="margin:0 0 16px; font-size:15px; color:#3D3D3F; line-height:1.8; text-align:right;">שלום ${firstName},</p>
          <p style="margin:0 0 16px; font-size:15px; color:#3D3D3F; line-height:1.8; text-align:right;">${intro}</p>
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

function buildClientText(source, data) {
  const firstName = (data.name || '').split(' ')[0];
  const when = data.timing || 'לפי תיאום';
  if (source === 'consultation') {
    return [
      `שלום ${firstName}, קיבלתי את בקשת הייעוץ והפרטים תועדו בהצלחה.`,
      `נושא: ${data.topic || 'ייעוץ כללי'} · מועד מבוקש: ${when}`,
      `אחזור אליכם אישית תוך יום עסקים אחד לתיאום מדויק.`,
      `לכל שאלה — ניתן להשיב ישירות למייל זה.`,
      `בברכה, דורית גוב ארי · dorit@govari-fin.co.il`,
    ].join('\n');
  }
  return [
    `שלום ${firstName}, קיבלתי את פנייתכם והפרטים תועדו בהצלחה.`,
    `אחזור אליכם אישית בהקדם האפשרי.`,
    `לכל שאלה — ניתן להשיב ישירות למייל זה.`,
    `בברכה, דורית גוב ארי · dorit@govari-fin.co.il`,
  ].join('\n');
}

function subjectFor(source, data) {
  if (source === 'consultation') return `בקשת ייעוץ חדשה — ${data.name}`;
  if (source === 'detailed') return `פנייה מפורטת — ${data.name} (${data.topic || 'כללי'})`;
  return `פנייה חדשה מהאתר — ${data.name}`;
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { name, phone, email, source, topic, timing, message, notes, scheduledAt, summary } = body || {};

    if (!name || !phone) {
      return Response.json({ error: 'נדרשים שם וטלפון' }, { status: 400 });
    }

    // התקציר נכתב על ידי מודל, ולכן עובר סינון לפני שהוא נשלח לאן שהוא.
    const safeSummary = redact(summary);
    const data = { name, phone, email, topic, timing, message, notes, summary: safeSummary };
    const agentBody = buildAgentBody(source, data);
    const subject = subjectFor(source, data);

    // ── סדר הפעולות ─────────────────────────────────────────────────────
    // הפנייה נשמרת ראשונה. המייל הוא הערוץ השביר (מסירה, דומיין מאומת,
    // נמען רשום) והמאגר הוא האמין — אם נכשלת שליחת המייל, הפנייה כבר
    // מתועדת ואינה אובדת. כשל בשמירה הוא היחיד שמחזיר שגיאה ללקוח.
    //
    // The record is written first. Email is the fragile channel and the
    // database is the reliable one, so a failed send can no longer lose the
    // enquiry; only a failed write is reported to the caller as an error.
    let leadId = null;
    try {
      const lead = await base44.entities.Lead.create({
        name,
        phone,
        email: email || '',
        source: source || 'quick',
        topic: topic || '',
        timing: timing || '',
        message: message || notes || '',
        status: 'new',
      });
      leadId = lead?.id ?? null;
    } catch (e) {
      // אין ערוץ גיבוי — הפנייה תאבד. זהו הכשל היחיד שחייב להיכשל בקול.
      return Response.json(
        { error: 'לא הצלחנו לשמור את הפנייה. נסו שוב או צרו קשר ישירות.', details: e?.message },
        { status: 500 }
      );
    }

    // מכאן והלאה — מיטבי. הפנייה כבר שמורה, ולכן כשל בהודעה מדווח
    // בתשובה במקום להיכשל, כדי שניתן יהיה לנטר אותו.
    const warnings = [];

    // הודעה לדורית — הפנייה המלאה, כולל תקציר השיחה אם הסוכן מסר אחד.
    // ההודעה התפעולית נשלחת בסוף, אחרי היומן, כדי שתוכל לדווח גם עליו.
    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: SECONDARY_EMAIL,
        subject,
        body: agentBody,
      });
    } catch (e) {
      warnings.push('secondary_email_failed');
    }

    // אישור ללקוח
    if (email) {
      try {
        const clientSubject = source === 'consultation'
          ? `אישור — קיבלנו את בקשת הייעוץ שלכם · דורית גוב ארי`
          : `אישור — קיבלנו את פנייתכם · דורית גוב ארי`;
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: email,
          subject: clientSubject,
          html: buildClientHtml(source, data),
          text: buildClientText(source, data),
        });
      } catch (e) {
        warnings.push('client_confirmation_failed');
      }
    }

    // יצירת אירוע תזכורת ביומן Outlook — מיטבי, רק עבור בקשות ייעוץ
    let calendar = source === 'consultation' ? 'לא נוצר' : 'לא רלוונטי';
    if (source === 'consultation') try {
      const { accessToken } = await base44.asServiceRole.connectors.getConnection('outlook');
      if (accessToken) {
        let calStartIso, calEndIso;
        if (scheduledAt) {
          const calStart = new Date(scheduledAt);
          const calEnd = new Date(calStart.getTime() + 30 * 60 * 1000);
          calStartIso = calStart.toISOString();
          calEndIso = calEnd.toISOString();
        } else {
          const now = new Date();
          const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          const yyyy = tomorrow.getUTCFullYear();
          const mm = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(tomorrow.getUTCDate()).padStart(2, '0');
          calStartIso = `${yyyy}-${mm}-${dd}T09:00:00`;
          calEndIso = `${yyyy}-${mm}-${dd}T09:30:00`;
        }

        const calSubject = subject;
        const calContent = `${agentBody}\n\nלייצר קשר ולתאם מעקב.`;

        await fetch('https://graph.microsoft.com/v1.0/me/events', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            subject: calSubject,
            body: { contentType: 'Text', content: calContent },
            start: { dateTime: calStartIso, timeZone: 'Israel Standard Time' },
            end: { dateTime: calEndIso, timeZone: 'Israel Standard Time' },
            isReminderOn: true,
            reminderMinutesBeforeStart: 60,
          }),
        });
        calendar = 'אירוע נוצר ✓';
      }
    } catch (e) {
      warnings.push('calendar_event_failed');
    }

    // רישום ביומן האירועים — מיטבי. הגיליון הוא תצוגה, לא מקור האמת: הרשומה
    // כבר נשמרה, ולכן כשל כאן מדווח ב-warnings ואינו מפיל את הפנייה.
    let sheet = 'לא נרשם';
    try {
      sheet = await appendEventRow(base44, [
        new Date().toISOString(),
        eventTypeFor(source),
        source || 'quick',
        '',                       // סוכן — רלוונטי רק בהעברה לאדם
        topic || '',
        timing || '',
        name,
        phone,
        email || '',
        leadId || '',
        '',                       // סיבת העברה — רלוונטי רק בהעברה לאדם
        safeSummary,
      ]);
    } catch (e) {
      warnings.push('sheet_append_failed');
    }

    // עותק לצוות התפעול — אותה פנייה מלאה, בתוספת נספח המצב. נשלח אחרון
    // כדי שיוכל לדווח גם על תוצאת היומן והגיליון. ראו ההערה ליד NOTIFY_EMAIL.
    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: NOTIFY_EMAIL,
        subject,
        body: `${agentBody}\n\n${buildOpsFooter(source, { leadId, topic, calendar, sheet, warnings })}`,
      });
    } catch (e) {
      warnings.push('notify_email_failed');
    }

    return Response.json({ ok: true, leadId, warnings });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}