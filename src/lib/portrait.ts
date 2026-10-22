import { AGENCY1_ID } from "@/config/agency1";

/**
 * What an agent's portrait is: Dorit's bundled, pre-sized set, an uploaded
 * photo in the public `agent-photos` bucket, or the agent's initials.
 */
export type Portrait =
  | { kind: "bundled"; alt: string }
  | { kind: "photo"; src: string; srcSet: string | null; alt: string }
  | { kind: "monogram"; initials: string; alt: string };

export const PORTRAIT_WIDTHS = [480, 768, 1080] as const;

/** `photo_path` names the 768 file; the 480 and 1080 files sit beside it. */
const PHOTO_SUFFIX = "-768.webp";

export function agentPhotoBase(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/agent-photos/`;
}

/** The first letter of the first two words, by code point. */
export function initialsOf(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("");
}

export function portraitFor(
  input: { agencyId: string; photoPath: string | null; photoAlt: string | null; fullName: string },
  photoBase: string | null,
): Portrait {
  const alt = input.photoAlt || `${input.fullName} — דיוקן מקצועי`;
  // Her own upload wins; only without one does agency 1 fall back to the
  // bundled set, which exists for her alone.
  if (input.photoPath && photoBase) {
    const src = `${photoBase}${input.photoPath}`;
    const stem = input.photoPath.endsWith(PHOTO_SUFFIX) ? input.photoPath.slice(0, -PHOTO_SUFFIX.length) : null;
    const srcSet =
      stem === null ? null : PORTRAIT_WIDTHS.map((w) => `${photoBase}${stem}-${w}.webp ${w}w`).join(", ");
    return { kind: "photo", src, srcSet, alt };
  }
  if (input.agencyId === AGENCY1_ID) return { kind: "bundled", alt };
  return { kind: "monogram", initials: initialsOf(input.fullName), alt };
}
