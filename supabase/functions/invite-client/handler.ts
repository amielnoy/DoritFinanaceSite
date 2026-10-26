/**
 * "שליחת הזמנה לאזור האישי": after a member adds a client by hand, a mail to
 * that client with a link to sign in to the personal area
 * (docs/superpowers/specs/2026-10-22-staff-client-design.md).
 *
 * POST { agencyId, leadId } with the caller's session.
 *   0. Agency 1 only, and only with the server's STAFF_CLIENTS on.
 *   1. The session, then at least User in that agency (_shared/staff.ts).
 *   2. The lead, read under the caller's own token: one they cannot see is
 *      not found, and nothing is sent. It must be a client with an email.
 *   3. Twice per lead a year (a retry when the mailer fails, or a lost mail).
 *   4. The mail, then a row in the event sheet — the invite's only record.
 *
 * It creates no account for the person: they sign up with that address, and
 * enquiries_for finds the lead once the address is confirmed.
 *
 * Logged by ids alone: the client's name and address stay out.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { greetingName, isEmail, limitCheck } from '../_shared/guard.ts';
import { buildClientHtml } from '../_shared/html.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { sendMail } from '../_shared/mail.ts';
import { AGENCY_1 } from '../_shared/masleka.ts';
import { selectRows } from '../_shared/rest.ts';
import { appendSheetRow } from '../_shared/sheets.ts';
import { requireAgencyRole } from '../_shared/staff.ts';
import { staffClientsEnabled } from '../_shared/staff-clients.ts';
import { SHEET_COLUMNS, SHEET_TAB } from '../submit-lead/lead.js';

const FN = 'invite-client';
const log = createLog(FN);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The app's own sign-in, back to the personal area afterwards (as the header's link). */
export const ACCOUNT_LOGIN_URL = 'https://govari-fin.co.il/login?returnTo=/account';
const YEAR = 365 * 24 * 3600;

/** The invitation: the first name at most, and the link. Nothing about what the agency handles. */
export function inviteMail(name: unknown): { subject: string; html: string; text: string } {
  const first = greetingName(name);
  const intro =
    'באזור האישי באתר אפשר לראות את הפגישות שלנו, לבקש פגישה ולעקוב אחרי הבקשות שלך. ההתחברות היא עם כתובת הדוא״ל הזו.';
  return {
    subject: 'הזמנה לאזור האישי — דורית גוב ארי',
    html: buildClientHtml({
      firstName: first,
      eyebrow: 'אזור אישי',
      heading: 'האזור האישי שלך מחכה',
      intro,
      panelTitle: 'כניסה',
      details: [['אזור אישי', 'להתחברות', ACCOUNT_LOGIN_URL]],
      action: { label: 'לאזור האישי', href: ACCOUNT_LOGIN_URL },
    }),
    text: [first ? `שלום ${first},` : 'שלום,', '', intro, ACCOUNT_LOGIN_URL].join('\n'),
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

    const body = (await req.json().catch(() => null)) as { agencyId?: unknown; leadId?: unknown } | null;
    const agencyId = typeof body?.agencyId === 'string' ? body.agencyId : '';
    const leadId = typeof body?.leadId === 'string' ? body.leadId.toLowerCase() : '';
    if (!UUID.test(agencyId)) return json({ error: 'הסוכנות אינה מוכרת.' }, 400);
    if (!UUID.test(leadId)) return json({ error: 'הלקוח/ה אינו/ה מוכר/ת.' }, 400);
    if (agencyId !== AGENCY_1 || !staffClientsEnabled()) {
      log('warn', 'invite.not_enabled', { rid, agencyId });
      return json({ error: 'הזמנה לאזור האישי אינה פעילה כאן.' }, 403);
    }

    const gate = await requireAgencyRole(req, agencyId, 'user', rid, log);
    if (!gate.ok) return json({ error: gate.error }, gate.status);

    // Under the caller's token: row-level security answers nothing for a lead they may not see.
    const rows = await selectRows('leads', `id=eq.${leadId}&select=id,name,email,status,agency_id`, gate.token);
    const lead = rows[0];
    if (!lead || lead.agency_id !== agencyId) {
      log('warn', 'invite.not_found', { rid, leadId });
      return json({ error: 'הלקוח/ה לא נמצא/ה.' }, 404);
    }
    if (lead.status !== 'client') return json({ error: 'הזמנה נשלחת רק ללקוח/ה.' }, 400);
    const to = typeof lead.email === 'string' ? lead.email.trim().toLowerCase() : '';
    if (!isEmail(to)) return json({ error: 'אין כתובת דוא״ל ללקוח/ה.' }, 400);

    // Closed when the limiter cannot answer: mail to a typed address (_shared/guard.ts).
    const limit = await limitCheck(log, rid, `client-invite:${leadId}`, YEAR, 2);
    if (limit === 'over') {
      log('warn', 'invite.already_sent', { rid, leadId });
      return json({ error: 'כבר נשלחה הזמנה ללקוח/ה הזה/הזו.' }, 409);
    }
    if (limit === 'unavailable') return json({ error: 'ההזמנה לא נשלחה. אפשר לנסות שוב.' }, 503);

    try {
      await sendMail(log, { to, ...inviteMail(lead.name), rid, role: 'client' });
    } catch (e) {
      log('warn', 'mail.failed', { rid, role: 'client', err: String((e as Error)?.message ?? e).slice(0, 200) });
      return json({ error: 'ההזמנה לא נשלחה. אפשר לנסות שוב.' }, 502);
    }

    const warnings: string[] = [];
    try {
      const sheetStatus = await appendSheetRow(SHEET_TAB, SHEET_COLUMNS.length, [
        // Israel time, as create-lead writes it.
        new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }),
        'client_invite',
        'staff',
        ...SHEET_COLUMNS.slice(3, 10).map(() => ''),
        leadId,
        ...SHEET_COLUMNS.slice(11).map(() => ''),
      ]);
      log('info', 'sheet.appended', { rid, tab: SHEET_TAB, status: sheetStatus });
    } catch (e) {
      log('warn', 'sheet.append_failed', { rid, tab: SHEET_TAB, err: String((e as Error)?.message ?? e).slice(0, 200) });
      warnings.push('sheet_append_failed');
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, leadId, by: gate.userId });
    return json({ sent: true, ...(warnings.length ? { warnings } : {}) });
  } catch (e) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return json({ error: 'ההזמנה לא נשלחה. נסו שוב.' }, 500);
  }
}
