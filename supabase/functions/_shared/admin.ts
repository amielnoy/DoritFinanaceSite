/**
 * The admin gate for Edge Functions that act for a signed-in admin
 * (content-admin, invite-user). Moved here from content-admin when a second
 * function needed it: shared code lives once, in _shared, and is imported.
 */
import type { Log } from './log.ts';
import { authUser, selectRows } from './rest.ts';

export type Gate = { ok: true; userId: string } | { ok: false; status: number; error: string };

/**
 * A Supabase session whose profile says `admin`. `profiles.role` is the one
 * authority on who is an admin — the same table is_admin() reads for RLS.
 *
 * The token comes on `Authorization`, as supabase-js sends it. Without a
 * session supabase-js sends the anon key there instead; Auth names no user for
 * it, so it is refused like any other bad token.
 */
export async function requireAdminSession(req: Request, rid: string, log: Log): Promise<Gate> {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    log('warn', 'auth.missing_token', { rid });
    return { ok: false, status: 401, error: 'נדרשת התחברות.' };
  }

  let user: { id: string } | null;
  try {
    user = await authUser(token);
  } catch (e) {
    log('error', 'auth.unavailable', { rid, err: String((e as Error)?.message ?? e).slice(0, 120) });
    return { ok: false, status: 500, error: 'לא הצלחנו לאמת את ההרשאה.' };
  }
  if (!user) {
    log('warn', 'auth.rejected', { rid });
    return { ok: false, status: 401, error: 'ההתחברות פגה. יש להתחבר מחדש.' };
  }

  let role: unknown;
  try {
    const rows = await selectRows('profiles', `id=eq.${encodeURIComponent(user.id)}&select=role`);
    role = rows[0]?.role ?? null;
  } catch (e) {
    // A failed read is not "not an admin". They look the same from outside,
    // and confusing them sends whoever diagnoses it the wrong way.
    log('error', 'auth.profile_read_failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 120) });
    return { ok: false, status: 500, error: 'לא הצלחנו לאמת את ההרשאה.' };
  }
  if (role !== 'admin') {
    log('warn', 'auth.not_admin', { rid, userId: user.id });
    return { ok: false, status: 403, error: 'הפעולה מותרת למנהלים בלבד.' };
  }

  log('info', 'auth.ok', { rid, userId: user.id });
  return { ok: true, userId: user.id };
}
