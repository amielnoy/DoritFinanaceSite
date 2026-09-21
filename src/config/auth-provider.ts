/**
 * Who answers "who is signed in".
 *
 * Opt-in while the Supabase path is being proven, and Base44 stays the default
 * — a broken auth provider locks every admin out of the site, which is not a
 * failure worth discovering from a default. Set `VITE_AUTH_PROVIDER=supabase`
 * to switch, and unset it to switch back.
 *
 * It also decides where content writes go. With Base44 answering, the browser
 * writes Base44 directly as it always has. With Supabase answering, it cannot —
 * Base44's rules want a Base44 session — so the writes go through the
 * `contentAdmin` function, which holds both credentials and needs no browser
 * identity at all.
 */
export type AuthProvider = "base44" | "supabase";

export const AUTH_PROVIDER: AuthProvider =
  import.meta.env.VITE_AUTH_PROVIDER === "supabase" ? "supabase" : "base44";
