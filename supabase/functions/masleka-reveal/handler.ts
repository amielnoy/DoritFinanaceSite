/**
 * A staff member's copy button: one value of one waiting request, decrypted.
 *
 * For whoever may work the request, proved on every call (`allowRequest`, the
 * database's `can_work_request`): its lead's assignee, or the creator of a
 * request with no lead, and the agency's Admins and Owners. A removed
 * membership or a reassigned lead is refused at once, whatever the browser
 * still shows. The access is written to
 * `masleka_access_log` before the value is decrypted, and a failed write
 * reveals nothing — the audit cannot be skipped by breaking it. The log row's
 * agency is the request's own, never the column default or anything the
 * caller sent. Each value opens only with its own row and field as the
 * context (`<id>:code`, `<id>:id`), so a ciphertext moved to another row or
 * column fails its tag. The answer is `no-store`, and the value is never
 * logged.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { AGENCY_1, UUID, maslekaEnabled } from '../_shared/masleka.ts';
import { insertRow, selectRows } from '../_shared/rest.ts';
import { sealKeyFromEnv, unseal } from '../_shared/seal.ts';
import { allowRequest, sessionCaller } from '../_shared/staff.ts';

const FN = 'masleka-reveal';
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
    const requestId = input?.requestId;
    const field = input?.field;
    if (typeof requestId !== 'string' || !UUID.test(requestId) || (field !== 'id' && field !== 'code')) {
      log('warn', 'request.rejected', { rid, reason: 'invalid' });
      return Response.json({ error: 'invalid', rid }, { status: 400, headers: cors });
    }

    const caller = await allowRequest(session, requestId, rid, log);
    if (!caller.ok) {
      log('warn', 'request.rejected', { rid, reason: caller.status === 403 ? 'forbidden' : 'failed', userId: session.userId });
      return Response.json({ error: caller.status === 403 ? 'forbidden' : 'failed', rid }, { status: caller.status, headers: cors });
    }

    // No key is a refusal before anything is read.
    const key = await sealKeyFromEnv();
    if (!key) {
      log('error', 'seal.not_configured', { rid });
      return Response.json({ error: 'unavailable', rid }, { status: 503, headers: cors });
    }

    // The id is UUID-checked above and the agency is a fixed literal; `select=`
    // names the columns, never the token hash.
    const rows = await selectRows(
      'masleka_requests',
      `select=id,agency_id,status,code_ciphertext,id_ciphertext&id=eq.${requestId}&agency_id=eq.${AGENCY_1}&limit=1`,
    );
    const row = rows[0];
    if (!row || row.id !== requestId || typeof row.agency_id !== 'string' || !UUID.test(row.agency_id)) {
      log('warn', 'request.rejected', { rid, reason: 'not_found', requestId });
      return Response.json({ error: 'not_found', rid }, { status: 404, headers: cors });
    }
    const sealed = field === 'id' ? row.id_ciphertext : row.code_ciphertext;
    if (row.status !== 'code_received' || typeof sealed !== 'string' || !sealed) {
      // Submitted, expired or not yet answered: the ciphertext is gone or never came.
      log('warn', 'request.rejected', { rid, reason: 'not_available', requestId });
      return Response.json({ error: 'not_available', rid }, { status: 409, headers: cors });
    }

    try {
      await insertRow('masleka_access_log', {
        agency_id: row.agency_id,
        request_id: requestId,
        user_id: caller.userId,
        field,
      });
    } catch (e) {
      log('error', 'access_log.failed', { rid, requestId, err: String((e as Error)?.message ?? e).slice(0, 200) });
      return Response.json({ error: 'failed', rid }, { status: 500, headers: cors });
    }

    let value: string;
    try {
      value = await unseal(key, sealed, `${requestId}:${field}`);
    } catch (e) {
      log('error', 'unseal.failed', { rid, requestId, field, err: String((e as Error)?.message ?? e).slice(0, 200) });
      return Response.json({ error: 'failed', rid }, { status: 500, headers: cors });
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, requestId, field, userId: caller.userId });
    return Response.json({ ok: true, value, rid }, { headers: { ...cors, 'Cache-Control': 'no-store' } });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((error as Error)?.message ?? error).slice(0, 200) });
    return Response.json({ error: 'failed', rid }, { status: 500, headers: cors });
  }
}
