/**
 * Assigning a lead on /admin/leads: an agency's Admin or Owner (or the
 * platform operator) gives a lead to a member, or back to the queue
 * (docs/superpowers/specs/2026-10-15-agency-roles-design.md).
 *
 * POST { leadId, userId } — `userId` null unassigns — with the caller's session.
 *   1. The session, then at least Admin in the lead's own agency.
 *   2. The write, under the caller's own session: row-level security and the
 *      leads trigger decide it (only Admin+ assign; the assignee must be a
 *      member of the lead's agency; assigned_at / assigned_by are the trigger's).
 *   3. The assignee is told through dorit-mailer that a lead is theirs —
 *      with no personal detail of the client, only a link to the leads screen.
 *      A mail that does not go is reported (`mailed: false`), never a reason
 *      to undo the assignment.
 *
 * Logged by ids alone.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { buildClientHtml } from '../_shared/html.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { deliveryWarning, sendMail } from '../_shared/mail.ts';
import { ADMIN_LEADS_URL } from '../_shared/ops-notice.ts';
import { refusalReason, selectRows, updateRows } from '../_shared/rest.ts';
import { allowRole, sessionCaller } from '../_shared/staff.ts';
import { isEmail } from '../_shared/guard.ts';

const FN = 'assign-lead';
const log = createLog(FN);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The assignee's mail: that a lead is theirs, and where — nothing about the client. */
export function assignmentMail(leadId: string): { subject: string; html: string; text: string } {
  const href = `${ADMIN_LEADS_URL}?lead=${leadId}`;
  return {
    subject: 'שויכה אלייך פנייה חדשה',
    html: buildClientHtml({
      firstName: '',
      eyebrow: 'שיוך פנייה',
      heading: 'שויכה אלייך פנייה חדשה',
      intro: 'פנייה חדשה שויכה אלייך במסך הפניות. הפרטים שם, אחרי התחברות.',
      panelTitle: 'הפנייה',
      details: [['מסך הפניות', 'לפתיחת הפנייה', href]],
      action: { label: 'לפנייה', href },
    }),
    text: ['שלום,', '', 'פנייה חדשה שויכה אלייך במסך הפניות. הפרטים שם, אחרי התחברות:', href].join('\n'),
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

    const session = await sessionCaller(req, rid, log);
    if (!session.ok) return json({ error: session.error }, session.status);

    const body = (await req.json().catch(() => null)) as { leadId?: unknown; userId?: unknown } | null;
    const leadId = typeof body?.leadId === 'string' ? body.leadId.toLowerCase() : '';
    const userId = body?.userId === null ? null : typeof body?.userId === 'string' ? body.userId.toLowerCase() : '';
    if (!UUID.test(leadId)) return json({ error: 'הפנייה אינה מוכרת.' }, 400);
    if (userId !== null && !UUID.test(userId)) return json({ error: 'החבר/ה אינו/ה מוכר/ת.' }, 400);

    // The lead's own agency decides whose Admin may assign it.
    const leads = await selectRows('leads', `id=eq.${leadId}&select=id,agency_id`);
    const agencyId = typeof leads[0]?.agency_id === 'string' ? leads[0].agency_id : null;
    if (!agencyId) return json({ error: 'הפנייה לא נמצאה.' }, 404);
    const gate = await allowRole(session, agencyId, 'admin', rid, log);
    if (!gate.ok) return json({ error: gate.error }, gate.status);

    let rows: Record<string, unknown>[];
    try {
      rows = await updateRows('leads', `id=eq.${leadId}&select=id`, { assigned_user_id: userId }, session.token);
    } catch (e) {
      const why = refusalReason(e);
      if (why === 'assignee_not_member') {
        log('warn', 'assign.refused', { rid, leadId, userId, reason: why });
        return json({ error: 'אפשר לשייך רק לחבר/ה בארגון של הפנייה.' }, 400);
      }
      if (why === 'forbidden') {
        log('warn', 'assign.refused', { rid, leadId, userId, reason: why });
        return json({ error: 'אין לך הרשאה לשייך פניות.' }, 403);
      }
      throw e;
    }
    if (rows.length !== 1) {
      log('warn', 'assign.not_applied', { rid, leadId });
      return json({ error: 'הפנייה לא נמצאה.' }, 404);
    }
    log('info', 'assign.applied', { rid, leadId, userId, by: session.userId });

    // Nobody to tell when it goes back to the queue, or to oneself.
    let mailed = false;
    const warnings: string[] = [];
    if (userId && userId !== session.userId.toLowerCase()) {
      try {
        const profiles = await selectRows('profiles', `id=eq.${userId}&select=email`);
        const to = typeof profiles[0]?.email === 'string' ? profiles[0].email.trim().toLowerCase() : '';
        if (!isEmail(to)) {
          log('warn', 'mail.skipped', { rid, role: 'assignee', reason: 'no_address' });
          warnings.push('assignee_no_address');
        } else {
          await sendMail(log, { to, ...assignmentMail(leadId), rid, role: 'assignee' });
          mailed = true;
        }
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'assignee', err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push(deliveryWarning('assignee_mail_failed', e));
      }
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, leadId, mailed });
    return json({ ok: true, mailed, warnings });
  } catch (e) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return json({ error: 'הפעולה נכשלה.' }, 500);
  }
}
