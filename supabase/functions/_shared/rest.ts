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
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !key) throw new Error('supabase_not_configured');

  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
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
