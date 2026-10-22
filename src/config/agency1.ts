/**
 * What the public site shows for Dorit, agency 1, that is not a translated
 * string: her ids, her portrait, her review links and the shape of her
 * success cases. The bundled fallback for VITE_AGENCY_CONTENT, and the values
 * supabase/migrations/20261107000000_seed_agency1_content.sql seeds — a
 * contract test (tests/contract/agency-content-seed.contract.test.ts) holds
 * the two together.
 */

/** Dorit's agency — the fixed id of supabase/migrations/20261010000000_tenant_schema.sql. */
export const AGENCY1_ID = "00000000-0000-0000-0000-000000000001";

/** Her agents row, seeded by 20261107000000_seed_agency1_content.sql. */
export const AGENCY1_AGENT_ID = "00000000-0000-0000-0000-0000000000a1";

/** The bundled portrait: `<base>-{480,768,1080}.{avif,webp}` in public/images. */
export const AGENCY1_PORTRAIT_BASE = "/images/dorit-office-portrait";

// TODO: השתמש/י בקישורים האמיתיים של הפרופיל העסקי ב-Google וב-Midrag.
export const AGENCY1_REVIEW_LINKS = {
  google: "https://www.google.com/search?q=דורית+גוב+ארי+ביטוח+חוות+דעת",
  midrag: "https://www.midrag.co.il/",
} as const;

/**
 * Each case's keys in home.json (`proof.<key>.tag/title/body/metric`).
 * `estimate` puts `proof.basis` under the figure, where the figure is a
 * projection rather than a fact.
 */
export const AGENCY1_CASES = [
  { key: "c1", estimate: false },
  { key: "c2", estimate: true },
  { key: "c3", estimate: false },
  { key: "c4", estimate: false },
  { key: "c5", estimate: false },
  { key: "c6", estimate: true },
  { key: "c7", estimate: false },
] as const satisfies readonly { key: string; estimate: boolean }[];
