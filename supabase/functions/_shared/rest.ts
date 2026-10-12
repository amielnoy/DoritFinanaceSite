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
