import { E2E_SUPABASE_URL } from "../build-env";

/**
 * Deterministic rows for the e2e Supabase fake (e2e/fixtures/app.ts), in the
 * shape PostgREST returns them: Supabase's own `id` (a uuid), `base44_id` for a
 * row that came from Base44 and null for one that did not, `created_at`, the
 * agency the row belongs to, and `rating` as a string — a numeric column, which
 * PostgREST sends as text.
 *
 * The site reads them through src/services/supabase/SupabaseContentService.ts,
 * which turns `created_at` into `created_date` and `base44_id ?? id` into `id`;
 * an article's address is its `slug` (src/lib/articlePath.ts).
 */

/** Dorit's agency — the fixed id of supabase/migrations/20261010000000_tenant_schema.sql. */
export const AGENCY_ID = "00000000-0000-0000-0000-000000000001";

/** A public image in the content-images bucket; the fake's storage route serves it as a PNG. */
export const contentImageUrl = (name: string) =>
  `${E2E_SUPABASE_URL}/storage/v1/object/public/content-images/${AGENCY_ID}/${name}`;

export const TESTIMONIALS = [
  {
    id: "7e570000-0000-4000-8000-000000000001",
    base44_id: "68b0c0ffee0000000000aa01",
    name: "רונית לוי",
    role: "לקוחה מאז 2019",
    quote: "ליווי מקצועי, סבלני ואנושי. הרגשתי בידיים טובות לאורך כל הדרך.",
    image_url: null,
    rating: "5",
    source: "google",
    agency_id: AGENCY_ID,
    created_at: "2026-01-05T10:00:00+00:00",
  },
  {
    id: "7e570000-0000-4000-8000-000000000002",
    base44_id: null,
    name: "אבי כהן",
    role: "עצמאי",
    quote: "דורית איתרה פערים בכיסוי שלא ידעתי עליהם וחסכה לי כסף אמיתי.",
    image_url: null,
    rating: "5",
    source: "midrag",
    agency_id: AGENCY_ID,
    created_at: "2026-02-11T10:00:00+00:00",
  },
];

/** The columns every blog_posts row carries; a spec's own row starts from these. */
const ARTICLE_DEFAULTS = {
  base44_id: null,
  excerpt: null,
  image_url: null,
  tags: null,
  action_time: null,
  cta_headline: null,
  og_image: null,
  published: true,
  agency_id: AGENCY_ID,
};

export const BLOG_POSTS = [
  {
    ...ARTICLE_DEFAULTS,
    id: "b1000000-0000-4000-8000-000000000001",
    slug: "post-1",
    title: "חמש שאלות לשאול לפני שבוחרים קרן פנסיה",
    excerpt: "מדריך קצר לבחירה מושכלת של קרן פנסיה.",
    body: "## מה חשוב לבדוק\n\nדמי ניהול, מסלול השקעה וכיסויים ביטוחיים.\n\n- דמי ניהול מהפקדה\n- דמי ניהול מצבירה\n",
    image_url: contentImageUrl("post-1.png"),
    tags: "פנסיה, חיסכון",
    created_at: "2026-03-01T09:00:00+00:00",
  },
  {
    ...ARTICLE_DEFAULTS,
    id: "b1000000-0000-4000-8000-000000000002",
    // An article from before slugs: its old /blog/<24 hex> link still finds it.
    base44_id: "68b0c0ffee0000000000bb02",
    slug: "post-2",
    title: "אובדן כושר עבודה — קו ההגנה הראשון",
    excerpt: "למה הכיסוי הזה חשוב לא פחות מהחיסכון עצמו.",
    body: "טקסט המאמר.",
    tags: "ביטוח",
    created_at: "2026-03-08T09:00:00+00:00",
  },
];

/** A blog_posts row for a spec's own article, with every column the table has. */
export const blogPostRow = (row: { id: string; slug: string; title: string; body: string } & Record<string, unknown>) => ({
  ...ARTICLE_DEFAULTS,
  created_at: "2026-03-10T09:00:00+00:00",
  ...row,
});

/**
 * A blog post whose body is an XSS attempt. react-markdown must render this as
 * visible text, never as live markup.
 */
export const XSS_POST = blogPostRow({
  id: "b1000000-0000-4000-8000-0000000000ff",
  slug: "xss-post",
  title: "<img src=x onerror=\"window.__xss_title=1\">כותרת",
  excerpt: "",
  body: [
    '<script>window.__xss_body = 1<\/script>',
    '<img src="x" onerror="window.__xss_body = 1">',
    "[קישור](javascript:window.__xss_link=1)",
    '<a href="javascript:window.__xss_anchor=1">לחצו</a>',
  ].join("\n\n"),
  tags: "",
  created_at: "2026-03-09T09:00:00+00:00",
});
