/**
 * Who writes the admin's articles and testimonials.
 *
 * `base44` (the default): Base44's `contentAdmin`, which writes Base44's copy
 * and Supabase's. `supabase`: the `content-admin` Edge Function, Supabase only.
 *
 * Do not set `VITE_CONTENT_WRITES=supabase` before Phase 3 has moved
 * support_agent, procedures_agent and blog_recommender off Base44: they read
 * Base44's BlogPost, and would never see an article written only to Supabase.
 * Unset it to switch back.
 */
export type ContentWrites = "base44" | "supabase";

export const CONTENT_WRITES: ContentWrites =
  import.meta.env.VITE_CONTENT_WRITES === "supabase" ? "supabase" : "base44";
