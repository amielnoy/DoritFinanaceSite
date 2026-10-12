/**
 * Which pages may read an Edge Function's answer.
 *
 * supabase-js sends `authorization`, `apikey` and `x-client-info`, so every call
 * from the site is preflighted, and an answer without an allow header is one the
 * browser throws away — the claim would be saved and the visitor told it failed.
 *
 * This is browser hygiene, not access control: the functions are public, like the
 * forms that call them, and a script outside a browser ignores CORS entirely.
 *
 * The Vercel project is `dorit-finance-site` — spelled "finance", unlike the
 * repository — and its preview hosts start with that name.
 */
const EXACT = new Set([
  'https://govari-fin.co.il',
  'https://www.govari-fin.co.il',
  'https://safe-arch-plan.base44.app',
]);
const VERCEL = /^https:\/\/dorit-finance-site(-[a-z0-9-]+)?\.vercel\.app$/;
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  return EXACT.has(origin) || VERCEL.test(origin) || LOCAL.test(origin) ? origin : null;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const allowed = allowedOrigin(origin);
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
}
