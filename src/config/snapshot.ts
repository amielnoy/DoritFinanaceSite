/**
 * The personal financial snapshot (תמונת מצב): the home page's sections that
 * introduce it, and later the two new tools and the personal area.
 *
 * Off unless the build says exactly "true" (after a trim), like
 * VITE_MASLEKA_ENABLED. The home sections promise a personal area and two
 * tools that are built in later phases; production turns this on only once
 * they exist (decision 2026-10-14). Locally and in previews, set
 * VITE_SNAPSHOT_HOME=true to see them.
 */
export const isSnapshotOn = (value: string | undefined): boolean => (value ?? "").trim() === "true";

export const SNAPSHOT_HOME: boolean = isSnapshotOn(import.meta.env.VITE_SNAPSHOT_HOME);

/**
 * How many business days from the code to the snapshot and its
 * recommendations. Shown in "איך זה עובד" step 3.
 *
 * TODO(Dorit): confirm the number. Until then it is null and the step says
 * nothing about timing — no number is shown that she has not promised.
 */
export const SNAPSHOT_REVIEW_BUSINESS_DAYS: number | null = null;

/** Where "להתחיל — מסירת קוד המסלקה" goes: the questionnaire, whose follow-up offers the clearinghouse link. */
export const SNAPSHOT_START_HREF = "#start";
