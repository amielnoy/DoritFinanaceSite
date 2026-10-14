/**
 * The site's offers and the outside links that carry them (growth brief,
 * 2026-10-14). Wording lives here so a decision — "חינם" once Dorit confirms
 * she absorbs the clearinghouse's ₪14 — is one line.
 */

/** The flagship: a pension-portfolio check through the clearinghouse. No "חינם" until Dorit confirms the cost (user, 2026-10-14). */
export const PENSION_CHECK = {
  name: "בדיקת תיק פנסיוני",
  path: "/pension-check",
  /** After a calculator's result. */
  calculatorHeadline: "רוצים לדעת כמה אתם משלמים בפועל? בדיקת מסלקה אישית",
} as const;

/** The year-end campaign for the self-employed (the article: /blog/sof-shana-atzmaim). */
export const YEAR_END = {
  path: "/atzmaim-31-12",
  article: "/blog/sof-shana-atzmaim",
} as const;

/**
 * An https:// address from the build, or null. Anything else — empty, http,
 * a typo — leaves its button out rather than linking somewhere unintended.
 */
export function httpsUrl(value: string | undefined, host: RegExp): string | null {
  const v = (value ?? "").trim();
  try {
    const url = new URL(v);
    return url.protocol === "https:" && host.test(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Dorit's 15-minute phone call on Cal.com (`VITE_CAL_LINK`, e.g.
 * https://cal.com/dorit/15min, with its two screening questions set there).
 * Unset, #start keeps the questionnaire as its first path.
 */
export const CAL_LINK: string | null = httpsUrl(import.meta.env.VITE_CAL_LINK, /(^|\.)cal\.com$/);

/**
 * Dorit's WhatsApp channel for one reminder a month before tax deadlines
 * (`VITE_WHATSAPP_CHANNEL_URL`, https://whatsapp.com/channel/…). The site only
 * links to it — no list is kept here. Unset, the footer says nothing of it.
 */
export const WHATSAPP_CHANNEL_URL: string | null = httpsUrl(
  import.meta.env.VITE_WHATSAPP_CHANNEL_URL,
  /(^|\.)whatsapp\.com$/,
);
