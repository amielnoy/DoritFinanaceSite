/**
 * The articles the support, procedures and blog chats may read: published,
 * this agency's or shared, exactly the set the public blog shows. The service
 * key bypasses row-level security, so the filters the RLS read policy applies
 * to the site are spelled out here; nothing about them comes from the model.
 */
import { AGENCY } from '../_shared/agency.ts';
import { selectRows } from '../_shared/rest.ts';

export interface ArticleSummary { slug: string; title: string; excerpt: string; tags: string }
export interface ArticleText { slug: string; title: string; body: string; truncated: boolean }
export interface ArticleSource {
  list(): Promise<ArticleSummary[]>;
  read(slug: string): Promise<ArticleText | null>;
}

export const ARTICLE_LIST_LIMIT = 60;
/** About 3,000 Hebrew words; a longer article is cut and the model is told. */
export const ARTICLE_BODY_LIMIT = 12_000;
/** The site's slug rule (src/lib/articlePath.ts). */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG = 200;

const s = (v: unknown): string => (typeof v === 'string' ? v : '');

export function createArticleSource(
  select: (table: string, query: string) => Promise<Record<string, unknown>[]>,
  agencyId: string,
): ArticleSource {
  const visible = `published=eq.true&or=(agency_id.is.null,agency_id.eq.${agencyId})`;
  return {
    async list() {
      const rows = await select('blog_posts', `select=slug,title,excerpt,tags&${visible}&order=created_at.desc&limit=${ARTICLE_LIST_LIMIT}`);
      return rows.map((r) => ({ slug: s(r.slug), title: s(r.title), excerpt: s(r.excerpt), tags: s(r.tags) }));
    },
    async read(slug) {
      if (typeof slug !== 'string' || slug.length > MAX_SLUG || !SLUG_PATTERN.test(slug)) return null;
      const rows = await select('blog_posts', `select=slug,title,body&${visible}&slug=eq.${slug}&limit=1`);
      const row = rows[0];
      if (!row) return null;
      const body = s(row.body);
      return { slug: s(row.slug), title: s(row.title), body: body.slice(0, ARTICLE_BODY_LIMIT), truncated: body.length > ARTICLE_BODY_LIMIT };
    },
  };
}

export const restArticles: ArticleSource = createArticleSource(selectRows, AGENCY.id);
