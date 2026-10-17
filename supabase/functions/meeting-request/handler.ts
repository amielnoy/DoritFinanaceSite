/**
 * A client asks to move or cancel a meeting from /account
 * (docs/superpowers/specs/2026-10-17-client-meetings-design.md, D5).
 *
 * POST { meetingId, kind: 'reschedule' | 'cancel', note? } with the client's session.
 *   1. request_meeting_change, under the caller's own session: Postgres checks
 *      the address is verified, the meeting is one of theirs and still
 *      scheduled, and that no request is already open. The meeting itself is
 *      never changed — Dorit moves it, or not.
 *   2. The operating team (NOTIFY_EMAILS), the lead's assigned user and the
 *      agency's owners and admins are mailed: the kind of request, the
 *      meeting's time in Israel and its topic, and a link to the leads screen.
 *      Never the client's note — it waits on the lead, behind sign-in — and
 *      nothing of it in the subject. A mail that does not go is reported
 *      (`notified: false`), never a reason to undo the request.
 *
 * Logged by ids alone.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { buildClientHtml } from '../_shared/html.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { deliveryWarning, sendMail } from '../_shared/mail.ts';
import { ADMIN_LEADS_URL } from '../_shared/ops-notice.ts';
import { NOTIFY_EMAILS } from '../_shared/recipients.ts';
import { callRpc, refusalReason, selectRows } from '../_shared/rest.ts';
import { bearer } from '../_shared/staff.ts';
import { isEmail } from '../_shared/guard.ts';

const FN = 'meeting-request';
const log = createLog(FN);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = { reschedule: 'מועד אחר', cancel: 'ביטול' } as const;
type Kind = keyof typeof KINDS;
const NOTE_MAX = 500;

/** The meeting's time as a person in Israel reads it (A-63). */
export function israelTime(iso: string | null): string {
  if (!iso) return 'לא נקבע מועד';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'לא נקבע מועד';
  return at.toLocaleString('he-IL', {
    timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Staff's mail: what was asked and about which meeting — never the client's note. */
export function requestMail(kind: Kind, scheduledAt: string | null, topic: string): { subject: string; html: string; text: string } {
  const when = israelTime(scheduledAt);
  const asked = KINDS[kind];
  return {
    subject: `בקשה לשינוי פגישה: ${asked}`,
    html: buildClientHtml({
      firstName: '',
      eyebrow: 'בקשה מלקוח',
      heading: `לקוח ביקש ${asked} לפגישה`,
      intro: 'הפגישה עצמה לא השתנתה. הבקשה והערת הלקוח מחכות על הפנייה במסך הפניות, אחרי התחברות.',
      panelTitle: 'הפגישה',
      details: [['מועד', when], ['נושא', topic || '—'], ['הבקשה', asked], ['מסך הפניות', 'לפתיחת הפנייה', ADMIN_LEADS_URL]],
      action: { label: 'למסך הפניות', href: ADMIN_LEADS_URL },
    }),
    text: [
      'שלום,', '',
      `לקוח ביקש ${asked} לפגישה. הפגישה עצמה לא השתנתה.`,
      `מועד: ${when}`,
      `נושא: ${topic || '—'}`, '',
      `הבקשה והערת הלקוח מחכות על הפנייה, אחרי התחברות: ${ADMIN_LEADS_URL}`,
    ].join('\n'),
  };
}

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const rid = newRequestId();
  const startedAt = Date.now();
  const json = (body: Record<string, unknown>, status = 200) => Response.json({ ...body, rid }, { status, headers: cors });

  log('info', 'request.start', { rid });
  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const token = bearer(req);
    if (!token) return json({ error: 'צריך להתחבר כדי לבקש שינוי.' }, 401);

    const body = (await req.json().catch(() => null)) as { meetingId?: unknown; kind?: unknown; note?: unknown } | null;
    const meetingId = typeof body?.meetingId === 'string' ? body.meetingId.toLowerCase() : '';
    const kind = typeof body?.kind === 'string' && body.kind in KINDS ? (body.kind as Kind) : null;
    const note = body?.note == null ? '' : typeof body.note === 'string' ? body.note : null;
    if (!UUID.test(meetingId)) return json({ error: 'הפגישה אינה מוכרת.' }, 400);
    if (!kind) return json({ error: 'אפשר לבקש מועד אחר או ביטול.' }, 400);
    if (note === null || note.length > NOTE_MAX) return json({ error: `ההערה יכולה להיות עד ${NOTE_MAX} תווים.` }, 400);

    let requestId: string;
    try {
      requestId = String(await callRpc('request_meeting_change', { p_meeting: meetingId, p_kind: kind, p_note: note || null }, token));
    } catch (e) {
      const why = refusalReason(e);
      log('warn', 'request.refused', { rid, meetingId, reason: why || 'error' });
      if (why === 'already_open') return json({ error: 'כבר נשלחה בקשה לפגישה הזו. דורית תחזור אליך.' }, 409);
      if (why === 'not_found') return json({ error: 'הפגישה לא נמצאה, או שכבר אי אפשר לשנות אותה.' }, 404);
      if (why === 'unverified') return json({ error: 'צריך לאמת את כתובת המייל כדי לבקש שינוי.' }, 403);
      if (why === 'invalid') return json({ error: 'הבקשה אינה תקינה.' }, 400);
      if (/^rpc_http_401/.test(String((e as Error)?.message ?? ''))) return json({ error: 'צריך להתחבר כדי לבקש שינוי.' }, 401);
      throw e;
    }
    log('info', 'request.created', { rid, meetingId, requestId, kind });

    // Who hears about it, and the meeting's time and topic for the mail.
    let notified = false;
    const warnings: string[] = [];
    try {
      const [meeting] = await selectRows('meetings', `id=eq.${meetingId}&select=scheduled_at,topic`);
      const staff = (await callRpc('meeting_request_recipients', { p_request_id: requestId })) as unknown;
      const to = [...new Set([...NOTIFY_EMAILS, ...(Array.isArray(staff) ? staff : [])]
        .map((a) => String(a).trim().toLowerCase())
        .filter((a) => isEmail(a)))];
      const mail = requestMail(kind, (meeting?.scheduled_at as string | null) ?? null, String(meeting?.topic ?? ''));
      const sent = await Promise.all(to.map(async (address) => {
        try {
          await sendMail(log, { to: address, ...mail, rid, role: 'meeting_request' });
          return true;
        } catch (e) {
          log('warn', 'mail.failed', { rid, role: 'meeting_request', err: String((e as Error)?.message ?? e).slice(0, 200) });
          warnings.push(deliveryWarning('meeting_request_mail_failed', e));
          return false;
        }
      }));
      notified = sent.some(Boolean);
    } catch (e) {
      log('warn', 'notify.failed', { rid, requestId, err: String((e as Error)?.message ?? e).slice(0, 200) });
      warnings.push('notify_failed');
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, requestId, notified });
    return json({ ok: true, requestId, notified, warnings });
  } catch (e) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return json({ error: 'הבקשה לא נשלחה. נסו שוב, או פנו לדורית ישירות.' }, 500);
  }
}
