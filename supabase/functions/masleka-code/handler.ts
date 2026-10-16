/**
 * The client's half of the clearinghouse request: the link's token, their
 * power-of-attorney code and their ID number.
 *
 * Public, like the forms: the token is what admits a caller, and it admits
 * once — the acceptance is one conditional update on `status = 'invited'`
 * and an unexpired link, so a replay, a double click or a second tab finds
 * nothing to change. The ID is checked against its check digit, both values
 * are sealed with MASLEKA_KEY before they leave this function, and every
 * staff member is told a code is waiting. Neither value is ever logged,
 * mailed or returned.
 *
 * Each value is sealed with its row and field as context (`<id>:code`,
 * `<id>:id`), so the request's id is read first, by the token's hash; the
 * update then repeats every condition the read had and adds that id, so the
 * ciphertexts can only land on the row they were sealed for, and only while
 * it is still waiting for them. A link that died between the two matches
 * nothing and is answered like any other dead link.
 *
 * When it fails (decision 2026-10-14), the answer says what is known. Before
 * the accepting write, or when the database refused that write, nothing was
 * stored: `not_saved`, and the page tells the client plainly to send again.
 * A write cut off on the way (a dropped connection, a timeout) may have
 * landed: `failed`, and the page says the code may have arrived. Either way,
 * and when the sealing key is missing, every staff member gets an alert —
 * the client's name if the link was read, and the rid; never a value. A
 * retry storm is one alert: once an hour per link (in this isolate first,
 * then in `submission_limits`) and five an hour in all.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { clientIp, sha256Hex, withinLimit } from '../_shared/guard.ts';
import { normalizeIsraeliId } from '../_shared/israeli-id.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { sendMail } from '../_shared/mail.ts';
import { buildCodeFailureAlert, buildStaffNotice, type CodeFailure } from '../_shared/masleka-mail.ts';
import { firstInWindow, isToken, maslekaEnabled, normalizeCode, tokenHash, UUID } from '../_shared/masleka.ts';
import { selectRows, updateWhere } from '../_shared/rest.ts';
import { seal, sealKeyFromEnv } from '../_shared/seal.ts';
import { staffRecipients } from '../_shared/staff.ts';

const FN = 'masleka-code';
const log = createLog(FN);
const PER_IP_PER_HOUR = 10;
const PER_LINK_PER_HOUR = 5;
const ALERTS_PER_LINK_PER_HOUR = 1;
const ALERTS_PER_HOUR = 5;
const HOUR_MS = 3_600_000;
/** Links alerted on by this isolate, and when: the throttle's first layer. */
const alerted = new Map<string, number>();

/**
 * A refusal the database answered with a status of its own: the statement
 * ran and was rolled back, so nothing was stored. Anything else thrown by
 * the accepting write (no answer, a gateway timeout, an unreadable body)
 * leaves it unknown whether the row changed.
 */
const refusedByDatabase = (e: unknown): boolean => /^update_http_(4\d\d|500)\b/.test(String((e as Error)?.message ?? ''));

// Every `err:` below is truncated inline: tests/contract/logging.contract.test.ts
// reads each log call's text and requires the `.slice(0, N)` to be visible there.

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const rid = newRequestId();
  const startedAt = Date.now();
  // What a failure can say: the link's hash and the client's name once known,
  // and whether the accepting write was under way when it happened.
  let hash: string | null = null;
  let clientName: string | null = null;
  // The request, once known: its people hear about a failure; before, Dorit's mailbox.
  let knownRequest: string | null = null;
  let storing = false;
  try {
    log('info', 'request.start', { rid });
    if (!maslekaEnabled()) {
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, outcome: 'disabled' });
      return Response.json({ error: 'disabled', rid }, { status: 404, headers: cors });
    }

    const input = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    const ip = clientIp(req);
    if (!(await withinLimit(log, rid, `masleka-ip:${await sha256Hex(ip)}`, 3600, PER_IP_PER_HOUR))) {
      log('warn', 'request.rejected', { rid, reason: 'rate_limited_ip' });
      return Response.json({ error: 'rate_limited', rid }, { status: 429, headers: cors });
    }

    const token = input?.token;
    if (!isToken(token)) {
      log('warn', 'request.rejected', { rid, reason: 'malformed_token' });
      return Response.json({ error: 'link_invalid', rid }, { status: 404, headers: cors });
    }
    hash = await tokenHash(token);
    if (!(await withinLimit(log, rid, `masleka-link:${hash}`, 3600, PER_LINK_PER_HOUR))) {
      log('warn', 'request.rejected', { rid, reason: 'rate_limited_link' });
      return Response.json({ error: 'rate_limited', rid }, { status: 429, headers: cors });
    }

    const idNumber = normalizeIsraeliId(input?.idNumber);
    if (!idNumber) {
      log('warn', 'request.rejected', { rid, reason: 'bad_id' });
      return Response.json({ error: 'bad_id', rid }, { status: 400, headers: cors });
    }
    const code = normalizeCode(input?.code);
    if (!code) {
      log('warn', 'request.rejected', { rid, reason: 'bad_code' });
      return Response.json({ error: 'bad_code', rid }, { status: 400, headers: cors });
    }

    // No key is a refusal, never a reason to store either value in the clear.
    const key = await sealKeyFromEnv();
    if (!key) {
      log('error', 'seal.not_configured', { rid });
      await alertStaff(rid, hash, null, 'unavailable', null);
      return Response.json({ error: 'unavailable', rid }, { status: 503, headers: cors });
    }

    // The query takes the token only as its hash (isToken above), the rest
    // are fixed literals, and `select=` never names a ciphertext or the hash.
    const now = new Date().toISOString();
    const waiting = `token_hash=eq.${hash}&status=eq.invited&token_expires_at=gt.${encodeURIComponent(now)}`;
    const found = await selectRows('masleka_requests', `select=id,client_name&${waiting}&limit=1`);
    const requestId = String(found[0]?.id ?? '');
    if (UUID.test(requestId)) knownRequest = requestId;
    if (!UUID.test(requestId)) {
      // Unknown, used, rotated and expired links all look the same from here,
      // on purpose: the answer says nothing about which.
      log('warn', 'request.rejected', { rid, reason: 'link_invalid' });
      return Response.json({ error: 'link_invalid', rid }, { status: 404, headers: cors });
    }
    clientName = typeof found[0]?.client_name === 'string' ? found[0].client_name : null;

    const sealed = {
      status: 'code_received',
      code_ciphertext: await seal(key, code, `${requestId}:code`),
      id_ciphertext: await seal(key, idNumber, `${requestId}:id`),
      id_last4: idNumber.slice(-4),
      code_received_at: now,
    };
    storing = true;
    const rows = await updateWhere(
      'masleka_requests',
      `id=eq.${requestId}&${waiting}&select=id,client_name`,
      sealed,
    );
    storing = false;
    if (rows.length !== 1 || rows[0].id !== requestId) {
      // Another submission of this link got there between the read and the
      // update (a double click, a second tab): it holds the code, this one
      // changed nothing.
      log('warn', 'request.rejected', { rid, reason: 'link_invalid', raced: true });
      return Response.json({ error: 'link_invalid', rid }, { status: 404, headers: cors });
    }
    log('info', 'masleka.code_received', { rid, requestId });

    // The notice is best-effort: the code is stored, and the board shows it
    // whether or not a mail went out. Nothing after the store may turn the
    // answer into a failure, so this block keeps its own errors.
    let notified = 0;
    try {
      const notice = buildStaffNotice('code_received', [String(rows[0].client_name ?? '')]);
      for (const to of await staffRecipients(log, rid, requestId)) {
        try {
          await sendMail(log, { to, ...notice, rid, role: 'staff' });
          notified += 1;
        } catch (e) {
          log('warn', 'mail.failed', { rid, role: 'staff', err: String((e as Error)?.message ?? e).slice(0, 200) });
        }
      }
    } catch (e) {
      log('warn', 'notice.failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, requestId, notified });
    return Response.json({ ok: true, rid }, { headers: cors });
  } catch (error) {
    // Before the accepting write, or refused by the database: nothing stored.
    // Cut off during it: unknown, so the client is never told to send again.
    const outcome: CodeFailure = storing && !refusedByDatabase(error) ? 'uncertain' : 'not_saved';
    log('error', 'request.failed', {
      rid, ms: Date.now() - startedAt, outcome, err: String((error as Error)?.message ?? error).slice(0, 200),
    });
    await alertStaff(rid, hash, clientName, outcome, knownRequest);
    return Response.json({ error: outcome === 'not_saved' ? 'not_saved' : 'failed', rid }, { status: 500, headers: cors });
  }
}

/**
 * Tell every staff member a client's code did not go through. Best-effort and
 * never throws: the client's answer is the same whether or not it arrives. Below
 * the handler on purpose: masleka-dark-launch.contract.test.ts reads the
 * source in order and wants the switch ahead of every mail.
 */
async function alertStaff(rid: string, hash: string | null, clientName: string | null, failure: CodeFailure, requestId: string | null): Promise<number> {
  try {
    const key = `masleka-alert:${hash ?? 'unknown'}`;
    if (!firstInWindow(alerted, key, Date.now(), HOUR_MS)) {
      log('info', 'alert.skipped', { rid, failure, reason: 'isolate' });
      return 0;
    }
    if (
      !(await withinLimit(log, rid, key, 3600, ALERTS_PER_LINK_PER_HOUR)) ||
      !(await withinLimit(log, rid, 'masleka-alerts', 3600, ALERTS_PER_HOUR))
    ) {
      log('info', 'alert.skipped', { rid, failure, reason: 'rate_limited' });
      return 0;
    }
    const alert = buildCodeFailureAlert({ clientName, failure, rid });
    const sent = await Promise.all(
      (await staffRecipients(log, rid, requestId)).map(async (to) => {
        try {
          await sendMail(log, { to, ...alert, rid, role: 'staff' });
          return 1;
        } catch (e) {
          log('warn', 'mail.failed', { rid, role: 'staff', failure, err: String((e as Error)?.message ?? e).slice(0, 200) });
          return 0;
        }
      }),
    );
    const alertedCount = sent.reduce((a: number, b: number) => a + b, 0);
    log('info', 'alert.sent', { rid, failure, notified: alertedCount });
    return alertedCount;
  } catch (e) {
    log('warn', 'alert.failed', { rid, failure, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return 0;
  }
}
