/** Deterministic fixture data for the stubbed Base44 backend. */

export const TESTIMONIALS = [
  {
    id: "t1",
    name: "רונית לוי",
    role: "לקוחה מאז 2019",
    quote: "ליווי מקצועי, סבלני ואנושי. הרגשתי בידיים טובות לאורך כל הדרך.",
    rating: 5,
    source: "google",
    created_date: "2026-01-05T10:00:00Z",
  },
  {
    id: "t2",
    name: "אבי כהן",
    role: "עצמאי",
    quote: "דורית איתרה פערים בכיסוי שלא ידעתי עליהם וחסכה לי כסף אמיתי.",
    rating: 5,
    source: "midrag",
    created_date: "2026-02-11T10:00:00Z",
  },
];

export const BLOG_POSTS = [
  {
    id: "post-1",
    title: "חמש שאלות לשאול לפני שבוחרים קרן פנסיה",
    excerpt: "מדריך קצר לבחירה מושכלת של קרן פנסיה.",
    body: "## מה חשוב לבדוק\n\nדמי ניהול, מסלול השקעה וכיסויים ביטוחיים.\n\n- דמי ניהול מהפקדה\n- דמי ניהול מצבירה\n",
    image_url: "https://media.base44.com/images/public/test/post-1.jpg",
    tags: "פנסיה, חיסכון",
    published: true,
    created_date: "2026-03-01T09:00:00Z",
  },
  {
    id: "post-2",
    title: "אובדן כושר עבודה — קו ההגנה הראשון",
    excerpt: "למה הכיסוי הזה חשוב לא פחות מהחיסכון עצמו.",
    body: "טקסט המאמר.",
    tags: "ביטוח",
    published: true,
    created_date: "2026-03-08T09:00:00Z",
  },
];

/**
 * A blog post whose body is an XSS attempt. react-markdown must render this as
 * visible text, never as live markup.
 */
export const XSS_POST = {
  id: "xss-post",
  title: "<img src=x onerror=\"window.__xss_title=1\">כותרת",
  excerpt: "",
  body: [
    '<script>window.__xss_body = 1<\/script>',
    '<img src="x" onerror="window.__xss_body = 1">',
    "[קישור](javascript:window.__xss_link=1)",
    '<a href="javascript:window.__xss_anchor=1">לחצו</a>',
  ].join("\n\n"),
  tags: "",
  published: true,
  created_date: "2026-03-09T09:00:00Z",
};

export const PUBLIC_SETTINGS = {
  id: "e2e-sanity-app",
  public_settings: {
    name: "דורית גוב ארי",
    auth_required: false,
  },
};
