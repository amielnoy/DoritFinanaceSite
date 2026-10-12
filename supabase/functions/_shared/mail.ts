import type { Log } from './log.ts';

// Include a safe delivery reason in the operations notification.
export function deliveryWarning(label: string, error: unknown): string {
  const reason = String((error as Error)?.message ?? error ?? '').slice(0, 300);
  return reason ? `${label} (${reason})` : label;
}

/**
 * What the mailer said, in a closed vocabulary — `http_<status>`,
 * `no_message_id`, `network_error` — and nothing else: no free text from the
 * provider and no credentials reach a warning or a log.
 */
export function upstreamReasons(result: unknown): string {
  const failed = (result as { failed?: unknown } | null)?.failed;
  const reasons = Array.isArray(failed) ? failed : [];
  const safe = [...new Set(reasons.filter(
    (r) => typeof r === 'string' && /^(http_\d{3}|no_message_id|network_error)$/.test(r)
  ))];
  return safe.length ? `:${safe.join(',')}` : '';
}

export interface Mail {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  body?: string;
  rid: string;
  role: string;
}

/**
 * The one way these functions send mail: a finished message posted to
 * `dorit-mailer`, which holds the Resend key. The same code as
 * base44/functions/submitClaim's sendMail, with `log` passed in.
 */
export async function sendMail(log: Log, { to, subject, html, text, body, rid, role }: Mail): Promise<void> {
  // התפקיד ולא הכתובת. אחד הנמענים הוא המבקר עצמו, וכתובתו לא תיכתב ליומן
  // שנשמר לאורך זמן — `role` מספיק כדי לדעת איזה עותק לא יצא.
  const started = Date.now();

  const endpoint = Deno.env.get('MAILER_URL')?.trim();
  const token = Deno.env.get('MAILER_TOKEN')?.trim();
  if (!endpoint || !token) throw new Error('mailer_not_configured');

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'rendered',
        to,
        subject,
        html,
        text: text ?? body,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error('mailer_network_error');
  }
  // Never surface provider response bodies or credentials in public warnings —
  // only the closed vocabulary `upstreamReasons` allows through. The body is
  // read before the status is judged, because on a refusal it is the only place
  // the cause exists.
  const result = await response.json().catch(() => null);
  const why = upstreamReasons(result);
  if (!response.ok) throw new Error(`mailer_http_${response.status}${why}`);
  if (!result?.ok) throw new Error(`mailer_rejected${why}`);
  // A 200 can still carry refusals: one recipient was accepted and another was
  // not. Reporting that as a clean send is how a copy goes missing with every
  // indicator green.
  if (why) log('warn', 'mail.partial', { rid, role, transport: 'mailer', why: why.slice(1) });
  log('info', 'mail.sent', { rid, role, transport: 'mailer', ms: Date.now() - started });
}
