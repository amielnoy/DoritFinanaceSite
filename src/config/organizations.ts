/* eslint-disable no-restricted-syntax -- Organization colours are identity
   data, one set per organization (and, once agencies are many, a table's
   rows), not the site's design system — the same reasoning as GoogleIcon's
   brand palette. The components take them from here and use no hex at all.
   tests/unit/organizations.test.ts holds every one to 4.5:1. */
/**
 * Which organization a user belongs to, shown as a colour and a code
 * (OrgBadge on an avatar, OrgChip as a label). Every organization's look is
 * defined here and nowhere else; the components only read it.
 *
 * The organizations themselves are the `agencies` table
 * (supabase/migrations/20261010000000_tenant_schema.sql). An agency listed
 * below by its id gets the colours given here; any other gets a palette colour
 * picked by its id. The four below are SAMPLES — replace them with the real
 * agencies' ids, names and colours.
 *
 * The code is never optional: the colour alone must not be what tells two
 * organizations apart. tests/unit/organizations.test.ts holds every colour to
 * 4.5:1 — the white code on `color`, and `ink` text on `tint`.
 */

export interface Organization {
  id: string;
  name: string;
  /** Up to two characters, shown on the badge in white. Unique among the organizations shown together. */
  code: string;
  /** The badge's fill. */
  color: string;
  /** The chip's background. */
  tint: string;
  /** The chip's text. */
  ink: string;
  /** When set, the badge shows this image instead of the code. */
  logoUrl?: string;
}

/** A configured organization: its code may be left out, and is then derived from the name. */
type OrganizationConfig = Omit<Organization, "code"> & { code?: string };

export const ORGANIZATIONS: readonly OrganizationConfig[] = [
  { id: "alpha", name: "סוכנות אלפא", code: "סא", color: "#1F4E8C", tint: "#E3ECF7", ink: "#1F4E8C" },
  { id: "beta", name: "משרד בטא", code: "מב", color: "#B4400B", tint: "#FCEBDD", ink: "#8A2F06" },
  { id: "gamma", name: "גמא פיננסים", code: "גפ", color: "#0F6B63", tint: "#DDF2EF", ink: "#0B524C" },
  { id: "delta", name: "דלתא ביטוח", code: "דב", color: "#5B21B6", tint: "#EDE5FB", ink: "#4C1D95" },
];

/** For an organization with no colours of its own: picked by its id, so it never changes. */
export const FALLBACK_PALETTE: readonly Pick<Organization, "color" | "tint" | "ink">[] = [
  { color: "#9D174D", tint: "#FCE7F3", ink: "#9D174D" },
  { color: "#155E75", tint: "#E0F2F7", ink: "#155E75" },
  { color: "#3F6212", tint: "#ECF5DC", ink: "#3F6212" },
  { color: "#92400E", tint: "#FDF0DC", ink: "#92400E" },
  { color: "#3730A3", tint: "#E7E8FB", ink: "#3730A3" },
  { color: "#374151", tint: "#ECEDF0", ink: "#374151" },
];

/** FNV-1a: the same id always lands on the same palette entry. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The name's letters and digits, in order — what a code is made of. */
const lettersOf = (name: string): string[] => [...name].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).map((ch) => ch.toUpperCase());

/**
 * A name's code with nothing to collide with: the first letters of its first
 * two words ("סוכנות אלפא" → "סא"), or a one-word name's first two letters.
 */
export function deriveCode(name: string): string {
  const words = name.trim().split(/\s+/).map(lettersOf).filter((w) => w.length > 0);
  if (words.length >= 2) return words[0][0] + words[1][0];
  return (words[0] ?? ["?"]).slice(0, 2).join("");
}

/**
 * The code for `name` that none of `taken` already uses: its derived code; else
 * its first letter with each next distinct letter of the name in turn; else its
 * first letter with a digit.
 */
function uniqueCode(name: string, taken: ReadonlySet<string>): string {
  const base = deriveCode(name);
  if (!taken.has(base)) return base;
  const letters = lettersOf(name);
  const first = letters[0] ?? "?";
  for (const next of new Set(letters.slice(1))) {
    const code = first + next;
    if (!taken.has(code)) return code;
  }
  for (let d = 2; d <= 9; d++) if (!taken.has(`${first}${d}`)) return `${first}${d}`;
  return base;
}

const colourOf = (id: string) => FALLBACK_PALETTE[hash(id) % FALLBACK_PALETTE.length];

/**
 * Every organization to be shown together, with colours and a code each, and no
 * two codes alike. Configured codes are kept as given; the rest are derived in
 * id order, so the same set of organizations always gets the same codes.
 */
export function organizationDirectory(orgs: ReadonlyArray<{ id: string; name: string }>): Map<string, Organization> {
  const byId = new Map<string, OrganizationConfig>();
  for (const { id, name } of [...orgs].sort((a, b) => a.id.localeCompare(b.id))) {
    const known = ORGANIZATIONS.find((o) => o.id === id);
    byId.set(id, known ? { ...known, name: name || known.name } : { id, name: (name ?? id).trim() || id, ...colourOf(id) });
  }
  const taken = new Set<string>([...byId.values()].flatMap((o) => (o.code ? [o.code] : [])));
  const out = new Map<string, Organization>();
  for (const [id, o] of byId) {
    const code = o.code ?? uniqueCode(o.name, taken);
    taken.add(code);
    out.set(id, { ...o, code });
  }
  return out;
}

/** One organization on its own: its configured look, or a palette colour by id and its name's code. */
export function orgFor(id: string, name?: string): Organization {
  return organizationDirectory([{ id, name: name ?? ORGANIZATIONS.find((o) => o.id === id)?.name ?? id }]).get(id)!;
}

/** WCAG contrast ratio between two "#RRGGBB" colours. */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
