/**
 * Which organization a user belongs to, shown as a colour and a letter
 * (OrgBadge on an avatar, OrgChip as a label). Every organization is defined
 * here and nowhere else; the components only read it.
 *
 * Built ahead of need (user, 2026-10-15): the site has one agency today
 * (supabase/migrations/20261010000000_tenant_schema.sql), so nothing renders
 * these yet. The four below are SAMPLES — replace them with the real
 * agencies when a second one joins.
 *
 * The letter is never optional: the colour alone must not be what tells two
 * organizations apart. tests/unit/organizations.test.ts holds every colour to
 * 4.5:1 — the white letter on `color`, and `ink` text on `tint`.
 */

export interface Organization {
  id: string;
  name: string;
  /** One letter, shown on the badge in white. */
  letter: string;
  /** The badge's fill. */
  color: string;
  /** The chip's background. */
  tint: string;
  /** The chip's text. */
  ink: string;
}

export const ORGANIZATIONS: readonly Organization[] = [
  { id: "alpha", name: "סוכנות אלפא", letter: "א", color: "#1F4E8C", tint: "#E3ECF7", ink: "#1F4E8C" },
  { id: "beta", name: "משרד בטא", letter: "ב", color: "#B4400B", tint: "#FCEBDD", ink: "#8A2F06" },
  { id: "gamma", name: "גמא פיננסים", letter: "ג", color: "#0F6B63", tint: "#DDF2EF", ink: "#0B524C" },
  { id: "delta", name: "דלתא ביטוח", letter: "ד", color: "#5B21B6", tint: "#EDE5FB", ink: "#4C1D95" },
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

/**
 * The organization for an id: its own definition if it has one, otherwise
 * `name` with a colour from the palette and the first letter of the name.
 */
export function orgFor(id: string, name?: string): Organization {
  const known = ORGANIZATIONS.find((o) => o.id === id);
  if (known) return known;
  const label = (name ?? id).trim() || id;
  return {
    id,
    name: label,
    letter: [...label][0]?.toUpperCase() ?? "?",
    ...FALLBACK_PALETTE[hash(id) % FALLBACK_PALETTE.length],
  };
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
