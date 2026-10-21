/**
 * Agency content from the database (docs/superpowers/plans/2026-10-21-agency-content-step2.md, R1).
 * Off unless the build says exactly "true" (after a trim), like VITE_STAFF_LEADS.
 * Off, the public pages show the bundled agency-1 constants and ask nothing.
 */
export const isAgencyContentOn = (value: string | undefined): boolean => (value ?? "").trim() === "true";

export const AGENCY_CONTENT: boolean = isAgencyContentOn(import.meta.env.VITE_AGENCY_CONTENT);
