/**
 * The leads screen's tunable numbers.
 *
 * LEAD_SLA_URGENT_HOURS: how long a lead the interview marked urgent ("דחוף —
 * אשמח לשיחה השבוע") may stay "חדשה" before the screen raises an alert.
 * VITE_LEAD_SLA_URGENT_HOURS overrides it per deployment; anything that is not
 * a positive number falls back to 4.
 */
export function slaHours(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

export const LEAD_SLA_URGENT_HOURS: number = slaHours(import.meta.env.VITE_LEAD_SLA_URGENT_HOURS);
