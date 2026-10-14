/**
 * The clearinghouse request pipeline's switch for the site
 * (docs/superpowers/specs/2026-10-13-clearinghouse-route2-design.md, PR A).
 *
 * Off unless the build says exactly "true" (after a trim). It ships dark:
 * nothing may collect a code or an ID number before Dorit's compliance adviser
 * has reviewed the page, the storage and the wipe rules (README, "The
 * clearinghouse requests"). The Edge Functions have their own switch,
 * `MASLEKA_ENABLED`, with the same rule (`maslekaEnabled` in
 * supabase/functions/_shared/masleka.ts) — a unit test pins the two over the
 * same inputs, and both are turned on together.
 */
export const isMaslekaOn = (value: string | undefined): boolean => (value ?? "").trim() === "true";

export const MASLEKA_ENABLED: boolean = isMaslekaOn(import.meta.env.VITE_MASLEKA_ENABLED);

/**
 * The clearinghouse operator's site, where a saver registers and generates
 * the power-of-attorney code, and where an advisor submits the request. A
 * plain navigation in a new tab — no CSP entry, nothing fetched from it.
 */
export const CLEARINGHOUSE_SAVER_URL = "https://www.swiftness.co.il/";
export const CLEARINGHOUSE_ADVISOR_URL = "https://www.swiftness.co.il/";
