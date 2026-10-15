/**
 * A staff member's two ways to start a client off: a request made by hand
 * (a lead that came by phone), or a fresh link for one still waiting.
 *
 * Who may: any member of the agency starts a request by hand (it has no lead,
 * so it is theirs, `created_by`); a fresh link is for whoever may work that
 * request (`allowRequest`). Both are asked of the database on every call.
 *
 * The link is returned once, to the staff member, so they can send it by
 * WhatsApp if they like; only its hash is stored, so it cannot be shown again
 * — a lost link is replaced, never recovered. A fresh link also marks the
 * request reminded: the automatic reminder rotates the token, and must not
 * kill a link a person just sent by hand.
 *
 * A fresh link replaces `token_hash` — the old link stops working at once — and
 * EXTENDS `token_expires_at` on purpose: it restarts the full thirty days from
 * now, so it is never shorter than what the request had (an issued link is at
 * most thirty days out), and a person who sends a link by hand is not handed one
 * that dies sooner. The raw token appears only in the answer to the staff
 * member and in the client's mail; it is never logged.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { isEmail } from '../_shared/guard.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { sendMail } from '../_shared/mail.ts';
import { buildClientInvite } from '../_shared/masleka-mail.ts';
import {
  AGENCY_1, UUID, createRequest, maslekaEnabled, maslekaLink, newToken, tokenExpiry, tokenHash,
} from '../_shared/masleka.ts';
import { updateRow, updateWhere } from '../_shared/rest.ts';
import { allowRequest, allowRole, sessionCaller, type Refusal } from '../_shared/staff.ts';

const FN = 'masleka-create';
const log = createLog(FN);

// Every `err:` below is truncated inline: tests/contract/logging.contract.test.ts
// reads each log call's text and requires the `.slice(0, N)` to be visible there.

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const noStore = { ...cors, 'Cache-Control': 'no-store' };

  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    if (!maslekaEnabled()) {
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, outcome: 'disabled' });
      return Response.json({ error: 'disabled', rid }, { status: 404, headers: cors });
    }

    const refused = (r: Refusal) => {
      const reason = r.status === 401 ? 'unauthorized' : r.status === 403 ? 'forbidden' : 'failed';
      log('warn', 'request.rejected', { rid, reason });
      return Response.json({ error: reason, rid }, { status: r.status, headers: cors });
    };
    const session = await sessionCaller(req, rid, log);
    if (!session.ok) return refused(session);

    const input = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    // A fresh link for a request still waiting for its code.
    if (input?.requestId !== undefined) {
      if (typeof input.requestId !== 'string' || !UUID.test(input.requestId)) {
        log('warn', 'request.rejected', { rid, reason: 'invalid' });
        return Response.json({ error: 'invalid', rid }, { status: 400, headers: cors });
      }
      const requestId = input.requestId.toLowerCase();
      const allowed = await allowRequest(session, requestId, rid, log);
      if (!allowed.ok) return refused(allowed);
      const token = newToken();
      // The id is UUID-checked and lowercased, the agency is a fixed literal, and
      // `select=id` names the only column handed back (never a ciphertext or the hash).
      const rows = await updateWhere(
        'masleka_requests',
        `id=eq.${requestId}&agency_id=eq.${AGENCY_1}&status=eq.invited&select=id`,
        { token_hash: await tokenHash(token), token_expires_at: tokenExpiry(), client_reminded_at: new Date().toISOString() },
      );
      if (!rows.length) {
        log('warn', 'request.rejected', { rid, reason: 'not_available', requestId });
        return Response.json({ error: 'not_available', rid }, { status: 409, headers: cors });
      }
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, requestId, relinked: true });
      return Response.json({ ok: true, requestId, link: maslekaLink(token), invited: false, rid }, { headers: noStore });
    }

    // A new request: no lead, so it belongs to whoever starts it.
    const caller = await allowRole(session, AGENCY_1, 'user', rid, log);
    if (!caller.ok) return refused(caller);
    const clientName = typeof input?.clientName === 'string' ? input.clientName.trim() : '';
    if (!clientName || clientName.length > 80) {
      log('warn', 'request.rejected', { rid, reason: 'invalid_name' });
      return Response.json({ error: 'invalid_name', rid }, { status: 400, headers: cors });
    }
    // Absent or null is "no address"; anything else must be a string that is one.
    const given = input?.contactEmail;
    const rawEmail = typeof given === 'string' ? given.trim() : '';
    if ((given !== undefined && given !== null && typeof given !== 'string') || (rawEmail && !isEmail(rawEmail))) {
      log('warn', 'request.rejected', { rid, reason: 'invalid_email' });
      return Response.json({ error: 'invalid_email', rid }, { status: 400, headers: cors });
    }
    const contactEmail = rawEmail || null;

    const created = await createRequest({ clientName, contactEmail, leadId: null, createdBy: caller.userId });
    let invited = false;
    if (input?.sendInvite === true && contactEmail) {
      try {
        await sendMail(log, { to: contactEmail, ...buildClientInvite(clientName, created.link), rid, role: 'visitor' });
        invited = true;
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'visitor', err: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }
    if (invited) {
      try {
        await updateRow('masleka_requests', created.id, { client_invited_at: new Date().toISOString() });
      } catch (e) {
        log('warn', 'masleka.invite_mark_failed', { rid, requestId: created.id, err: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, requestId: created.id, invited });
    return Response.json({ ok: true, requestId: created.id, link: created.link, invited, rid }, { headers: noStore });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((error as Error)?.message ?? error).slice(0, 200) });
    return Response.json({ error: 'failed', rid }, { status: 500, headers: cors });
  }
}
