/** Hebrew prose, read on screen. Words are short and vowel-less, so a
 *  character count is a steadier measure than a word count. */
export const HEBREW_CHARS_PER_MINUTE = 1100;

export function readingMinutes(body: string | undefined): number {
  return Math.max(1, Math.round((body ?? "").length / HEBREW_CHARS_PER_MINUTE));
}
