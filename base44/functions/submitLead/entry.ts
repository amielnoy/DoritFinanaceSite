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

function buildClientBody(source, data) {
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
          body: buildClientBody(source, data),
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

    // יצירת אירוע תזכורת ביומן Google — מיטבי
    try {
      const { accessToken: gToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');
      if (gToken) {
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const yyyy = tomorrow.getUTCFullYear();
        const mm = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(tomorrow.getUTCDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;

        await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${gToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            summary: subject,
            description: `${agentBody}\n\nלייצר קשר ולתאם מעקב.`,
            start: { dateTime: `${dateStr}T09:00:00`, timeZone: 'Asia/Jerusalem' },
            end: { dateTime: `${dateStr}T09:30:00`, timeZone: 'Asia/Jerusalem' },
            reminders: {
              useDefault: false,
              overrides: [
                { method: 'popup', minutes: 60 },
                { method: 'email', minutes: 720 },
              ],
            },
          }),
        });
      }
    } catch (e) { /* מיטבי */ }

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}