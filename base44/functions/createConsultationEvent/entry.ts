import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { name, phone, email, topic, timing, notes } = body || {};

    if (!name || !phone) {
      return Response.json({ error: 'נדרשים שם וטלפון' }, { status: 400 });
    }

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');

    // תזמון תזכורת מעקב למחר ב-09:00 שעון ישראל
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const yyyy = tomorrow.getUTCFullYear();
    const mm = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getUTCDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const summary = `ייעוץ חדש — ${name}`;
    const description = [
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
      summary,
      description,
      start: { dateTime: `${dateStr}T09:00:00`, timeZone: 'Asia/Jerusalem' },
      end: { dateTime: `${dateStr}T09:30:00`, timeZone: 'Asia/Jerusalem' },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 },
          { method: 'email', minutes: 720 },
        ],
      },
    };

    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      return Response.json({ error: 'שגיאת Google Calendar', details: errText }, { status: 502 });
    }

    const data = await res.json();
    return Response.json({ ok: true, eventId: data.id, htmlLink: data.htmlLink });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}