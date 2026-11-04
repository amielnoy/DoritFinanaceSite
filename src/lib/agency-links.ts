/**
 * An agency's own links: its website, a WhatsApp group and a Facebook group.
 * All three are optional, typed in the wizard's "פרטי קשר" step and shown in
 * the footer when set.
 *
 * The patterns are the CHECKs of
 * supabase/migrations/20261115000000_agency_links.sql, spelled the same, so
 * the wizard refuses what the database would and the site never renders a
 * link the database would not have stored.
 * tests/contract/agency-links.contract.test.ts fails when the two disagree.
 */

/** The `agency_profiles` column of each link, by the name the site uses. */
export const AGENCY_LINK_COLUMNS = {
  website: "website_url",
  whatsappGroup: "whatsapp_group_url",
  facebookGroup: "facebook_group_url",
} as const;

export type AgencyLinkName = keyof typeof AGENCY_LINK_COLUMNS;

/** What the pages show; null when the agency gave none. */
export type AgencyLinks = Record<AgencyLinkName, string | null>;

export const NO_AGENCY_LINKS: AgencyLinks = { website: null, whatsappGroup: null, facebookGroup: null };

export const AGENCY_LINK_MAX_LENGTH = 500;

/** Each column's pattern, as the migration's CHECK writes it (POSIX ARE and JS agree on these). */
export const AGENCY_LINK_PATTERNS: Record<(typeof AGENCY_LINK_COLUMNS)[AgencyLinkName], string> = {
  website_url: "^https://[^\\s/]+\\.[^\\s/]+(/\\S*)?$",
  whatsapp_group_url: "^https://chat\\.whatsapp\\.com/\\S+$",
  facebook_group_url: "^https://(www\\.|m\\.|web\\.)?facebook\\.com/\\S+$",
};

const PROBLEMS: Record<keyof typeof AGENCY_LINK_PATTERNS, string> = {
  website_url: "הקישור צריך להתחיל ב-https:// ולכלול כתובת אתר, למשל https://www.example.co.il",
  whatsapp_group_url: "קישור לקבוצת וואטסאפ מתחיל ב-https://chat.whatsapp.com/",
  facebook_group_url: "קישור לקבוצת פייסבוק מתחיל ב-https://www.facebook.com/",
};

const COMPILED = Object.fromEntries(
  Object.entries(AGENCY_LINK_PATTERNS).map(([column, source]) => [column, new RegExp(source)]),
) as Record<keyof typeof AGENCY_LINK_PATTERNS, RegExp>;

const isLinkColumn = (column: string): column is keyof typeof AGENCY_LINK_PATTERNS => column in COMPILED;

/** Whether `value` may be stored in `column` (one of the three). */
export function isAgencyLink(column: string, value: unknown): value is string {
  return (
    isLinkColumn(column) &&
    typeof value === "string" &&
    value.length <= AGENCY_LINK_MAX_LENGTH &&
    COMPILED[column].test(value)
  );
}

/**
 * Why a typed link cannot be saved, in Hebrew; null when it can, empty
 * included (every link is optional). Null too for a column that is not a link.
 */
export function agencyLinkProblem(column: string, value: unknown): string | null {
  if (!isLinkColumn(column)) return null;
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  if (text.length > AGENCY_LINK_MAX_LENGTH) return "הקישור ארוך מדי.";
  return COMPILED[column].test(text) ? null : PROBLEMS[column];
}

/** A site row's links, each one only if it passes its pattern — never a `javascript:` or a stray host. */
export function toAgencyLinks(row: Record<string, unknown>): AgencyLinks {
  const out = { ...NO_AGENCY_LINKS };
  for (const [name, column] of Object.entries(AGENCY_LINK_COLUMNS) as [AgencyLinkName, string][]) {
    const value = row[column];
    out[name] = isAgencyLink(column, value) ? value : null;
  }
  return out;
}
