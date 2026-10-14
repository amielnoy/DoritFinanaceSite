/**
 * One row into a Supabase table through PostgREST, with the service key, and
 * the row as stored — its generated `id` is the lead id the page reports.
 *
 * Plain `fetch`, as the Base44 functions' mirror writes have always been: no
 * client library, so the in-process test harness runs it unchanged.
 *
 * A refusal is reported by status and PostgREST's error code only. Its message
 * and details can quote the row back ("Failing row contains (…)"), which is
 * the visitor's name and phone, and the caller logs whatever this throws.
 */
export async function insertRow(table: string, row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const auth = serviceAuth();
  if (!url || !auth) throw new Error('supabase_not_configured');

  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      ...auth,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const code = ((await res.json().catch(() => null)) as { code?: unknown } | null)?.code;
    const safe = typeof code === 'string' && /^[A-Z0-9]{1,10}$/.test(code) ? `:${code}` : '';
    throw new Error(`insert_http_${res.status}${safe}`);
  }
  const rows = await res.json();
  const inserted = Array.isArray(rows) ? rows[0] : null;
  if (!inserted || typeof inserted !== 'object') throw new Error('insert_returned_nothing');
  return inserted as Record<string, unknown>;
}

/** PostgREST's code from a refusal body, never its message (it can quote the row). */
async function refusal(res: Response): Promise<string> {
  const code = ((await res.json().catch(() => null)) as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9]{1,10}$/.test(code) ? `:${code}` : '';
}

function target(): { url: string; auth: Record<string, string> } {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const auth = serviceAuth();
  if (!url || !auth) throw new Error('supabase_not_configured');
  return { url, auth };
}

/** Rows matching a PostgREST query string (`select=…&col=eq.…&order=…`). */
export async function selectRows(table: string, query: string): Promise<Record<string, unknown>[]> {
  const { url, auth } = target();
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: 'GET',
    headers: { ...auth },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`select_http_${res.status}${await refusal(res)}`);
  const rows = await res.json();
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** One row, by its `id`; `extraFilter` (e.g. `lead_id=is.null`) narrows it further, a PostgREST query fragment. */
export async function updateRow(table: string, id: string, fields: Record<string, unknown>, extraFilter?: string): Promise<void> {
  const { url, auth } = target();
  const res = await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}${extraFilter ? `&${extraFilter}` : ''}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(fields),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`update_http_${res.status}${await refusal(res)}`);
}

/**
 * The rows a PostgREST filter (`id=eq.…&col=…`) matches, changed and handed
 * back: how a caller learns whether a conditional write applied, and to what.
 */
export async function updateRows(table: string, filter: string, fields: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const { url, auth } = target();
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(fields),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`update_http_${res.status}${await refusal(res)}`);
  const rows = await res.json();
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** Insert or merge on a unique key — the booking row is written twice per request. */
export async function upsertRow(table: string, row: Record<string, unknown>, onConflict: string): Promise<void> {
  const { url, auth } = target();
  const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`upsert_http_${res.status}${await refusal(res)}`);
}

/** PostgREST parameters that shape the answer and filter nothing. */
const NOT_FILTERS = ['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'];

/** Whether a query string has at least one `col=op.value` filter term. */
function hasFilter(query: string): boolean {
  for (const [column, value] of new URLSearchParams(query)) {
    if (NOT_FILTERS.includes(column) || !/^[a-z_][a-z0-9_]*$/.test(column)) continue;
    if (/^(?:not\.)?[a-z]+\.\S/.test(value)) return true;
  }
  return false;
}

/**
 * A conditional update: every row the PostgREST query matches, changed, and
 * returned. The query carries the conditions (`status=eq.invited`, …) and a
 * `select=` naming the columns to return — always name them, or the answer
 * echoes every column, ciphertext included.
 *
 * One statement, so the condition and the change cannot be split by a second
 * request: two submissions of one link cannot both find it `invited`.
 *
 * Refuses, before sending anything, a query with no filter term (`col=op.value`
 * — `select=`, `order=` and `limit=` are not filters): PostgREST would apply
 * that PATCH to every row in the table. And a success whose body is not a
 * list of rows is a throw, never "nothing matched".
 */
export async function updateWhere(
  table: string,
  query: string,
  fields: Record<string, unknown>,
): Promise<Record<string, unknown>[]> {
  if (!hasFilter(query)) throw new Error('update_without_filter');
  const { url, auth } = target();
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(fields),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`update_http_${res.status}${await refusal(res)}`);
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) throw new Error('update_bad_body');
  return rows as Record<string, unknown>[];
}

/** Every row a PostgREST filter matches, deleted. Matching none is not an error: the row is already gone. */
export async function deleteRows(table: string, filter: string): Promise<void> {
  const { url, auth } = target();
  const res = await fetch(`${url}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: { ...auth, Prefer: 'return=minimal' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`delete_http_${res.status}${await refusal(res)}`);
}

/**
 * Who a Supabase access token belongs to, as Supabase Auth says — the
 * signature is checked there, not here. `null` for a token Auth refuses
 * (forged, expired, or the anon key, which names no user); a throw for
 * anything else, which must not read as "signed out".
 *
 * A refusal is told apart by its body, not its status alone: Auth's own
 * carries an `error_code` (bad_jwt, session_not_found, …), while the gateway
 * answers a revoked or wrong-project service key with a 401 that has none
 * ("Invalid API key"). Read as "not signed in", that told every admin their
 * session had expired — advice signing in again could never fix.
 */
export async function authUser(token: string): Promise<{ id: string } | null> {
  const { url, auth } = target();
  const res = await fetch(`${url}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey: auth.apikey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  const body = (await res.json().catch(() => null)) as { id?: unknown; error_code?: unknown } | null;
  if (res.status === 401 || res.status === 403) {
    if (typeof body?.error_code === 'string' && body.error_code) return null;
    throw new Error(`auth_http_${res.status}_not_an_auth_refusal`);
  }
  if (!res.ok) throw new Error(`auth_http_${res.status}`);
  const id = body?.id;
  if (typeof id !== 'string' || !id) throw new Error('auth_returned_no_user');
  return { id };
}

/**
 * A Postgres function through PostgREST's `/rpc`, with the service key. Used
 * for `allow_submission`, which only the service role may execute. Throws on
 * a refusal with the status alone, like insertRow.
 */
export async function callRpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const auth = serviceAuth();
  if (!url || !auth) throw new Error('supabase_not_configured');

  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`rpc_http_${res.status}`);
  return res.json();
}

/**
 * A time-limited link to a private storage object, signed with the service
 * key. The path is the object's name inside the bucket, as the upload stored
 * it; the link Supabase returns is relative to `/storage/v1`.
 */
export async function signStorageUrl(bucket: string, path: string, expiresIn: number): Promise<string> {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const auth = serviceAuth();
  if (!url || !auth) throw new Error('supabase_not_configured');

  const objectPath = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${url}/storage/v1/object/sign/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`sign_http_${res.status}`);
  const signed = ((await res.json().catch(() => null)) as { signedURL?: unknown } | null)?.signedURL;
  if (typeof signed !== 'string' || !signed.startsWith('/')) throw new Error('sign_returned_nothing');
  return `${url}/storage/v1${signed}`;
}

/**
 * Deletes objects from a bucket through the Storage API — the only way that
 * removes the file as well as its row. `names` are paths inside the bucket.
 * Answers how many Storage reports deleted; throws on a refusal, by status.
 */
export async function deleteStorageObjects(bucket: string, names: string[]): Promise<number> {
  if (names.length === 0) return 0;
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const auth = serviceAuth();
  if (!url || !auth) throw new Error('supabase_not_configured');

  const res = await fetch(`${url}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: names }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`storage_delete_http_${res.status}`);
  const deleted = await res.json().catch(() => null);
  return Array.isArray(deleted) ? deleted.length : 0;
}

/**
 * The headers that let a function write past row-level security.
 *
 * Supabase injects the project's new secret key as `SUPABASE_SECRET_KEYS`, a
 * JSON object keyed by name, and the legacy `SUPABASE_SERVICE_ROLE_KEY` only
 * while legacy keys are enabled — the site already runs on publishable keys, so
 * turning legacy ones off is the likely next step, and every claim would fail
 * the day it happened. A secret key goes on `apikey` alone: it is not a JWT,
 * and as a bearer token the gateway refuses it. The legacy key is a JWT and
 * travels on both, as it always has.
 */
function serviceAuth(): Record<string, string> | null {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}') as Record<string, unknown>;
    const secret = typeof keys.default === 'string' ? keys.default.trim() : '';
    if (secret) return { apikey: secret };
  } catch {
    // Unparseable: fall through to the legacy key rather than fail on it.
  }
  const legacy = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  return legacy ? { apikey: legacy, Authorization: `Bearer ${legacy}` } : null;
}

/** Whether a row could be written now — present settings, never their values. */
export function supabaseConfigured(): boolean {
  return Boolean((Deno.env.get('SUPABASE_URL') || '').trim() && serviceAuth());
}
