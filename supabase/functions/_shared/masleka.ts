/**
 * The clearinghouse request pipeline's shared rules —
 * docs/superpowers/specs/2026-10-13-clearinghouse-route2-design.md, PR A.
 *
 * A request starts `invited`, with a link that carries a random token. Only
 * the token's SHA-256 is stored, so the link is the only way to the request
 * and the database cannot rebuild it. The client posts their code and ID
 * through the link (`code_received`), a staff member submits them in the
 * clearinghouse portal and presses הגשתי (`submitted`), and PR B's parser
 * completes it (`completed`).
 *
 * Everything here is dark until `MASLEKA_ENABLED` is exactly "true".
 */
import { sha256Hex } from './guard.ts';
import { AGENCY } from './agency.ts';
import { insertRow } from './rest.ts';

export const AGENCY_1 = AGENCY.id;
/** Where a staff notice goes when no staff address can be read. */
export const AGENCY_MAILBOX = AGENCY.email;
/** The agency's own page — never derived from a request's Origin. */
export const MASLEKA_PAGE = 'https://govari-fin.co.il/masleka';
export const MASLEKA_BOARD = 'https://govari-fin.co.il/admin/masleka';

export const TOKEN_TTL_DAYS = 30;
export const CLIENT_REMINDER_DAYS = 7;
export const READY_AFTER_HOURS = 4;
export const DEADLINE_REMINDER_BUSINESS_DAY = 5;
export const CLEARINGHOUSE_RETENTION_BUSINESS_DAYS = 7;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DAY_MS = 86_400_000;

/** Off unless the secret says exactly "true": a typo leaves it dark, never half on. */
export function maslekaEnabled(): boolean {
  return (Deno.env.get('MASLEKA_ENABLED') || '').trim() === 'true';
}

/** 32 random bytes, base64url — 43 characters, unguessable. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function tokenHash(token: string): Promise<string> {
  return sha256Hex(token);
}

/**
 * The link the client opens. The token rides in the fragment, which browsers
 * never send to a server: not to Vercel's request log, not in a Referer, and
 * not in the page_view GA4 sends from index.html before the page can scrub
 * the address bar.
 */
export function maslekaLink(token: string): string {
  return `${MASLEKA_PAGE}#t=${token}`;
}

export function tokenExpiry(from: Date = new Date()): string {
  return new Date(from.getTime() + TOKEN_TTL_DAYS * DAY_MS).toISOString();
}

/**
 * A power-of-attorney code as a person would paste it, or null. The
 * clearinghouse's exact format is not published; letters, digits and hyphens,
 * 4 to 64 of them, admit every plausible one and nothing that could carry
 * markup or a link.
 */
export function normalizeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim();
  return /^[A-Za-z0-9-]{4,64}$/.test(code) ? code : null;
}

export interface NewRequest {
  clientName: string;
  contactEmail: string | null;
  leadId: string | null;
  createdBy: string | null;
}

/** A new `invited` request, and the only link that will ever reach it. */
export async function createRequest(input: NewRequest): Promise<{ id: string; link: string }> {
  const token = newToken();
  const row = await insertRow('masleka_requests', {
    agency_id: AGENCY_1,
    lead_id: input.leadId,
    client_name: input.clientName,
    contact_email: input.contactEmail,
    token_hash: await tokenHash(token),
    token_expires_at: tokenExpiry(),
    created_by: input.createdBy,
  });
  const id = typeof row.id === 'string' ? row.id : '';
  if (!id) throw new Error('request_returned_no_id');
  return { id, link: maslekaLink(token) };
}
