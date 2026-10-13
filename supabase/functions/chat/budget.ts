/**
 * What this month's chat has cost, for the budget cap. Prices are US dollars
 * per million tokens, as the platform design's table gives them (10 Oct 2026).
 * An unknown model is priced at the most expensive known rate.
 */
export const PRICES_PER_MTOK: Record<string, { input: number; cached: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, cached: 0.01, output: 0.5 },
  'claude-sonnet-5-5': { input: 2.0, cached: 0.2, output: 10.0 },
};
const FALLBACK = PRICES_PER_MTOK['claude-sonnet-5-5'];
export const DEFAULT_MONTHLY_BUDGET_USD = 50;

export interface UsageTotals {
  model: string;
  input_tokens: number;
  cached_tokens: number;
  output_tokens: number;
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
};

export function spendUsd(rows: UsageTotals[]): number {
  return rows.reduce((sum, r) => {
    const p = PRICES_PER_MTOK[r.model] ?? FALLBACK;
    return sum + (n(r.input_tokens) * p.input + n(r.cached_tokens) * p.cached + n(r.output_tokens) * p.output) / 1_000_000;
  }, 0);
}

export function monthStartIso(now: number): string {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export function monthKey(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** CHAT_MONTHLY_BUDGET_USD: a non-negative number; 0 refuses every new conversation. */
export function parseBudget(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_MONTHLY_BUDGET_USD;
  const x = Number(raw.trim());
  return Number.isFinite(x) && x >= 0 ? x : DEFAULT_MONTHLY_BUDGET_USD;
}
