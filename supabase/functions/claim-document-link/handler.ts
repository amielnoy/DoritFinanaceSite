/**
 * A short link to one document of a claim, for whoever may see the claim's
 * lead (docs/superpowers/specs/2026-10-15-agency-roles-design.md).
 *
 * POST { leadId, path } with the caller's session.
 *   1. The session, then `can_see_lead` under it: the lead's assignee, the
 *      agency's Admins and Owners, or the platform operator.
 *   2. The document must be one of that lead's own: its reference
 *      (`storage:claim-documents/<path>`) is in the lead's message, as
 *      submit-claim wrote it — so seeing one lead never opens another's file.
 *   3. Signed with the service key for five minutes; the bucket itself stays
 *      closed to everyone but the operator.
 *
 * The answer is `no-store`; the path and the link are never logged.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { selectRows, signStorageUrl } from '../_shared/rest.ts';
import { allowLead, sessionCaller } from '../_shared/staff.ts';

const FN = 'claim-document-link';
const log = createLog(FN);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BUCKET = 'claim-documents';
export const REF_PREFIX = 'storage:claim-documents/';
export const LINK_SECONDS = 5 * 60;
/** An object name as the upload makes it: path segments of safe characters, no `..`. */
const PATH = /^(?!.*\.\.)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){0,4}$/;

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const rid = newRequestId();
  const startedAt = Date.now();
  const json = (body: Record<string, unknown>, status = 200) =>
    Response.json({ ...body, rid }, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });

  log('info', 'request.start', { rid });
  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const session = await sessionCaller(req, rid, log);
    if (!session.ok) return json({ error: session.error }, session.status);

    const body = (await req.json().catch(() => null)) as { leadId?: unknown; path?: unknown } | null;
    const leadId = typeof body?.leadId === 'string' ? body.leadId.toLowerCase() : '';
    const path = typeof body?.path === 'string' ? body.path : '';
    if (!UUID.test(leadId) || path.length > 300 || !PATH.test(path)) return json({ error: 'המסמך אינו מוכר.' }, 400);

    const allowed = await allowLead(session, leadId, rid, log);
    if (!allowed.ok) return json({ error: allowed.error }, allowed.status);

    const rows = await selectRows('leads', `id=eq.${leadId}&select=message`);
    const message = typeof rows[0]?.message === 'string' ? rows[0].message : '';
    // A whole reference, not a prefix of a longer one.
    const refs: string[] = message.match(/storage:claim-documents\/[^\s|]+/g) ?? [];
    if (!refs.includes(`${REF_PREFIX}${path}`)) {
      log('warn', 'document.not_on_lead', { rid, leadId });
      return json({ error: 'המסמך לא נמצא בפנייה הזו.' }, 404);
    }

    const url = await signStorageUrl(BUCKET, path, LINK_SECONDS);
    log('info', 'request.end', { rid, ms: Date.now() - startedAt, leadId, userId: session.userId });
    return json({ ok: true, url });
  } catch (e) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return json({ error: 'לא ניתן לפתוח את המסמך.' }, 500);
  }
}
