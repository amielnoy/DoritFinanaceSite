/**
 * The admin's article and testimonial writes, on Supabase, the only store.
 *
 * Writes go with the service key, which bypasses row-level security, so the
 * gate below is the whole of the access control. It runs before every op, per
 * op (docs/superpowers/specs/2026-10-15-agency-roles-design.md): any member
 * writes an unpublished draft; publishing, unpublishing, deleting and every
 * testimonial write are Admin+; a shared-library article (no agency) is the
 * platform operator's. The agency is the row's own, or agency 1 for a new row
 * (the column default every insert here takes).
 */
import { corsHeaders } from '../_shared/cors.ts';
import { createLog, newRequestId } from '../_shared/log.ts';
import { AGENCY_1 } from '../_shared/masleka.ts';
import { deleteRows, insertRow, selectRows, updateRows } from '../_shared/rest.ts';
import { allowRole, sessionCaller, type AgencyRole, type Session } from '../_shared/staff.ts';

const FN = 'content-admin';
const log = createLog(FN);

/** The row an op acts on, for its agency and whether it is live; null when it is not there. */
async function existing(table: 'blog_posts' | 'testimonials', filter: string): Promise<Record<string, unknown> | null> {
  const select = table === 'blog_posts' ? 'agency_id,published' : 'agency_id';
  const rows = await selectRows(table, `${filter}&select=${select}`);
  return rows[0] ?? null;
}

/** The agency a row belongs to: its own (null for a shared-library article), or agency 1 for a new row. */
const agencyOf = (row: Record<string, unknown> | null): string | null =>
  row ? (typeof row.agency_id === 'string' ? row.agency_id : null) : AGENCY_1;

/** Only the fields the forms send, by name. Anything else — agency_id, id, base44_id — falls away. */
const pick = (obj: unknown, keys: readonly string[]) => {
  const out: Record<string, unknown> = {};
  const src = (obj ?? {}) as Record<string, unknown>;
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  return out;
};

const ARTICLE_FIELDS = ['title', 'excerpt', 'body', 'image_url', 'tags', 'published'] as const;
const TESTIMONIAL_FIELDS = ['name', 'role', 'quote', 'image_url', 'rating', 'source'] as const;

/**
 * The article's address, `/blog/<slug>`. The same pattern as
 * src/lib/articlePath.ts, the 20261014000000_blog_slug.sql migration and
 * scripts/published-articles.mjs — tests/contract/article-slug.contract.test.ts
 * fails when they drift. A Base44-id-shaped slug is refused: vercel.json sends
 * every such address to the old-link redirect, so the article would be unreachable.
 */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isValidSlug = (s: unknown): s is string => typeof s === 'string' && SLUG_PATTERN.test(s) && !BASE44_ID_PATTERN.test(s);

/**
 * The PostgREST filter that finds a row by the id the admin screen holds.
 *
 * Content is handed out as `base44_id ?? id` (SupabaseTableClient.toPortRow):
 * a Base44 id for rows from before the move to Supabase, the Supabase uuid
 * for rows written since. Anything else is refused before it reaches a filter — an
 * `id=eq.` with a non-uuid is a Postgres error, and free text in a query
 * string is a filter someone else wrote.
 */
function keyFilter(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  if (UUID_PATTERN.test(id)) return `id=eq.${id}`;
  if (BASE44_ID_PATTERN.test(id)) return `base44_id=eq.${id}`;
  return null;
}

/** Whether another article already has this slug. `ownId` is the article being edited, by either of its ids. */
async function slugTaken(slug: string, ownId: string | null): Promise<boolean> {
  const rows = await selectRows('blog_posts', `slug=eq.${encodeURIComponent(slug)}&select=id,base44_id`);
  return rows.some((r) => ownId === null || (r.id !== ownId && r.base44_id !== ownId));
}

export async function handler(req: Request): Promise<Response> {
  const cors = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const rid = newRequestId();
  const startedAt = Date.now();
  // One place, so no answer leaves without the id that names its logs.
  const json = (body: Record<string, unknown>, status = 200) =>
    Response.json({ ...body, rid }, { status, headers: cors });

  log('info', 'request.start', { rid });
  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const session = await sessionCaller(req, rid, log);
    if (!session.ok) return json({ error: session.error }, session.status);

    const body = (await req.json().catch(() => null)) as { op?: unknown; id?: unknown; draft?: Record<string, unknown> } | null;
    const { op, id, draft } = body ?? {};
    let result: Record<string, unknown> = { ok: true };
    // The gate for this op, on the row's agency; null when it passes.
    const refused = async (s: Session, row: Record<string, unknown> | null, min: AgencyRole) => {
      const gate = await allowRole(s, agencyOf(row), min, rid, log);
      return gate.ok ? null : json({ error: gate.error }, gate.status);
    };

    switch (op) {
      case 'createArticle': {
        const stop = await refused(session, null, draft?.published ? 'admin' : 'user');
        if (stop) return stop;
        const slug = draft?.slug;
        if (!isValidSlug(slug)) {
          log('warn', 'article.slug_invalid', { rid, op });
          return json({ error: 'כתובת המאמר חסרה או אינה תקינה.' }, 400);
        }
        if (await slugTaken(slug, null)) {
          log('warn', 'article.slug_taken', { rid, op });
          return json({ error: 'הכתובת כבר בשימוש במאמר אחר.' }, 409);
        }
        let row: Record<string, unknown>;
        try {
          row = await insertRow('blog_posts', { ...pick(draft, ARTICLE_FIELDS), published: !!draft?.published, slug });
        } catch (e) {
          // Two saves with one slug can both pass slugTaken; the unique key
          // refuses the second (23505), and it deserves the same answer.
          if (!String((e as Error)?.message).endsWith(':23505')) throw e;
          log('warn', 'article.slug_taken', { rid, op, race: true });
          return json({ error: 'הכתובת כבר בשימוש במאמר אחר.' }, 409);
        }
        result = { ok: true, id: row.id };
        break;
      }
      case 'updateArticle': {
        const filter = keyFilter(id);
        if (!filter) return json({ error: 'מזהה לא תקין.' }, 400);
        const fields = pick(draft, ARTICLE_FIELDS);
        // Only a real boolean: PostgREST would cast "true" or 1 to true, past a
        // gate that compares with `=== true` (security review of 2a50596).
        if ('published' in fields && typeof fields.published !== 'boolean') {
          log('warn', 'article.published_invalid', { rid, op });
          return json({ error: 'ערך הפרסום אינו תקין.' }, 400);
        }
        const row = await existing('blog_posts', filter);
        if (!row) {
          log('warn', 'article.not_found', { rid, op });
          return json({ error: 'המאמר לא נמצא.' }, 404);
        }
        // A live article, or one this edit would publish, is Admin+.
        const stop = await refused(session, row, row.published === true || fields.published === true ? 'admin' : 'user');
        if (stop) return stop;
        // No slug key unless the draft carries a valid one: a null or empty
        // slug would defeat the NOT NULL column. A publish toggle has none.
        const slug = draft?.slug;
        if (slug !== undefined) {
          if (!isValidSlug(slug)) {
            log('warn', 'article.slug_invalid', { rid, op });
            return json({ error: 'כתובת המאמר חסרה או אינה תקינה.' }, 400);
          }
          if (await slugTaken(slug, id as string)) {
            log('warn', 'article.slug_taken', { rid, op });
            return json({ error: 'הכתובת כבר בשימוש במאמר אחר.' }, 409);
          }
          fields.slug = slug;
        }
        // A PATCH that matches no row changes nothing and reports no error.
        // The site reads this table, so that is a failed write, not a success.
        const updated = await updateRows('blog_posts', filter, fields);
        if (updated.length === 0) {
          log('warn', 'article.not_found', { rid, op });
          return json({ error: 'המאמר לא נמצא.' }, 404);
        }
        break;
      }
      case 'removeArticle':
      case 'removeTestimonial': {
        const filter = keyFilter(id);
        if (!filter) return json({ error: 'מזהה לא תקין.' }, 400);
        const stop = await refused(session, await existing(op === 'removeArticle' ? 'blog_posts' : 'testimonials', filter), 'admin');
        if (stop) return stop;
        // Removing what is already gone answers 200: a retry after a lost
        // answer must not fail on the row its first attempt deleted.
        await deleteRows(op === 'removeArticle' ? 'blog_posts' : 'testimonials', filter);
        break;
      }
      case 'createTestimonial': {
        const stop = await refused(session, null, 'admin');
        if (stop) return stop;
        const row = await insertRow('testimonials', {
          ...pick(draft, TESTIMONIAL_FIELDS),
          rating: Number(draft?.rating) || 5,
          source: draft?.source || 'google',
        });
        result = { ok: true, id: row.id };
        break;
      }
      default:
        log('warn', 'op.unknown', { rid, op: String(op).slice(0, 40) });
        return json({ error: 'פעולה לא מוכרת.' }, 400);
    }

    log('info', 'request.end', { rid, op, ms: Date.now() - startedAt });
    return json(result);
  } catch (e) {
    // The id, not the message: PostgREST's text can quote the row back.
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String((e as Error)?.message ?? e).slice(0, 200) });
    return json({ error: 'הפעולה נכשלה.' }, 500);
  }
}
