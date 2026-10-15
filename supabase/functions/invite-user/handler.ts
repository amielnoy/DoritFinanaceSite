/**
 * "הוספת משתמש" on /admin/users: the admin adds someone to an organization,
 * and they are told by mail how to come in.
 *
 * POST { email, orgId, role } with the admin's session on Authorization.
 *   1. The admin gate (_shared/admin.ts) — a session whose profile is admin.
 *   2. The organization must exist; the role is owner, agent or staff.
 *   3. The account: the current Auth owner with an application profile, or a new
 *      Supabase Auth account made for it (no password, address confirmed).
 *      Sign-in is Google's: when they sign in with that address, Auth links
 *      the Google identity to this account, so the membership is theirs.
 *   4. The membership, upserted: inviting someone already in the organization
 *      changes their role rather than failing.
 *   5. The invitation, through dorit-mailer — not Supabase Auth's own invite
 *      mail, whose default sender delivers only to the project's own team.
 *      A mail that does not go is reported (`mailed: false`), never a reason
 *      to undo the membership the admin asked for.
 *
 * Logged by ids alone: the invitee's address is personal and stays out.
 */
import { requireAdminSession } from '../_shared/admin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { isEmail } from '../_shared/guard.ts';
import { buildClientHtml } from '../_shared/html.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { deliveryWarning, sendMail } from '../_shared/mail.ts';
import { callRpc, createAuthUser, selectRows, upsertRow } from '../_shared/rest.ts';

const FN = 'invite-user';
const log = createLog(FN);

export const ROLES: Record<string, string> = { owner: 'בעלים', agent: 'סוכן/ת', staff: 'צוות' };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Where a new member lands: the clearinghouse board is what an agency member opens. */
export const SIGN_IN_URL = 'https://govari-fin.co.il/login?returnTo=/admin/masleka';

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const rid = newRequestId();
  const startedAt = Date.now();
  const json = (body: Record<string, unknown>, status = 200) => Response.json({ ...body, rid }, { status, headers: cors });

  log('info', 'request.start', { rid });
  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const gate = await requireAdminSession(req, rid, log);
    if (!gate.ok) return json({ error: gate.error }, gate.status);
    const sessionToken = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();

    const body = (await req.json().catch(() => null)) as { email?: unknown; orgId?: unknown; role?: unknown } | null;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const orgId = typeof body?.orgId === 'string' ? body.orgId : '';
    const role = typeof body?.role === 'string' ? body.role : '';
    if (!isEmail(email)) return json({ error: 'כתובת הדוא״ל אינה תקינה.' }, 400);
    if (!(role in ROLES)) return json({ error: 'התפקיד אינו מוכר.' }, 400);
    if (!UUID_PATTERN.test(orgId)) return json({ error: 'הארגון אינו מוכר.' }, 400);

    // Tenant tables deliberately revoke service_role. Use the verified admin's
    // RLS policies, for the organization read AND the membership write.
    const orgs = await selectRows('agencies', `id=eq.${orgId}&select=id,name`, sessionToken);
    if (orgs.length === 0) return json({ error: 'הארגון אינו מוכר.' }, 400);
    const orgName = String(orgs[0].name ?? '');

    // Auth owns the current address. profiles.email is only a historical copy
    // and can still name the old address after an account changes it.
    const existing = await callRpc('invitee_for', { p_email: email });
    if (existing !== null && (typeof existing !== 'string' || !existing)) throw new Error('invitee_unexpected_answer');
    let userId = typeof existing === 'string' ? existing : '';
    let created = false;
    if (!userId) {
      const made = await createAuthUser(email);
      if (!made) {
        // Registered with Auth but no profile to find it by: nothing safe to attach a membership to.
        log('error', 'invite.account_unresolved', { rid });
        return json({ error: 'לכתובת הזו כבר יש חשבון שלא הצלחנו לאתר. פנו לתפעול האתר.' }, 409);
      }
      userId = made.id;
      created = true;
    }

    await upsertRow('memberships', { user_id: userId, agency_id: orgId, role }, 'user_id,agency_id', sessionToken);
    log('info', 'invite.member', { rid, userId, orgId, role, created });

    let mailed = true;
    const warnings: string[] = [];
    try {
      const details: [string, string][] = [
        ['ארגון', orgName],
        ['תפקיד', ROLES[role]],
        ['כניסה', 'עם חשבון Google של הכתובת הזו'],
      ];
      const html = buildClientHtml({
        firstName: '',
        eyebrow: 'הזמנה',
        heading: 'הוזמנת לממשק הניהול של דורית גוב ארי',
        intro: `נוספת ל${orgName ? `ארגון ${orgName}` : 'ארגון'}. הכניסה באתר, עם חשבון Google של הכתובת שאליה נשלח המייל הזה.`,
        panelTitle: 'פרטי ההזמנה',
        details,
        action: { label: 'כניסה לאתר', href: SIGN_IN_URL },
      });
      const text = [
        'שלום,',
        '',
        `נוספת ל${orgName ? `ארגון ${orgName}` : 'ארגון'} בממשק הניהול של דורית גוב ארי, בתפקיד ${ROLES[role]}.`,
        `הכניסה באתר, עם חשבון Google של הכתובת הזו: ${SIGN_IN_URL}`,
      ].join('\n');
      await sendMail(log, { to: email, subject: 'הוזמנת לממשק הניהול — דורית גוב ארי', html, text, rid, role: 'invitee' });
    } catch (e) {
      mailed = false;
      log('warn', 'mail.failed', { rid, role: 'invitee', err: String((e as Error)?.message ?? e).slice(0, 200) });
      warnings.push(deliveryWarning('invite_email_failed', e));
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, created, mailed });
    return json({ ok: true, userId, created, mailed, warnings });
  } catch (e) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return json({ error: 'ההזמנה נכשלה. נסו שוב.' }, 500);
  }
}
