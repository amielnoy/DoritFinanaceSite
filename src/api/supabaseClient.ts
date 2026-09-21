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
          // Identity still belongs to Base44 during the dual-write phases, so
          // this client reads and writes as an anonymous caller and should not
          // try to own a session. It changes when auth moves, not before.
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;
