/**
 * A meeting invitation (RFC 5545, METHOD:REQUEST) for one booked meeting.
 *
 * Dorit works in her Microsoft 365 desktop calendar, and a Google service
 * account cannot add attendees on a consumer calendar. So the Google event goes
 * to the calendar GOOGLE_CALENDAR_ID names (the operator's own, amielnoy@gmail.com)
 * without attendees, and this file goes to Dorit and the Outlook copy by mail;
 * her calendar client offers it as a meeting to accept. When the event exists
 * the UID is its iCalUID, so both are one meeting; otherwise a local one. Times
 * are UTC, which needs no VTIMEZONE block.
 */

export interface Invitation {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  organizer: string;
  organizerName: string;
  attendee: string;
  stamp?: Date;
}

/** The mailer refuses more than this; refusing here names the cause. */
export const MAX_ICS_BYTES = 20_000;

const utc = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const text = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

/** A parameter value, quoted: a display name may hold a comma or a colon. */
const param = (s: string): string => `"${s.replace(/"/g, "'")}"`;

const encoder = new TextEncoder();

/** Fold at 75 octets (RFC 5545 §3.1), never inside a UTF-8 sequence. */
function fold(line: string): string {
  const parts: string[] = [];
  let current = '';
  let size = 0;
  let limit = 75;
  for (const ch of line) {
    const n = encoder.encode(ch).length;
    if (size + n > limit) {
      parts.push(current);
      current = '';
      size = 0;
      limit = 74; // a continuation line spends one octet on its leading space
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildInvitation(i: Invitation): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//govari-fin.co.il//leads//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${i.uid}`,
    `DTSTAMP:${utc(i.stamp ?? new Date())}`,
    `DTSTART:${utc(i.start)}`,
    `DTEND:${utc(i.end)}`,
    'SEQUENCE:0',
    'STATUS:CONFIRMED',
    `SUMMARY:${text(i.summary)}`,
    `DESCRIPTION:${text(i.description)}`,
    `ORGANIZER;CN=${param(i.organizerName)}:mailto:${i.organizer}`,
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${i.attendee}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const ics = lines.map(fold).join('\r\n') + '\r\n';
  if (encoder.encode(ics).length > MAX_ICS_BYTES) throw new Error('ics_too_large');
  return ics;
}
