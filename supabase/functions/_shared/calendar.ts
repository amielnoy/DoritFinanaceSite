/**
 * One meeting in Dorit's Google calendar, written by the service account she
 * shared it with. No attendees: a service account cannot invite on a consumer
 * calendar, so invitations go out by mail (ics.ts). Reminders and time zone
 * are base44/functions/submitLead's.
 */
import { googleAccessToken } from './google.ts';

export interface CalendarEventInput {
  summary: string;
  description: string;
  /** Wall-clock in Israel, `YYYY-MM-DDTHH:MM:SS`, as wallClock() returns it. */
  startIso: string;
  endIso: string;
}

export interface CreatedEvent {
  id: string;
  iCalUID: string;
  htmlLink: string;
  start: Date;
  end: Date;
}

export function calendarConfigured(): boolean {
  return Boolean((Deno.env.get('GOOGLE_CALENDAR_ID') || '').trim());
}

export async function createCalendarEvent(e: CalendarEventInput): Promise<CreatedEvent> {
  const calendarId = (Deno.env.get('GOOGLE_CALENDAR_ID') || '').trim();
  if (!calendarId) throw new Error('calendar_not_configured');
  const token = await googleAccessToken();
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: e.summary,
      description: e.description,
      start: { dateTime: e.startIso, timeZone: 'Asia/Jerusalem' },
      end: { dateTime: e.endIso, timeZone: 'Asia/Jerusalem' },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 },
          { method: 'email', minutes: 720 },
        ],
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`calendar_http_${res.status}`);
  const data = (await res.json()) as {
    id: string;
    iCalUID: string;
    htmlLink: string;
    start: { dateTime: string };
    end: { dateTime: string };
  };
  return {
    id: data.id,
    iCalUID: data.iCalUID,
    htmlLink: data.htmlLink,
    start: new Date(data.start.dateTime),
    end: new Date(data.end.dateTime),
  };
}
