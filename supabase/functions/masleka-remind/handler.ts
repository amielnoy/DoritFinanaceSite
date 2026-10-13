/**
 * The hourly chase, called by pg_cron through pg_net
 * (`public.masleka_call_remind`), with a shared secret in `x-masleka-cron`.
 *
 * Auth: the secret must be configured and at least 32 characters, or every
 * call is refused (503); the header is compared in constant time (401).
 *
 * Staff: "יש קבצים להורדה" four hours after הגשתי, and "נמחק במסלקה בעוד
 * יומיים" on business day 5 (`addBusinessDays(submitted_at, 5)`) — one digest
 * per kind per run. A request PR B completes is no longer `submitted` and
 * drops out by itself.
 *
 * Exactly once: each notice is CLAIMED before anything is sent, by one
 * conditional PATCH that sets the marker (`ready_reminded_at`,
 * `deadline_reminded_at`, `client_reminded_at`) only where it is still null,
 * and returns the rows it changed. Two overlapping runs cannot both win a row,
 * so only the winner mails it. If nothing could be sent, the claim is given
 * back, so the next run tries again.
 *
 * Client: one reminder a week after the invitation went out by mail. The
 * stored hash cannot rebuild the old link, so the reminder carries a new one
 * and the old one stops working. The rotation KEEPS the original
 * `token_expires_at`: a reminder neither shortens nor extends the thirty days
 * (a person who wants a longer one issues a fresh link, which does). A request
 * whose link has already expired is not reminded — a dead link is no help.
 * A fresh link sent by hand sets `client_reminded_at` (masleka-create), so a
 * hand-sent link is never rotated here.
 *
 * Nothing personal is logged: counts, request ids and error codes only.
 */
import { addBusinessDays } from '../_shared/business-days.ts';
import { isEmail, sha256Hex } from '../_shared/guard.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { sendMail } from '../_shared/mail.ts';
import { buildClientInvite, buildStaffNotice, type StaffNoticeKind } from '../_shared/masleka-mail.ts';
import {
  AGENCY_1, CLIENT_REMINDER_DAYS, DEADLINE_REMINDER_BUSINESS_DAY, READY_AFTER_HOURS, UUID,
  maslekaEnabled, maslekaLink, newToken, tokenHash,
} from '../_shared/masleka.ts';
import { selectRows, updateWhere } from '../_shared/rest.ts';
import { staffRecipients } from '../_shared/staff.ts';

const FN = 'masleka-remind';
const log = createLog(FN);
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MIN_SECRET_LENGTH = 32;

/**
 * Equal secrets, compared in constant time: both sides are hashed first, so
 * the strings compared are always the same length and neither their length nor
 * the position of the first difference shows in the time taken.
 */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)]);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length && i < b.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const instant = (value: unknown): number => Date.parse(String(value ?? ''));

// Every `err:` below is truncated inline: tests/contract/logging.contract.test.ts
// reads each log call's text and requires the `.slice(0, N)` to be visible there.

export async function handler(req: Request): Promise<Response> {
  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    if (!maslekaEnabled()) {
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, outcome: 'disabled' });
      return Response.json({ error: 'disabled', rid }, { status: 404 });
    }
    const secret = (Deno.env.get('MASLEKA_CRON_SECRET') || '').trim();
    if (secret.length < MIN_SECRET_LENGTH) {
      log('error', 'cron.not_configured', { rid });
      return Response.json({ error: 'unavailable', rid }, { status: 503 });
    }
    if (!(await sameSecret(req.headers.get('x-masleka-cron') || '', secret))) {
      log('warn', 'request.rejected', { rid, reason: 'unauthorized' });
      return Response.json({ error: 'unauthorized', rid }, { status: 401 });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const warnings: string[] = [];

    // ── staff ──────────────────────────────────────────────────────────────
    const submitted = await selectRows(
      'masleka_requests',
      `select=id,submitted_at,ready_reminded_at,deadline_reminded_at&agency_id=eq.${AGENCY_1}&status=eq.submitted`,
    );
    const readyDue = submitted.filter(
      (r) => !r.ready_reminded_at && instant(r.submitted_at) <= now.getTime() - READY_AFTER_HOURS * HOUR_MS,
    );
    const deadlineDue = submitted.filter(
      (r) =>
        !r.deadline_reminded_at &&
        Number.isFinite(instant(r.submitted_at)) &&
        addBusinessDays(new Date(instant(r.submitted_at)), DEADLINE_REMINDER_BUSINESS_DAY).getTime() <= now.getTime(),
    );

    let recipients: string[] | null = null;
    let readySent = 0;
    let deadlineSent = 0;
    const digests: Array<[StaffNoticeKind, Record<string, unknown>[], 'ready_reminded_at' | 'deadline_reminded_at']> = [
      ['ready', readyDue, 'ready_reminded_at'],
      ['deadline', deadlineDue, 'deadline_reminded_at'],
    ];
    for (const [kind, due, column] of digests) {
      const ids = due.map((r) => String(r.id)).filter((id) => UUID.test(id));
      if (!ids.length) continue;
      // Claim first: only the rows this run changed are this run's to announce.
      let claimed: Record<string, unknown>[];
      try {
        claimed = await updateWhere(
          'masleka_requests',
          `id=in.(${ids.join(',')})&agency_id=eq.${AGENCY_1}&status=eq.submitted&${column}=is.null&select=id,client_name`,
          { [column]: nowIso },
        );
      } catch (e) {
        log('warn', 'reminder.claim_failed', { rid, kind, err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push(`${kind}_claim_failed`);
        continue;
      }
      if (!claimed.length) continue;
      recipients ??= await staffRecipients(log, rid);
      const notice = buildStaffNotice(kind, claimed.map((r) => String(r.client_name ?? '')));
      let sent = 0;
      for (const to of recipients) {
        try {
          await sendMail(log, { to, ...notice, rid, role: 'staff' });
          sent += 1;
        } catch (e) {
          log('warn', 'mail.failed', { rid, role: 'staff', kind, err: String((e as Error)?.message ?? e).slice(0, 200) });
        }
      }
      if (sent) {
        if (kind === 'ready') readySent = claimed.length;
        else deadlineSent = claimed.length;
        continue;
      }
      // Nobody was told: give the claim back (only where it is still ours).
      warnings.push(`${kind}_not_sent`);
      try {
        await updateWhere(
          'masleka_requests',
          `id=in.(${claimed.map((r) => String(r.id)).join(',')})&${column}=eq.${nowIso}&select=id`,
          { [column]: null },
        );
      } catch (e) {
        log('warn', 'reminder.reset_failed', { rid, kind, err: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }

    // ── clients ────────────────────────────────────────────────────────────
    const since = new Date(now.getTime() - CLIENT_REMINDER_DAYS * DAY_MS).toISOString();
    const waiting = await selectRows(
      'masleka_requests',
      `select=id,client_name,contact_email&agency_id=eq.${AGENCY_1}&status=eq.invited` +
        `&client_reminded_at=is.null&client_invited_at=lte.${since}&token_expires_at=gt.${nowIso}`,
    );
    let clients = 0;
    for (const row of waiting) {
      const to = typeof row.contact_email === 'string' ? row.contact_email : '';
      const requestId = String(row.id);
      if (!isEmail(to) || !UUID.test(requestId)) continue;
      const token = newToken();
      // Claim and rotate in one statement. token_expires_at is not in the
      // update: the original expiry stands.
      const claimed = await updateWhere(
        'masleka_requests',
        `id=eq.${requestId}&agency_id=eq.${AGENCY_1}&status=eq.invited&client_reminded_at=is.null` +
          `&token_expires_at=gt.${nowIso}&select=id`,
        { token_hash: await tokenHash(token), client_reminded_at: nowIso },
      );
      if (!claimed.length) continue;
      try {
        await sendMail(log, {
          to,
          ...buildClientInvite(String(row.client_name ?? ''), maslekaLink(token), true),
          rid,
          role: 'visitor',
        });
        clients += 1;
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'visitor', requestId, err: String((e as Error)?.message ?? e).slice(0, 200) });
        warnings.push('client_reminder_failed');
        try {
          await updateWhere('masleka_requests', `id=eq.${requestId}&client_reminded_at=eq.${nowIso}&select=id`, {
            client_reminded_at: null,
          });
        } catch (e2) {
          log('warn', 'reminder.reset_failed', { rid, requestId, err: String((e2 as Error)?.message ?? e2).slice(0, 200) });
        }
      }
    }

    log('info', 'request.end', {
      rid, ms: Date.now() - startedAt, ready: readySent, deadline: deadlineSent, clients, warnings: warnings.length,
    });
    return Response.json({ ok: true, rid, ready: readySent, deadline: deadlineSent, clients, warnings });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((error as Error)?.message ?? error).slice(0, 200) });
    return Response.json({ error: 'failed', rid }, { status: 500 });
  }
}
