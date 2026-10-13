/**
 * AES-GCM for the two values the clearinghouse pipeline holds: a client's
 * power-of-attorney code and ID number.
 *
 * The key is an Edge Function secret (`MASLEKA_KEY`, base64 of 32 bytes) and
 * never reaches the database, so a copy of the database — a backup, a leaked
 * service key used to read a table — holds nothing readable. Each value gets
 * its own random 12-byte IV; what is stored is base64(iv | ciphertext+tag), so
 * a changed byte or the wrong key fails the tag instead of decrypting to
 * nonsense.
 *
 * Every value is also bound to a context string (`aad`, e.g. `${requestId}:code`
 * or `${requestId}:id`) as AES-GCM additional data: it is not stored, but a
 * ciphertext copied onto another row or field fails the tag when unsealed with
 * that row's own context.
 *
 * No return types are spelled out on the byte helpers on purpose: newer
 * TypeScript types `Uint8Array` by its buffer, and inference keeps Deno's
 * checker and Web Crypto's `BufferSource` in agreement.
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Whether a usable key is set — present and exactly 32 bytes. Never its value. */
export function sealConfigured(): boolean {
  try {
    return fromBase64((Deno.env.get('MASLEKA_KEY') || '').trim()).length === KEY_BYTES;
  } catch {
    return false;
  }
}

export async function importSealKey(base64: string): Promise<CryptoKey> {
  let raw;
  try {
    raw = fromBase64(base64.trim());
  } catch {
    throw new Error('seal_key_length');
  }
  if (raw.length !== KEY_BYTES) throw new Error('seal_key_length');
  return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** The key from `MASLEKA_KEY`, or null when it is missing or malformed. */
export async function sealKeyFromEnv(): Promise<CryptoKey | null> {
  if (!sealConfigured()) return null;
  return await importSealKey((Deno.env.get('MASLEKA_KEY') || '').trim());
}

export async function seal(key: CryptoKey, plaintext: string, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, key, new TextEncoder().encode(plaintext)),
  );
  const out = new Uint8Array(IV_BYTES + sealed.length);
  out.set(iv, 0);
  out.set(sealed, IV_BYTES);
  return toBase64(out);
}

/**
 * The plaintext, or a throw of one fixed `sealed_invalid` whatever went wrong
 * (not base64, truncated, tampered, another key, another `aad`) — nothing of
 * the input is echoed.
 */
export async function unseal(key: CryptoKey, value: string, aad: string): Promise<string> {
  try {
    const bytes = fromBase64(value);
    if (bytes.length < IV_BYTES + TAG_BYTES) throw new Error('short');
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES), additionalData: new TextEncoder().encode(aad) },
      key,
      bytes.slice(IV_BYTES),
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error('sealed_invalid');
  }
}
