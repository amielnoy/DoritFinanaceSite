/**
 * VITE_LEAD_BRIEFING: "תדריך לפני שיחה", the AI's draft for the agent in a
 * lead's drawer (feature 4). Off by default: with it off the drawer has no
 * briefing tab and nothing calls the lead-briefing function.
 *
 * Turn it on only after the privacy policy covers it (PrivacyPolicy shows its
 * line with the flag) and the compliance adviser has signed off on
 * docs/COMPLIANCE.md §12. The function has its own switch on the server:
 * LEAD_BRIEFING_MONTHLY_BUDGET_USD, 0 by default.
 */
export const isLeadBriefingOn = (value: string | undefined): boolean => (value ?? "").trim() === "true";

export const LEAD_BRIEFING: boolean = isLeadBriefingOn(import.meta.env.VITE_LEAD_BRIEFING);
