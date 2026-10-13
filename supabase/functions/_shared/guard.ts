/**
 * What a public, no-sign-in entry point checks before it stores anything or
 * mails anyone.
 *
 * These functions send a branded confirmation from Dorit's verified domain to
 * whatever address they are given. Unchecked, that is a free relay: any text
 * in the name or claim fields lands in a stranger's inbox under her name. So:
 * fields have a length ceiling, the confirmation carries only values this code
 * chose or recognised, an address that does not look like one gets no mail,
 * and both the caller and the recipient are rate-limited.
 */
import type { Log } from './log.ts';
import { callRpc, supabaseConfigured } from './rest.ts';

/** Longest value accepted per field. Generous for a person, useless for a payload. */
export const FIELD_LIMITS: Record<string, number> = {
  name: 80,
  phone: 30,
  email: 254,
  claimType: 60,
  eventDate: 20,
  policyNumber: 60,
  description: 4000,
};

/** At most this many attachments, each at most this long. */
export const MAX_DOCUMENTS = 10;
export const MAX_DOCUMENT_LENGTH = 1000;

/**
 * The first field that is not a string within its limit, or null when all are.
 * `limits` defaults to the claim form's; submit-lead passes its own. The
 * documents check belongs to the claim form and runs only with its limits.
 */
export function oversizedField(body: Record<string, unknown>, limits: Record<string, number> = FIELD_LIMITS): string | null {
  for (const [field, max] of Object.entries(limits)) {
    const value = body[field];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || value.length > max) return field;
  }
  if (limits !== FIELD_LIMITS) return null;
  const docs = body.documents;
  if (docs !== undefined && docs !== null) {
    if (!Array.isArray(docs) || docs.length > MAX_DOCUMENTS) return 'documents';
    if (docs.some((d) => typeof d !== 'string' || d.length > MAX_DOCUMENT_LENGTH)) return 'documents';
  }
  return null;
}

/** A plausible single mailbox: no spaces, no list separators, a dotted domain. */
export function isEmail(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 254) return false;
  return /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/.test(value);
}

/**
 * The first name to greet the visitor by, or '' to greet without one.
 *
 * Only a word made of letters (Hebrew, Latin, any script), with an inner
 * apostrophe or hyphen, survives. Anything that could carry a link or a
 * sentence — dots, slashes, digits, a 31st character — drops the name rather
 * than editing it, so the confirmation never repeats text it did not vet.
 */
export function greetingName(name: unknown): string {
  const first = String(name ?? '').trim().split(/\s+/)[0] ?? '';
  return /^\p{L}(?:[\p{L}'’-]{0,28}\p{L})?$/u.test(first) ? first : '';
}

/** A value from a closed list, or the fallback. */
export function knownOr(value: unknown, allowed: readonly string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

/** An ISO calendar date (YYYY-MM-DD), or the fallback. */
export function isoDateOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

/** Lower-case hex SHA-256 — the limiter stores this, never an IP or an address. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The caller's address as Supabase's gateway reports it: the first entry of
 * x-forwarded-for. '' when absent, and an absent address is not limited.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') || '';
  return forwarded.split(',')[0]?.trim().slice(0, 64) || '';
}

/**
 * Whether one more request under `key` fits `max` per `windowSeconds`, and if
 * so, counts it.
 *
 * Fails open: a limiter that is unconfigured or unreachable lets the request
 * through. A lost enquiry is worse than a burst of mail the next request will
 * catch, and the store is the same database the enquiry itself goes to.
 */
export async function withinLimit(
  log: Log,
  rid: string,
  key: string,
  windowSeconds: number,
  max: number,
): Promise<boolean> {
  if (!supabaseConfigured()) return true;
  try {
    const allowed = await callRpc('allow_submission', { p_key: key, p_window_seconds: windowSeconds, p_max: max });
    return allowed !== false;
  } catch (e) {
    log('warn', 'limit.unavailable', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return true;
  }
}
