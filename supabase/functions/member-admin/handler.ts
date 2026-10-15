/**
 * The members screen's changes on /admin/users: a member's role, removing a
 * member, leaving an agency, and handing over ownership
 * (docs/superpowers/specs/2026-10-15-agency-roles-design.md).
 *
 * POST { op, agencyId, userId?, role? } with the caller's session.
 *   setRole            { userId, role }  owner | admin | user
 *   remove             { userId }        their leads go back to the queue
 *   leave              {}                the caller leaves the agency
 *   transferOwnership  { userId }        make them Owner, then step down to Admin
 *
 * The session is checked here; what the caller may do is decided by the
 * database. Memberships are written only through set_member_role and
 * remove_member, and both run under the caller's own session, so the rules —
 * an Admin manages Users only, nobody grants above their own role, every
 * agency keeps an Owner — live in one place. Logged by ids alone.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { callRpc, refusalReason } from '../_shared/rest.ts';
import { sessionCaller } from '../_shared/staff.ts';

const FN = 'member-admin';
const log = createLog(FN);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ['owner', 'admin', 'user'];

/** The database's reasons, as a person reads them. Anything else is a failure. */
const REFUSALS: Record<string, [number, string]> = {
  forbidden: [403, 'אין לך הרשאה לפעולה הזו.'],
  last_owner: [409, 'לארגון חייב להישאר בעלים אחד לפחות.'],
  not_found: [404, 'החבר/ה אינו/ה בארגון.'],
  invalid_role: [400, 'התפקיד אינו מוכר.'],
};

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

    const body = (await req.json().catch(() => null)) as { op?: unknown; agencyId?: unknown; userId?: unknown; role?: unknown } | null;
    const op = typeof body?.op === 'string' ? body.op : '';
    const agencyId = typeof body?.agencyId === 'string' ? body.agencyId.toLowerCase() : '';
    const userId = typeof body?.userId === 'string' ? body.userId.toLowerCase() : '';
    const role = typeof body?.role === 'string' ? body.role : '';
    if (!UUID.test(agencyId)) return json({ error: 'הארגון אינו מוכר.' }, 400);
    if (op !== 'leave' && !UUID.test(userId)) return json({ error: 'החבר/ה אינו/ה מוכר/ת.' }, 400);

    const asCaller = (fn: string, args: Record<string, unknown>) => callRpc(fn, args, session.token);
    let warnings: string[] = [];
    try {
      switch (op) {
        case 'setRole':
          if (!ROLES.includes(role)) return json({ error: 'התפקיד אינו מוכר.' }, 400);
          await asCaller('set_member_role', { p_agency_id: agencyId, p_user_id: userId, p_role: role });
          break;
        case 'remove':
          await asCaller('remove_member', { p_agency_id: agencyId, p_user_id: userId });
          break;
        case 'leave':
          await asCaller('remove_member', { p_agency_id: agencyId, p_user_id: session.userId });
          break;
        case 'transferOwnership': {
          if (userId === session.userId.toLowerCase()) return json({ error: 'הבעלות כבר שלך.' }, 400);
          // In this order: the agency is never without an Owner in between.
          await asCaller('set_member_role', { p_agency_id: agencyId, p_user_id: userId, p_role: 'owner' });
          try {
            await asCaller('set_member_role', { p_agency_id: agencyId, p_user_id: session.userId, p_role: 'admin' });
          } catch (e) {
            // The new Owner stands; the caller is still an Owner too. Said, not hidden.
            log('warn', 'member.step_down_failed', { rid, agencyId, err: String((e as Error)?.message ?? e).slice(0, 120) });
            warnings = ['step_down_failed'];
          }
          break;
        }
        default:
          log('warn', 'op.unknown', { rid, op: op.slice(0, 40) });
          return json({ error: 'פעולה לא מוכרת.' }, 400);
      }
    } catch (e) {
      const refusal = REFUSALS[refusalReason(e)];
      if (!refusal) throw e;
      log('warn', 'member.refused', { rid, op, agencyId, userId: userId || session.userId, reason: refusalReason(e) });
      return json({ error: refusal[1] }, refusal[0]);
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, op, agencyId, userId: userId || session.userId, by: session.userId });
    return json({ ok: true, warnings });
  } catch (e) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return json({ error: 'הפעולה נכשלה.' }, 500);
  }
}
