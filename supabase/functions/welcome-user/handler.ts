/**
 * The welcome mail, once, when someone has just opened an account on the site
 * — with Google or with an address and password.
 *
 * POST {} with the new account's session; the app calls it after the first
 * sign-in (SupabaseAuthService.me). Everything is decided here:
 *   1. The session, as Supabase Auth reads it (_shared/rest.ts authAccount).
 *   2. New means the address was confirmed in the last WINDOW: a Google
 *      account the moment it is made, an address-and-password one when its
 *      link is clicked. Anyone older gets nothing — the existing accounts
 *      included, the day this shipped.
 *   3. Once: a limiter row per account (`welcome:<id>`), kept for a day, which
 *      outlives WINDOW. If the limiter cannot answer, nothing is sent: a
 *      missing welcome is better than two.
 *
 * The resend, for an account that signed up before this existed: POST
 * { email } with the service key as the bearer. It skips step 2 only — the
 * account must be a confirmed one with a profile (invitee_for), and step 3
 * still holds. Nothing in the app calls it; the operator runs it by hand.
 *
 * Logged by ids alone: the address and the name stay out.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { greetingName, isEmail, sha256Hex } from '../_shared/guard.ts';
import { buildClientHtml } from '../_shared/html.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { sendMail } from '../_shared/mail.ts';
import { authAccount, authAdminUser, callRpc } from '../_shared/rest.ts';

const FN = 'welcome-user';
const log = createLog(FN);

/** How long after the address is confirmed the account still counts as new. */
export const WINDOW_MS = 30 * 60 * 1000;
/** The limiter keeps a row for a day (allow_submission prunes older ones); WINDOW is well inside it. */
const ONCE_SECONDS = 24 * 3600;
export const ACCOUNT_URL = 'https://govari-fin.co.il/account';

/** The welcome: the first name at most, what the personal area is for, and the link. */
export function welcomeMail(name: unknown): { subject: string; html: string; text: string } {
  const first = greetingName(name);
  const intro =
    'החשבון שלך באתר נפתח. באזור האישי אפשר לראות את הפניות שלך אלינו ולעקוב אחריהן, ולקבוע פגישה. ההתחברות היא עם כתובת הדוא״ל הזו.';
  return {
    subject: 'ברוכים הבאים — דורית גוב ארי',
    html: buildClientHtml({
      firstName: first,
      eyebrow: 'אזור אישי',
      heading: 'ברוכים הבאים',
      intro,
      panelTitle: 'כניסה',
      details: [['אזור אישי', 'לאזור האישי', ACCOUNT_URL]],
      action: { label: 'לאזור האישי', href: ACCOUNT_URL },
    }),
    text: [first ? `שלום ${first},` : 'שלום,', '', intro, ACCOUNT_URL].join('\n'),
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

    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();

    if (token && (await isServiceKey(token))) {
      const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
      const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!isEmail(email)) return json({ error: 'כתובת לא תקינה.' }, 400);
      const id = await callRpc('invitee_for', { p_email: email });
      const account = typeof id === 'string' && id ? await authAdminUser(id) : null;
      if (!account) return json({ sent: false, reason: 'not_found' }, 404);
      log('info', 'resend.requested', { rid, userId: account.id });
      return await deliver(account, rid, startedAt, json);
    }

    const account = token ? await authAccount(token) : null;
    if (!account) return json({ error: 'נדרשת התחברות.' }, 401);

    const confirmed = Date.parse(account.confirmedAt);
    if (!Number.isFinite(confirmed) || Date.now() - confirmed > WINDOW_MS || confirmed > Date.now() + 60_000) {
      return json({ sent: false, reason: 'not_new' });
    }
    return await deliver(account, rid, startedAt, json);
  } catch (e) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return json({ error: 'הפעולה נכשלה.' }, 500);
  }
}

/** Steps 3 and on: an address, once per account, then the mail. */
async function deliver(
  account: { id: string; email: string; name: string },
  rid: string,
  startedAt: number,
  json: (body: Record<string, unknown>, status?: number) => Response,
): Promise<Response> {
  const to = account.email.trim().toLowerCase();
  if (!isEmail(to)) return json({ sent: false, reason: 'no_email' });

  let first: unknown;
  try {
    first = await callRpc('allow_submission', { p_key: `welcome:${account.id}`, p_window_seconds: ONCE_SECONDS, p_max: 1 });
  } catch (e) {
    log('warn', 'limit.unavailable', { rid, userId: account.id, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return json({ sent: false, reason: 'unavailable' }, 503);
  }
  if (first !== true) return json({ sent: false, reason: 'already_sent' });

  try {
    await sendMail(log, { to, ...welcomeMail(account.name), rid, role: 'client' });
  } catch (e) {
    log('warn', 'mail.failed', { rid, role: 'client', userId: account.id, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return json({ sent: false, reason: 'mail_failed' }, 502);
  }

  log('info', 'request.end', { rid, ms: Date.now() - startedAt, userId: account.id, sent: true });
  return json({ sent: true });
}

/** The service key, legacy or new, compared without leaking its length or prefix through timing. */
async function isServiceKey(token: string): Promise<boolean> {
  const keys: string[] = [];
  const legacy = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (legacy) keys.push(legacy);
  try {
    const secret = (JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}') as Record<string, unknown>).default;
    if (typeof secret === 'string' && secret.trim()) keys.push(secret.trim());
  } catch {
    // Unparseable: only the legacy key counts.
  }
  const given = await sha256Hex(token);
  let match = false;
  for (const key of keys) {
    const expected = await sha256Hex(key);
    let diff = given.length ^ expected.length;
    for (let i = 0; i < given.length && i < expected.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
    match = match || diff === 0;
  }
  return match;
}
