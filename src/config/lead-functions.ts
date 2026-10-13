/**
 * Who answers the site's lead forms, interviews and hand-offs.
 *
 * Opt-in while the Edge functions are being proven, the same convention as
 * `VITE_UPLOAD_PROVIDER`. Set `VITE_LEAD_FUNCTIONS=supabase` to switch; unset
 * it to switch back to Base44's functions, which stay deployed as the rollback.
 */
export type LeadFunctions = "base44" | "supabase";

export const LEAD_FUNCTIONS: LeadFunctions =
  import.meta.env.VITE_LEAD_FUNCTIONS === "supabase" ? "supabase" : "base44";
