/**
 * Who is calling a members-only function, what they may do, and who hears
 * about a clearinghouse request
 * (docs/superpowers/specs/2026-10-15-agency-roles-design.md).
 *
 * The gateway does not check these callers (`verify_jwt = false`, see
 * config.toml), so every call proves itself here: the bearer token is shown
 * to the auth server, and the role or the lead is asked of the database on
 * every call. Neither the token's claims nor anything the browser says is
 * trusted — a membership removed or a lead reassigned a minute ago is refused
 * on the next call.
 *
 * Two kinds of "admin", kept apart: the platform operator
 * (`profiles.role = 'admin'`, what is_admin() reads) and an agency's Admin
 * (`memberships.role = 'admin'`).
 */
import { isEmail } from './guard.ts';
import type { Log } from './log.ts';
import { AGENCY_MAILBOX } from './masleka.ts';
import { authUser, callRpc, selectRows } from './rest.ts';

export type AgencyRole = 'owner' | 'admin' | 'user';
const RANK: Record<AgencyRole, number> = { user: 1, admin: 2, owner: 3 };

/** Whether `role` holds at least `min`. owner > admin > user. */
export function meets(role: AgencyRole | null, min: AgencyRole): boolean {
  return role !== null && RANK[role] >= RANK[min];
}

export type Refusal = { ok: false; status: 401 | 403 | 404 | 500; error: string };
/** A verified session: who, their token (to act as them), and whether they run the platform. */
export type Session = { ok: true; userId: string; token: string; isOperator: boolean };
export type RoleGate = (Session & { role: AgencyRole | null }) | Refusal;

const SIGN_IN: Refusal = { ok: false, status: 401, error: 'נדרשת התחברות.' };
const EXPIRED: Refusal = { ok: false, status: 401, error: 'ההתחברות פגה. יש להתחבר מחדש.' };
const UNVERIFIED: Refusal = { ok: false, status: 500, error: 'לא הצלחנו לאמת את ההרשאה.' };
export const FORBIDDEN: Refusal = { ok: false, status: 403, error: 'אין לך הרשאה לפעולה הזו.' };

export function bearer(req: Request): string | null {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(\S{20,4096})$/i);
  return match ? match[1] : null;
}

/**
 * The caller's session, shown to Auth, and whether they are the platform
 * operator — `profiles.role`, the one authority is_admin() also reads. Without
 * a session supabase-js sends the anon key; Auth names no user for it.
 */
export async function sessionCaller(req: Request, rid: string, log: Log): Promise<Session | Refusal> {
  const token = bearer(req);
  if (!token) {
    log('warn', 'auth.missing_token', { rid });
    return SIGN_IN;
  }
  let user: { id: string } | null;
  try {
    user = await authUser(token);
  } catch (e) {
    log('error', 'auth.unavailable', { rid, err: String((e as Error)?.message ?? e).slice(0, 120) });
    return UNVERIFIED;
  }
  if (!user) {
    log('warn', 'auth.rejected', { rid });
    return EXPIRED;
  }
  try {
    const rows = await selectRows('profiles', `id=eq.${encodeURIComponent(user.id)}&select=role`);
    return { ok: true, userId: user.id, token, isOperator: rows[0]?.role === 'admin' };
  } catch (e) {
    // A failed read is not "not the operator". They look the same from
    // outside, and confusing them sends whoever diagnoses it the wrong way.
    log('error', 'auth.profile_read_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 120) });
    return UNVERIFIED;
  }
}

/** The caller's role in an active agency, or null (memberships is revoked from the service role, hence the function). */
export async function agencyRoleOf(userId: string, agencyId: string): Promise<AgencyRole | null> {
  const role = await callRpc('staff_role', { p_user_id: userId, p_agency_id: agencyId });
  return role === 'owner' || role === 'admin' || role === 'user' ? role : null;
}

/**
 * At least `min` in the agency, or the platform operator. `agencyId` null is a
 * shared-library row, which no agency owns: the operator's alone.
 */
export async function allowRole(session: Session, agencyId: string | null, min: AgencyRole, rid: string, log: Log): Promise<RoleGate> {
  let role: AgencyRole | null = null;
  try {
    if (agencyId) role = await agencyRoleOf(session.userId, agencyId);
  } catch (e) {
    log('error', 'auth.role_read_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 120) });
    return UNVERIFIED;
  }
  if (session.isOperator || meets(role, min)) {
    log('info', 'auth.ok', { rid, userId: session.userId, role, operator: session.isOperator });
    return { ...session, role };
  }
  log('warn', 'auth.forbidden', { rid, userId: session.userId, role, min });
  return FORBIDDEN;
}

/** requireAgencyRole(req, agency, min) → the session and its role, or why not. */
export async function requireAgencyRole(req: Request, agencyId: string | null, min: AgencyRole, rid: string, log: Log): Promise<RoleGate> {
  const session = await sessionCaller(req, rid, log);
  if (!session.ok) return session;
  return allowRole(session, agencyId, min, rid, log);
}

/** Asks a yes/no access function as the caller, so the database's own rule decides. */
async function askAsCaller(session: Session, fn: string, args: Record<string, unknown>, rid: string, log: Log): Promise<Session | Refusal> {
  let allowed: unknown;
  try {
    allowed = await callRpc(fn, args, session.token);
  } catch (e) {
    log('error', 'auth.access_check_failed', { rid, fn, err: String((e as Error)?.message ?? e).slice(0, 120) });
    return UNVERIFIED;
  }
  if (allowed === true) {
    log('info', 'auth.ok', { rid, userId: session.userId, fn });
    return session;
  }
  log('warn', 'auth.forbidden', { rid, userId: session.userId, fn });
  return FORBIDDEN;
}

/** The caller may see this lead: Admin+ in its agency, its assignee, or the operator (`can_see_lead`). */
export function allowLead(session: Session, leadId: string, rid: string, log: Log): Promise<Session | Refusal> {
  return askAsCaller(session, 'can_see_lead', { p_lead_id: leadId }, rid, log);
}

/**
 * The caller may work this clearinghouse request: as its lead (allowLead's
 * rule), or — for a request with no lead — as whoever created it; Admin+ and
 * the operator always (`can_work_request`).
 */
export function allowRequest(session: Session, requestId: string, rid: string, log: Log): Promise<Session | Refusal> {
  return askAsCaller(session, 'can_work_request', { p_request_id: requestId }, rid, log);
}

/** requireLeadAccess(req, lead) → the session, if the caller may see that lead. */
export async function requireLeadAccess(req: Request, leadId: string, rid: string, log: Log): Promise<Session | Refusal> {
  const session = await sessionCaller(req, rid, log);
  return session.ok ? allowLead(session, leadId, rid, log) : session;
}

/** requireRequestAccess(req, request) → the session, if the caller may work that request. */
export async function requireRequestAccess(req: Request, requestId: string, rid: string, log: Log): Promise<Session | Refusal> {
  const session = await sessionCaller(req, rid, log);
  return session.ok ? allowRequest(session, requestId, rid, log) : session;
}

/**
 * Who hears about a request: the profile e-mail of its lead's assignee (or,
 * with no lead, its creator) and of the agency's Admins and Owners
 * (`masleka_staff_emails`); with no request, the Admins and Owners alone. Not every member: Users do not see each other's
 * clients. Dorit's mailbox when the list cannot be read, so a notice is late
 * at worst, never lost.
 */
export async function staffRecipients(log: Log, rid: string, requestId: string | null): Promise<string[]> {
  try {
    // An unknown request (a failure before its link was matched) has no
    // handler of its own: the database answers the agency's Admins and Owners.
    const rows = await callRpc('masleka_staff_emails', { p_request_id: requestId });
    const list = Array.isArray(rows)
      ? [...new Set(rows.filter(isEmail).map((e) => e.toLowerCase()))]
      : [];
    if (list.length) return list;
    log('warn', 'staff.none', { rid, requestId });
  } catch (e) {
    log('warn', 'staff.lookup_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
  }
  return [AGENCY_MAILBOX];
}
