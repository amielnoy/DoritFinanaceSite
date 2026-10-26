// Staff-added clients (docs/superpowers/specs/2026-10-22-staff-client-design.md).

export type Product = 'pension' | 'provident' | 'life' | 'health' | 'savings' | 'planning' | 'claims' | 'other';

/** Same list and labels as src/config/staff-clients.ts and the migration's check. */
export const PRODUCT_LABELS: Record<Product, string> = {
  pension: 'פנסיה',
  provident: 'גמל והשתלמות',
  life: 'ביטוח חיים ומשכנתא',
  health: 'בריאות וסיעוד',
  savings: 'חיסכון והשקעות',
  planning: 'תכנון פיננסי',
  claims: 'ליווי תביעות',
  other: 'אחר',
};
export const PRODUCTS = Object.keys(PRODUCT_LABELS) as Product[];

export const isProduct = (v: unknown): v is Product => typeof v === 'string' && (PRODUCTS as string[]).includes(v);

/** The server's own switch: create-lead refuses kind "client" without it, whatever the browser sends. */
export function staffClientsEnabled(): boolean {
  return (Deno.env.get('STAFF_CLIENTS') || '').trim() === 'true';
}
