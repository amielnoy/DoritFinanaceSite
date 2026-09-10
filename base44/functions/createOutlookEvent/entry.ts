import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { name, phone, email, topic, timing, notes, scheduledAt } = body || {};

    if (!name || !phone) {
      return Response.json({ error: 'נדרשים שם וטלפון' }, { status: 400 });
    }

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('outlook');

    // תזמון האירוע — לפי התאריך והשעה שנבחרו, או ברירת מחדל למחר ב-09:00
    let startIso, endIso;
    if (scheduledAt) {
      const start = new Date(scheduledAt);
      const end = new Date(start.getTime() + 30 * 60 * 1000);
      startIso = start.toISOString();
      endIso = end.toISOString();
    } else {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const yyyy = tomorrow.getUTCFullYear();
      const mm = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(tomorrow.getUTCDate()).padStart(2, '0');
      startIso = `${yyyy}-${mm}-${dd}T09:00:00`;
      endIso = `${yyyy}-${mm}-${dd}T09:30:00`;
    }

    const subject = `ייעוץ חדש — ${name}`;
    const content = [
      `פנייה חדשה מהאתר`,
      ``,
      `שם: ${name}`,
      `טלפון: ${phone}`,
      `אימייל: ${email || '—'}`,
      `תחום ייעוץ: ${topic || '—'}`,
      `מועד מבוקש: ${timing || '—'}`,
      `הערות: ${notes || '—'}`,
      ``,
      `לייצר קשר ולתאם את פגישת הייעוץ הראשונה.`,
    ].join('\n');

    const eventBody = {
      subject,
      body: { contentType: 'Text', content },
      start: { dateTime: startIso, timeZone: 'Israel Standard Time' },
      end: { dateTime: endIso, timeZone: 'Israel Standard Time' },
      isReminderOn: true,
      reminderMinutesBeforeStart: 60,
    };

    const res = await fetch('https://graph.microsoft.com/v1.0/me/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      return Response.json({ error: 'שגיאת Outlook Calendar', details: errText }, { status: 502 });
    }

    const data = await res.json();
    return Response.json({ ok: true, eventId: data.id, webLink: data.webLink });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}