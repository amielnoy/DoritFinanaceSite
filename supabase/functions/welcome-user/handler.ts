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
 * Logged by ids alone: the address and the name stay out.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { greetingName, isEmail } from '../_shared/guard.ts';
import { buildClientHtml } from '../_shared/html.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { sendMail } from '../_shared/mail.ts';
import { authAccount, callRpc } from '../_shared/rest.ts';

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
    const account = token ? await authAccount(token) : null;
    if (!account) return json({ error: 'נדרשת התחברות.' }, 401);

    const confirmed = Date.parse(account.confirmedAt);
    if (!Number.isFinite(confirmed) || Date.now() - confirmed > WINDOW_MS || confirmed > Date.now() + 60_000) {
      return json({ sent: false, reason: 'not_new' });
    }
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
  } catch (e) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return json({ error: 'הפעולה נכשלה.' }, 500);
  }
}
