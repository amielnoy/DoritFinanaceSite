/**
 * הגשתי: the request went in at the clearinghouse, so the code and the ID are
 * no longer needed and are wiped.
 *
 * One conditional write moves the status, stamps the time, sets the
 * clearinghouse's deletion date (business day 7 — a submitted row without it
 * never expires) and nulls both values together; the table's check constraint
 * refuses any other combination, so there is no moment, and no failure, in
 * which a request reads "submitted" while its values survive. A write that
 * fails answers 500, and a write that matches nothing answers a refusal: the
 * staff member is never told the values are gone when they are not.
 *
 * The answer lists only `id`: the ciphertexts and the token hash are never
 * selected back.
 */
import { addBusinessDays } from '../_shared/business-days.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { AGENCY_1, CLEARINGHOUSE_RETENTION_BUSINESS_DAYS, UUID, maslekaEnabled } from '../_shared/masleka.ts';
import { selectRows, updateWhere } from '../_shared/rest.ts';
import { allowRequest, sessionCaller } from '../_shared/staff.ts';

const FN = 'masleka-submitted';
const log = createLog(FN);

// Every `err:` below is truncated inline: tests/contract/logging.contract.test.ts
// reads each log call's text and requires the `.slice(0, N)` to be visible there.

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    if (!maslekaEnabled()) {
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, outcome: 'disabled' });
      return Response.json({ error: 'disabled', rid }, { status: 404, headers: cors });
    }

    const session = await sessionCaller(req, rid, log);
    if (!session.ok) {
      log('warn', 'request.rejected', { rid, reason: session.status === 401 ? 'unauthorized' : 'failed' });
      return Response.json({ error: session.status === 401 ? 'unauthorized' : 'failed', rid }, { status: session.status, headers: cors });
    }

    const input = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const raw = input?.requestId;
    if (typeof raw !== 'string' || !UUID.test(raw)) {
      log('warn', 'request.rejected', { rid, reason: 'invalid' });
      return Response.json({ error: 'invalid', rid }, { status: 400, headers: cors });
    }
    const requestId = raw.toLowerCase();
    // Whoever may work the request: its lead's assignee, or the creator of a
    // lead-less one; Admin+ and the operator always.
    const caller = await allowRequest(session, requestId, rid, log);
    if (!caller.ok) {
      log('warn', 'request.rejected', { rid, reason: caller.status === 403 ? 'forbidden' : 'failed', userId: session.userId });
      return Response.json({ error: caller.status === 403 ? 'forbidden' : 'failed', rid }, { status: caller.status, headers: cors });
    }

    // The id is UUID-checked and lowercased, the agency is a fixed literal, and
    // `select=id` names the only column handed back.
    const now = new Date();
    const submittedAt = now.toISOString();
    const rows = await updateWhere(
      'masleka_requests',
      `id=eq.${requestId}&agency_id=eq.${AGENCY_1}&status=eq.code_received&select=id`,
      {
        status: 'submitted',
        code_ciphertext: null,
        id_ciphertext: null,
        ciphertext_wiped_at: submittedAt,
        submitted_at: submittedAt,
        submitted_by: caller.userId,
        clearinghouse_deletes_at: addBusinessDays(now, CLEARINGHOUSE_RETENTION_BUSINESS_DAYS).toISOString(),
      },
    );

    if (!rows.length) {
      // Nothing matched: say why, and never "done".
      const existing = await selectRows('masleka_requests', `select=id,status&id=eq.${requestId}&agency_id=eq.${AGENCY_1}&limit=1`);
      if (!existing.length) {
        log('warn', 'request.rejected', { rid, reason: 'not_found', requestId });
        return Response.json({ error: 'not_found', rid }, { status: 404, headers: cors });
      }
      if (existing[0].status === 'submitted') {
        log('warn', 'request.rejected', { rid, reason: 'already_submitted', requestId });
        return Response.json({ error: 'already_submitted', rid }, { status: 409, headers: cors });
      }
      log('warn', 'request.rejected', { rid, reason: 'not_available', requestId });
      return Response.json({ error: 'not_available', rid }, { status: 409, headers: cors });
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, requestId, userId: caller.userId });
    return Response.json({ ok: true, rid }, { headers: cors });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((error as Error)?.message ?? error).slice(0, 200) });
    return Response.json({ error: 'failed', rid }, { status: 500, headers: cors });
  }
}
