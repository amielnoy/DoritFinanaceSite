import { DEFAULT_DURATION_MIN, type ClientMeeting } from "@/lib/meetings";

/**
 * "הוספה ליומן שלי": a Google Calendar link and an .ics file, made in the
 * browser from the client's own row — nothing new leaves the database
 * (docs/superpowers/specs/2026-10-17-client-meetings-design.md, D6).
 *
 * Both carry the meeting as UTC instants (…Z), which name one moment whatever
 * the calendar's zone: 10:00 in Israel on either side of a daylight-saving
 * change lands at 10:00 in Israel. Google is also told Asia/Jerusalem, for how
 * it shows the event. Never the client's summary or Dorit's notes — the title,
 * the time and the place alone.
 */

const SITE = "govari-fin.co.il";

/** "20261104T080000Z". */
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

function span(m: ClientMeeting): { start: number; end: number } | null {
  const start = m.scheduledAt ? new Date(m.scheduledAt).getTime() : NaN;
  if (Number.isNaN(start)) return null;
  return { start, end: start + (m.durationMin ?? DEFAULT_DURATION_MIN) * 60_000 };
}

/** What the event is called in the client's calendar. */
export const eventTitle = (m: ClientMeeting, fallback: string) => `פגישה עם דורית גוב ארי — ${m.topic || fallback}`;

/** RFC 5545 text: backslash, semicolon, comma and line breaks escaped. */
const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** RFC 5545 folding: lines of at most 75 octets, continued with a space. Hebrew is two octets a letter. */
function fold(line: string): string {
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    if (octets + size > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

/** The .ics file's text, or null for a meeting with no time. */
export function icsFor(m: ClientMeeting, title: string, now = new Date()): string | null {
  const s = span(m);
  if (!s) return null;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${SITE}//meetings//HE`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:meeting-${m.id}@${SITE}`,
    `DTSTAMP:${stamp(now.getTime())}`,
    `DTSTART:${stamp(s.start)}`,
    `DTEND:${stamp(s.end)}`,
    `SUMMARY:${escapeText(title)}`,
    ...(m.location ? [`LOCATION:${escapeText(m.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Google Calendar's "add event" page for the meeting, or null with no time. */
export function googleCalendarUrl(m: ClientMeeting, title: string): string | null {
  const s = span(m);
  if (!s) return null;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${stamp(s.start)}/${stamp(s.end)}`,
    ctz: "Asia/Jerusalem",
  });
  if (m.location) params.set("location", m.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
