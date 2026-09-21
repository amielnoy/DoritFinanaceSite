/**
 * Which store is authoritative right now.
 *
 * The whole cutover turns on this one value. Writes go to the primary first and
 * a failure there fails the request; the shadow is written afterwards and a
 * failure is recorded, not raised. Reads only ever come from the primary.
 *
 * Flipping it swaps the two roles, which is phase 4 — and flipping it back is
 * the rollback. Nothing else needs a code change for either direction.
 *
 * One thing genuinely changes at the flip, and it is not the mechanism: the
 * meaning of a Supabase write failing. While Base44 is primary a failed
 * Supabase write is harmless — reconciliation catches it. Once Supabase is
 * primary the same failure is an enquiry nobody can see, and it has to fail
 * loudly so the visitor is told to try again.
 */
export type DataPrimary = "base44" | "supabase";

export const DATA_PRIMARY: DataPrimary =
  import.meta.env.VITE_DATA_PRIMARY === "supabase" ? "supabase" : "base44";
