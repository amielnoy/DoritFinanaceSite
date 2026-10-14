/**
 * The Har HaBituach check's settings (/tools, "בדיקת כפל ביטוחים").
 *
 * Har HaBituach (הר הביטוח) is the Capital Market Authority's site where a
 * person sees the insurance policies held in their name and downloads them as
 * an Excel file.
 */
export const HAR_HABITUACH_URL = "https://harb.cma.gov.il/";

/**
 * Coverages worth asking about when none of the policies has them. A type
 * counts as present when any policy's branch, sub-branch or product type
 * contains one of `match`.
 *
 * TODO(Dorit): confirm the list and its wording. Life and disability cover
 * often sit in the pension fund, which Har HaBituach does not show — the page
 * says so beside the list.
 */
export const EXPECTED_COVERAGE: { label: string; match: string[] }[] = [
  { label: "ניתוחים", match: ["ניתוח"] },
  { label: "תרופות שאינן בסל", match: ["תרופות"] },
  { label: "השתלות וטיפולים מיוחדים בחו\"ל", match: ["השתל"] },
  { label: "מחלות קשות", match: ["מחלות קשות"] },
  { label: "ביטוח חיים", match: ["ביטוח חיים", "ריסק"] },
  { label: "אובדן כושר עבודה", match: ["כושר עבודה"] },
];

/**
 * Sections whose policies are never called duplicates: car and home insurance
 * are per vehicle and per property, so two compulsory-car policies are two
 * cars, not one paid twice.
 */
export const NO_DUPLICATE_SECTIONS = ["תחום - כללי"];
