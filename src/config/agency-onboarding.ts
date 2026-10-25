/**
 * VITE_AGENCY_ONBOARDING: the new-agency wizard's screens (Rollout step 4 of
 * docs/superpowers/specs/2026-10-16-new-agency-wizard-design.md). Off by
 * default: with it off no route, menu row, switcher label or redirect of the
 * wizard exists, and nothing an existing admin or a visitor sees changes.
 */
export const isAgencyOnboardingOn = (value: string | undefined): boolean => (value ?? "").trim() === "true";

export const AGENCY_ONBOARDING: boolean = isAgencyOnboardingOn(import.meta.env.VITE_AGENCY_ONBOARDING);
