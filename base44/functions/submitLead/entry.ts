import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

const NOTIFY_EMAIL = "amielnoy@gmail.com";
const SECONDARY_EMAIL = "dorit@govari-fin.co.il";

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
  return lines.join('\n');
}

function buildClientHtml(source, data) {
  const firstName = (data.name || '').split(' ')[0];
  const when = data.timing || 'לפי תיאום';
  const topic = data.topic || 'ייעוץ כללי';
  const isConsultation = source === 'consultation';

  const heading = isConsultation ? 'קיבלנו את בקשת הייעוץ' : 'קיבלנו את פנייתכם';
  const intro = isConsultation
    ? 'תודה שבחרתם לשתף אותי בצרכים שלכם. הפרטים תועדו בהצלחה, ואחזור אליכם אישית תוך יום עסקים אחד לתיאום פגישה מדויקת.'
    : 'תודה שפניתם אליי. הפרטים תועדו בהצלחה, ואחזור אליכם אישית בהקדם האפשרי.';

  const detailsBlock = isConsultation ? `
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:28px 0; background:#F3EDE7; border:1px solid #D3C6B9; border-radius:4px;">
          <tr><td style="padding:24px 28px;">
            <p style="margin:0 0 16px; font-size:11px; letter-spacing:0.25em; text-transform:uppercase; color:#7D6B5D; font-family:Arial,sans-serif;">פרטי הבקשה</p>
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr>
                <td style="padding:6px 0; font-size:13px; color:#7D6B5D; font-family:Arial,sans-serif; width:120px;">תחום ייעוץ</td>
                <td style="padding:6px 0; font-size:15px; color:#1A1A1B; font-family:Georgia,serif; font-weight:bold;">${topic}</td>
              </tr>
              <tr>
                <td style="padding:6px 0; font-size:13px; color:#7D6B5D; font-family:Arial,sans-serif;">מועד מבוקש</td>
                <td style="padding:6px 0; font-size:15px; color:#1A1A1B; font-family:Georgia,serif; font-weight:bold;">${when}</td>
              </tr>
            </table>
          </td></tr>
        </table>` : '';

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#F9F7F2; font-family:Arial,Helvetica,sans-serif; color:#1A1A1B; line-height:1.7;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9F7F2;">
    <tr><td align="center" style="padding:32px 16px;">
      <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; background:#FFFFFF; border:1px solid #E5DDD0;">
        <!-- Header -->
        <tr><td style="padding:36px 48px 28px; border-bottom:1px solid #E5DDD0; text-align:center;">
          <p style="margin:0 0 6px; font-family:Georgia,serif; font-size:22px; font-weight:bold; color:#1A1A1B; letter-spacing:-0.02em;">דורית גוב ארי</p>
          <p style="margin:0; font-size:10px; letter-spacing:0.3em; text-transform:uppercase; color:#7D6B5D;">התכנון שלי — הרווח שלך</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px 48px;">
          <p style="margin:0 0 24px; font-size:11px; letter-spacing:0.3em; text-transform:uppercase; color:#7D6B5D;">אישור קבלה</p>
          <h1 style="margin:0 0 20px; font-family:Georgia,serif; font-size:28px; font-weight:bold; color:#1A1A1B; line-height:1.25; letter-spacing:-0.02em;">${heading}</h1>
          <p style="margin:0 0 16px; font-size:15px; color:#3D3D3F; line-height:1.8;">שלום ${firstName},</p>
          <p style="margin:0 0 16px; font-size:15px; color:#3D3D3F; line-height:1.8;">${intro}</p>
          ${detailsBlock}
          <div style="height:2px; width:48px; background:#C3AD96; margin:28px 0;"></div>
          <p style="margin:0 0 8px; font-size:15px; color:#3D3D3F; line-height:1.8;">לכל שאלה או עדכון — ניתן להשיב ישירות למייל זה.</p>
        </td></tr>
        <!-- Signature -->
        <tr><td style="padding:0 48px 40px;">
          <p style="margin:0; font-family:Georgia,serif; font-size:17px; font-weight:bold; color:#1A1A1B;">דורית גוב ארי</p>
          <p style="margin:4px 0 0; font-size:13px; color:#7D6B5D;">מתכננת פיננסית בכירה · רישיון L-00107009</p>
          <p style="margin:8px 0 0; font-size:13px; color:#7D6B5D; direction:ltr; text-align:right;">dorit@govari-fin.co.il</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:24px 48px; background:#1A1A1B; text-align:center;">
          <p style="margin:0 0 4px; font-size:11px; color:rgba(249,247,242,0.5);">דורית גוב ארי — סוכנות ביטוח בע״מ · רישיון סוכן מרשות שוק ההון מספר L-00107009</p>
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
    const { name, phone, email, source, topic, timing, message, notes } = body || {};

    if (!name || !phone) {
      return Response.json({ error: 'נדרשים שם וטלפון' }, { status: 400 });
    }

    const data = { name, phone, email, topic, timing, message, notes };
    const agentBody = buildAgentBody(source, data);
    const subject = subjectFor(source, data);

    // הודעה לסוכנת — חובה
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: NOTIFY_EMAIL,
      subject,
      body: agentBody,
    });

    // עותק לדורית — מיטבי
    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: SECONDARY_EMAIL,
        subject,
        body: agentBody,
      });
    } catch (e) { /* מיטבי */ }

    // אישור ללקוח — מיטבי
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
      } catch (e) { /* מיטבי */ }
    }

    // תיעוד הפנייה במאגר
    try {
      await base44.entities.Lead.create({
        name,
        phone,
        email: email || '',
        source: source || 'quick',
        topic: topic || '',
        timing: timing || '',
        message: message || notes || '',
        status: 'new',
      });
    } catch (e) { /* מיטבי */ }

    // יצירת אירוע תזכורת ביומן Outlook — מיטבי, רק עבור בקשות ייעוץ
    if (source === 'consultation') try {
      const { accessToken } = await base44.asServiceRole.connectors.getConnection('outlook');
      if (accessToken) {
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const yyyy = tomorrow.getUTCFullYear();
        const mm = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(tomorrow.getUTCDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;

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
            start: { dateTime: `${dateStr}T09:00:00`, timeZone: 'Israel Standard Time' },
            end: { dateTime: `${dateStr}T09:30:00`, timeZone: 'Israel Standard Time' },
            isReminderOn: true,
            reminderMinutesBeforeStart: 60,
          }),
        });
      }
    } catch (e) { /* מיטבי */ }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}