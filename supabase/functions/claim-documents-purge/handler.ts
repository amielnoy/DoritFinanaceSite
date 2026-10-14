/**
 * The nightly deletion of claim documents past retention (two months — the
 * rule lives in `public.claim_documents_expired`, migration
 * 20261023000000_claim_documents_retention.sql), called by pg_cron through
 * pg_net (`public.claim_documents_call_purge`) with the site's cron secret in
 * `x-site-cron` — the same secret masleka-remind checks, from the same Vault
 * entry.
 *
 * Storage objects are deleted through the Storage API, never in SQL: a
 * direct delete from storage.objects is refused, and one that got through
 * would leave the file behind. Batches of BATCH, at most MAX_BATCHES a night,
 * so a backlog drains over a few nights rather than in one long call.
 *
 * Auth: the secret must be configured and at least 32 characters, or every
 * call is refused (503); the header is compared in constant time (401).
 *
 * Nothing personal is logged: counts and error codes only — never a path,
 * which carries the visitor's file name.
 */
import { sha256Hex } from '../_shared/guard.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { callRpc, deleteStorageObjects } from '../_shared/rest.ts';

const FN = 'claim-documents-purge';
const log = createLog(FN);
const MIN_SECRET_LENGTH = 32;
export const BATCH = 500;
export const MAX_BATCHES = 10;

/** Equal secrets in constant time: both hashed first, as masleka-remind does. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)]);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length && i < b.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Every `err:` below is truncated inline: tests/contract/logging.contract.test.ts
// reads each log call's text and requires the `.slice(0, N)` to be visible there.

export async function handler(req: Request): Promise<Response> {
  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    const secret = (Deno.env.get('MASLEKA_CRON_SECRET') || '').trim();
    if (secret.length < MIN_SECRET_LENGTH) {
      log('error', 'cron.not_configured', { rid });
      return Response.json({ error: 'unavailable', rid }, { status: 503 });
    }
    if (!(await sameSecret(req.headers.get('x-site-cron') || '', secret))) {
      log('warn', 'request.rejected', { rid, reason: 'unauthorized' });
      return Response.json({ error: 'unauthorized', rid }, { status: 401 });
    }

    let deleted = 0;
    let batches = 0;
    while (batches < MAX_BATCHES) {
      const due = await callRpc('claim_documents_expired', { p_limit: BATCH });
      const names = (Array.isArray(due) ? due : []).filter((n): n is string => typeof n === 'string' && n.length > 0);
      if (names.length === 0) break;
      batches += 1;
      deleted += await deleteStorageObjects('claim-documents', names);
      // A short batch was the last one; a full one may have more behind it.
      if (names.length < BATCH) break;
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, deleted, batches });
    return Response.json({ ok: true, deleted, batches, rid });
  } catch (e) {
    log('error', 'purge.failed', { rid, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return Response.json({ error: 'failed', rid }, { status: 500 });
  }
}
