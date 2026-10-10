/**
 * Who stores a claim document.
 *
 * Opt-in while the Supabase path is being proven, same convention as
 * `VITE_AUTH_PROVIDER` — Base44 stays the default. Set
 * `VITE_UPLOAD_PROVIDER=supabase` to switch, and unset it to switch back.
 */
export type UploadProvider = "base44" | "supabase";

export const UPLOAD_PROVIDER: UploadProvider =
  import.meta.env.VITE_UPLOAD_PROVIDER === "supabase" ? "supabase" : "base44";
