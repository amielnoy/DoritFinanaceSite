import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The Supabase client, or nothing.
 *
 * Nothing is a real and expected state. The migration runs with Base44 still
 * authoritative, and a build without Supabase configured — a preview, a
 * contributor's checkout, the e2e run — must behave exactly as it did before
 * rather than failing at import time over a store it never reaches.
 *
 * The publishable key belongs in the browser by design: it grants nothing on
 * its own, because every table's row-level security decides what it may see.
 * The service key never appears here, and must never carry a `VITE_` prefix —
 * Vite inlines those into the bundle, which would hand every visitor a
 * credential that bypasses RLS entirely.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          // Auth is moving here, so the session has to survive a reload and
          // refresh itself — a visitor signed out by a page refresh is not a
          // session, and an expired token turns every RLS-protected read into a
          // silent empty result rather than an error anyone can act on.
          persistSession: true,
          autoRefreshToken: true,
          // The OAuth redirect comes back with the session in the URL fragment;
          // without this it is dropped and the sign-in appears to do nothing.
          detectSessionInUrl: true,
        },
      })
    : null;
