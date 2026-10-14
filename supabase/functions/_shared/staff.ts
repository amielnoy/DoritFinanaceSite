/**
 * Who is calling a members-only function, and who the staff are.
 *
 * The gateway does not check these callers (`verify_jwt = false`, see
 * config.toml), so every call proves itself here: the bearer token is shown
 * to the auth server, and the role is asked of the database through
 * `staff_role`. Neither the token's claims nor anything the browser says is
 * trusted — a membership removed a minute ago is refused on the next call.
 */
import { isEmail } from './guard.ts';
import type { Log } from './log.ts';
import { AGENCY_MAILBOX } from './masleka.ts';
import { authUser, callRpc } from './rest.ts';

export type StaffRole = 'admin' | 'owner' | 'agent' | 'staff';
const ROLES: readonly string[] = ['admin', 'owner', 'agent', 'staff'];

export type Caller =
  | { kind: 'anonymous' }
  | { kind: 'outsider'; userId: string }
  | { kind: 'staff'; userId: string; role: StaffRole };

export function bearer(req: Request): string | null {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(\S{20,4096})$/i);
  return match ? match[1] : null;
}

export async function staffCaller(req: Request): Promise<Caller> {
  const token = bearer(req);
  if (!token) return { kind: 'anonymous' };
  const user = await authUser(token);
  if (!user) return { kind: 'anonymous' };
  const role = await callRpc('staff_role', { p_user_id: user.id });
  return typeof role === 'string' && ROLES.includes(role)
    ? { kind: 'staff', userId: user.id, role: role as StaffRole }
    : { kind: 'outsider', userId: user.id };
}

/**
 * Every staff member's address: the profile e-mail of each admin and each
 * agency-1 member (`masleka_staff_emails`). The mailer's own list (MAIL_TO)
 * is not reachable — a rendered message must name its recipient — and the
 * memberships are what "staff" means everywhere else. Dorit's mailbox when
 * the list cannot be read, so a notice is late at worst, never lost.
 */
export async function staffRecipients(log: Log, rid: string): Promise<string[]> {
  try {
    const rows = await callRpc('masleka_staff_emails', {});
    const list = Array.isArray(rows)
      ? [...new Set(rows.filter(isEmail).map((e) => e.toLowerCase()))]
      : [];
    if (list.length) return list;
    log('warn', 'staff.none', { rid });
  } catch (e) {
    log('warn', 'staff.lookup_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
  }
  return [AGENCY_MAILBOX];
}
