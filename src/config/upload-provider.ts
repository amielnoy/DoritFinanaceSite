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

/**
 * Who stores a public content image (article cover, testimonial photo).
 *
 * Separate from `VITE_UPLOAD_PROVIDER` so each switches on — and back — on its
 * own. Set `VITE_CONTENT_IMAGES=supabase` once the content-images bucket
 * exists in production (migration 20261017000000); unset it to switch back.
 * Images already on Base44 keep their Base44 links either way.
 */
export const CONTENT_IMAGES: UploadProvider =
  import.meta.env.VITE_CONTENT_IMAGES === "supabase" ? "supabase" : "base44";
