/**
 * Who answers "who is signed in".
 *
 * Opt-in while the Supabase path is being proven, and Base44 stays the default
 * — a broken auth provider locks every admin out of the site, which is not a
 * failure worth discovering from a default. Set `VITE_AUTH_PROVIDER=supabase`
 * to switch, and unset it to switch back.
 *
 * This is deliberately separate from `DATA_PRIMARY`: identity and data move on
 * their own schedules, and the whole reason auth went first is that the browser
 * needs a Supabase session before it can write anything RLS protects.
 */
export type AuthProvider = "base44" | "supabase";

export const AUTH_PROVIDER: AuthProvider =
  import.meta.env.VITE_AUTH_PROVIDER === "supabase" ? "supabase" : "base44";
