/**
 * A client's meetings with Dorit
 * (docs/superpowers/specs/2026-10-17-client-meetings-design.md).
 *
 * Two switches, each off unless the build says exactly "true" (after a trim),
 * like VITE_MASLEKA_ENABLED:
 *
 * - VITE_MEETINGS_STAFF — the lead drawer on /admin/leads, with its "פגישות"
 *   tab (rollout step 2). Off, the leads table is as it was.
 * - VITE_MEETINGS_CLIENT — the "הפגישות שלי" tab in /account (rollout step 4),
 *   on only after the privacy wording is approved.
 */
export const isMeetingsOn = (value: string | undefined): boolean => (value ?? "").trim() === "true";

export const MEETINGS_STAFF: boolean = isMeetingsOn(import.meta.env.VITE_MEETINGS_STAFF);
export const MEETINGS_CLIENT: boolean = isMeetingsOn(import.meta.env.VITE_MEETINGS_CLIENT);
