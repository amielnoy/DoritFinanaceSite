/**
 * An access token for Dorit's calendar and leads sheet, from a Google service
 * account she shares them with.
 *
 * A service account, because connector OAuth refresh tokens lapse without a
 * sound (docs/base44-exit/00-inventory.md §5). A service account has no
 * refresh token and no consent screen: its key signs a JWT, Google answers
 * with an hour's access token. The key lives only in the function secret
 * GOOGLE_SERVICE_ACCOUNT_JSON. No Google SDK — Web Crypto signs, `fetch`
 * exchanges — so the in-process test harness runs this unchanged.
 */

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/spreadsheets',
] as const;

const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
/** Renew this long before Google's expiry, so a slow request never carries a dead token. */
const RENEW_MARGIN_MS = 5 * 60_000;

let cached: { token: string; expiresAt: number } | null = null;

/** For tests: forget the cached token. */
export function resetGoogleTokenCache(): void {
  cached = null;
}

function serviceAccount(): ServiceAccount | null {
  try {
    const parsed = JSON.parse(Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '') as Partial<ServiceAccount>;
    return typeof parsed?.client_email === 'string' && typeof parsed?.private_key === 'string'
      ? (parsed as ServiceAccount)
      : null;
  } catch {
    return null;
  }
}

/** Whether a token could be asked for — a boolean, never the key. */
export function googleConfigured(): boolean {
  return serviceAccount() !== null;
}

const b64url = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlJson = (value: unknown): string => b64url(new TextEncoder().encode(JSON.stringify(value)));

function signingKey(pem: string): Promise<CryptoKey> {
  const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

/** A bearer token for GOOGLE_SCOPES, cached until five minutes before it expires. */
export async function googleAccessToken(now: number = Date.now()): Promise<string> {
  if (cached && cached.expiresAt - RENEW_MARGIN_MS > now) return cached.token;

  const sa = serviceAccount();
  if (!sa) throw new Error('google_not_configured');
  const aud = sa.token_uri || DEFAULT_TOKEN_URI;
  const iat = Math.floor(now / 1000);
  const unsigned = `${b64urlJson({ alg: 'RS256', typ: 'JWT' })}.${b64urlJson({
    iss: sa.client_email,
    scope: GOOGLE_SCOPES.join(' '),
    aud,
    iat,
    exp: iat + 3600,
  })}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(sa.private_key), new TextEncoder().encode(unsigned)),
  );

  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(signature)}`,
    }).toString(),
    signal: AbortSignal.timeout(10000),
  });
  // The status only: Google's error text can quote the request back.
  if (!res.ok) throw new Error(`google_token_http_${res.status}`);
  const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (typeof body?.access_token !== 'string') throw new Error('google_token_missing');
  const ttl = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  cached = { token: body.access_token, expiresAt: now + ttl * 1000 };
  return cached.token;
}
