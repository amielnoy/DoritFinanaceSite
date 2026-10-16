import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';

/** שם הפונקציה כפי שהוא מופיע בכל שורת יומן שלה. */
const FN = 'contentAdmin';

/**
 * שורת יומן מובנית — JSON בשורה אחת, לפלט הפונקציה.
 *
 * הכלל שקובע מה נכנס לכאן: **מה קרה, לא מה נאמר.** אירוע, תוצאה ומזהה בקשה —
 * ולעולם לא תוכן ההמלצה, שם הממליץ או גוף הכתבה.
 *
 * משוכפלת בכל פונקציה בכוונה — אין מודול משותף ב-Base44. משוכפל זה בסדר,
 * מפוצל זה לא.
 */
function log(level, event, fields) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, fn: FN, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** מזהה קצר שקושר את כל שורות היומן של בקשה אחת. */
const newRequestId = () => crypto.randomUUID().slice(0, 8);

/**
 * מי קורא, ובאיזו רשות.
 *
 * הפונקציה כותבת ב-`asServiceRole`, שעוקף את כללי ההרשאות של Base44. בלי
 * הבדיקה הזו היא דלת פתוחה: כל אחד שיודע את כתובת הפונקציה יכול לפרסם כתבה
 * או המלצה באתר. הבדיקה היא מה שמחליף את השער ש-RLS סיפק קודם, ולכן היא רצה
 * לפני כל פעולה ולא רק לפני חלקן.
 *
 * האסימון מגיע בכותרת משלו ולא ב-Authorization, ש-Base44 כבר קורא לעצמו.
 * האימות נעשה מול Supabase — חתימה מזויפת נדחית שם, לא כאן — ואז ההרשאה נקראת:
 * מפעיל הפלטפורמה (`profiles.role = 'admin'`), או מנהל/ת או בעלים של סוכנות 1
 * (`staff_role`), כמו שהמסכים מציגים את הפעולות.
 */
/** The site's articles and testimonials are agency 1's (content-admin writes them there). */
const CONTENT_AGENCY = '00000000-0000-0000-0000-000000000001';

async function requireAdmin(req, rid) {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !key) {
    log('error', 'auth.unconfigured', { rid });
    return { ok: false, status: 500, error: 'שירות ההזדהות אינו מוגדר.' };
  }

  const token = (req.headers.get('X-Supabase-Auth') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    log('warn', 'auth.missing_token', { rid });
    return { ok: false, status: 401, error: 'נדרשת התחברות.' };
  }

  // Supabase מאמת את החתימה. אסימון מזויף או שפג תוקפו נדחה כאן.
  const who = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  });
  if (!who.ok) {
    log('warn', 'auth.rejected', { rid, status: who.status });
    return { ok: false, status: 401, error: 'ההתחברות פגה. יש להתחבר מחדש.' };
  }
  const user = await who.json();

  const res = await fetch(
    `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) {
    // קריאה שנכשלה אינה "אינו מנהל". הן נראות זהות מבחוץ, והבלבול ביניהן שולח
    // את מי שמאבחן לכיוון הלא נכון.
    log('error', 'auth.profile_read_failed', { rid, status: res.status });
    return { ok: false, status: 500, error: 'לא הצלחנו לאמת את ההרשאה.' };
  }
  const rows = await res.json();
  const role = rows?.[0]?.role ?? null;
  if (role === 'admin') {
    log('info', 'auth.ok', { rid, userId: user.id, as: 'operator' });
    return { ok: true, userId: user.id };
  }

  // The agency's own Admins and Owners write its articles and testimonials too
  // (agency roles, 2026-10-15): the screens offer them these controls
  // (src/config/permissions.ts — blog.publish, blog.delete, testimonials.write
  // are "admin"), so this gate must agree, or an Owner who is not the platform
  // operator — Dorit — sees a publish toggle that every click is refused by.
  // `staff_role` reads the membership of an active agency; service role only.
  const member = await fetch(`${url}/rest/v1/rpc/staff_role`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_user_id: user.id, p_agency_id: CONTENT_AGENCY }),
  });
  if (!member.ok) {
    log('error', 'auth.agency_role_read_failed', { rid, status: member.status });
    return { ok: false, status: 500, error: 'לא הצלחנו לאמת את ההרשאה.' };
  }
  const agencyRole = await member.json().catch(() => null);
  if (agencyRole !== 'owner' && agencyRole !== 'admin') {
    log('warn', 'auth.not_admin', { rid, userId: user.id });
    return { ok: false, status: 403, error: 'הפעולה מותרת למנהלים בלבד.' };
  }

  log('info', 'auth.ok', { rid, userId: user.id, as: agencyRole });
  return { ok: true, userId: user.id };
}

/**
 * רק השדות שהישות מצהירה עליהם, ובשמותיהם.
 *
 * פריסה של גוף הבקשה לתוך כתיבה לישות נותנת לקורא לקבוע כל שדה שיעלה בדעתו —
 * כולל כאלה שאיש לא התכוון לחשוף. הרשימה כאן היא מה שהטופס באמת שולח, וכל דבר
 * אחר נופל בשקט. tests/security/agent-surface.security.test.ts נכשל אם פריסה
 * כזו חוזרת.
 */
const pick = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj?.[k] !== undefined) out[k] = obj[k];
  return out;
};

const ARTICLE_FIELDS = ['title', 'excerpt', 'body', 'image_url', 'tags', 'published'];
const TESTIMONIAL_FIELDS = ['name', 'role', 'quote', 'image_url', 'rating', 'source'];

/**
 * כתובת המאמר — `/blog/<slug>`. נשמרת רק בעותק של Supabase: ל-BlogPost של
 * Base44 אין שדה כזה, ולכן היא לא ב-ARTICLE_FIELDS ולא נכתבת לשם.
 *
 * אותה תבנית כמו ב-src/lib/articlePath.ts, במיגרציה 20261014000000_blog_slug.sql
 * וב-scripts/published-articles.mjs. משוכפל זה בסדר, מפוצל זה לא —
 * tests/contract/article-slug.contract.test.ts נכשל כשהן נפרדות. כתובת בצורת
 * מזהה Base44 (24 תווים הקסדצימליים) נדחית: vercel.json שולח כל כתובת כזו
 * להפניה של קישורים ישנים, והמאמר לא היה נגיש.
 */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/;
const SUPABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isValidSlug = (s) => typeof s === 'string' && SLUG_PATTERN.test(s) && !BASE44_ID_PATTERN.test(s);

/**
 * האם מאמר אחר כבר משתמש בכתובת.
 *
 * נבדק לפני הכתיבה ל-Base44: האילוץ הייחודי ב-Supabase היה דוחה רק את השיקוף,
 * אחרי שהשורה ב-Base44 כבר נוצרה — וניסיון חוזר עם כתובת אחרת היה יוצר שורה שנייה.
 */
async function slugTaken(slug, ownId) {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !key) throw new Error('Supabase is not configured');
  const res = await fetch(
    `${url}/rest/v1/blog_posts?slug=eq.${encodeURIComponent(slug)}&select=base44_id`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`slug lookup ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('slug lookup: the answer is not a list');
  return rows.some((r) => r?.base44_id !== ownId);
}

/**
 * שיקוף ל-Supabase. כשל זורק, והבקשה כולה נכשלת.
 *
 * האתר קורא מ-Supabase, ולכן כתיבה שלא הגיעה לשם היא — מבחינת המבקר — כתיבה
 * שלא קרתה. הסדר נשאר Base44 ואז Supabase: ביצירה, Base44 הוא שמנפיק את המזהה
 * שנחתם ב-base44_id, ואין מזהה לכתוב איתו קודם. יצירה שנכשלה כאן משאירה שורה
 * ב-Base44 בלבד; המזהה שלה נרשם ביומן, ו-scripts/reconcile-stores.mjs מוצא אותה.
 */
async function mirror(rid, op, table, id, body, query = '') {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !key) throw new Error('Supabase is not configured');
  try {
    // 'update' is a PATCH on the one row, not an upsert. An update should
    // touch only what changed (a publish toggle sends `published` alone), and
    // it should fail loudly when the row is missing, not create one.
    const method = op === 'delete' ? 'DELETE' : op === 'update' ? 'PATCH' : 'POST';
    const res = await fetch(`${url}/rest/v1/${table}${query}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: op === 'update' ? 'return=representation' : 'resolution=merge-duplicates,return=minimal',
      },
      body: op === 'delete' ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 140)}`);
    // A PATCH that matched no row changes nothing and reports no error. The site
    // reads this copy, so that is a failed write, not a successful one.
    if (op === 'update') {
      const rows = await res.json().catch(() => null);
      if (!Array.isArray(rows) || rows.length === 0) throw new Error('no Supabase row has this base44_id');
    }
    log('info', 'content.mirrored', { rid, table, op });
  } catch (e) {
    log('error', 'content.mirror_failed', {
      rid, table, op, base44Id: id ?? null, err: String(e?.message ?? e).slice(0, 200),
    });
    throw e;
  }
}

/**
 * מחיקה ב-Base44, כש-404 פירושו "כבר נמחק".
 *
 * מחיקה שהשיקוף שלה נכשל נענית ב-500, אבל השורה ב-Base44 כבר נעלמה. ניסיון חוזר
 * היה נתקע לנצח על ה-404 לפני שהשיקוף בכלל רץ, והפריט היה נשאר באתר, שקורא
 * מ-Supabase. לכן 404 ממשיך לשיקוף. כל שגיאה אחרת עדיין מכשילה את הבקשה.
 * אותו כלל כמו ב-adminLead.
 */
async function deleteBase44(run) {
  try {
    await run();
  } catch (e) {
    if ((e?.status ?? e?.response?.status) !== 404) throw e;
  }
}

export default async function(req) {
  const rid = newRequestId();
  const startedAt = Date.now();
  // One place, so no answer can leave without the id that names its logs.
  // The other functions build each response by hand; this shape is the one
  // worth copying when they are next touched.
  const json = (body, status = 200) => Response.json({ ...body, rid }, { status });

  log('info', 'request.start', { rid });

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => null);
    const { op, id, draft } = body || {};

    const gate = await requireAdmin(req, rid);
    if (!gate.ok) return json({ error: gate.error }, gate.status);

    // A Supabase uuid is a row the Supabase-only content-admin wrote
    // (VITE_CONTENT_WRITES=supabase) — it has no Base44 copy. Here an update
    // would fail and a remove would answer 200 with the article still live
    // (Base44's 404 reads as "already gone", the mirror's filter matches no
    // base44_id). Refused, so switching back is loud instead of silent.
    if (op !== 'createArticle' && op !== 'createTestimonial' && SUPABASE_UUID.test(String(id ?? ''))) {
      log('warn', 'content.supabase_only_row', { rid, op });
      return json({ error: 'הפריט נוצר אחרי המעבר ל-Supabase, ואפשר לערוך אותו רק כשהמעבר פעיל.' }, 409);
    }

    let result = { ok: true };

    switch (op) {
      case 'createArticle': {
        const slug = draft?.slug;
        if (!isValidSlug(slug)) {
          log('warn', 'article.slug_invalid', { rid, op });
          return json({ error: 'כתובת המאמר חסרה או אינה תקינה.' }, 400);
        }
        if (await slugTaken(slug, null)) {
          log('warn', 'article.slug_taken', { rid, op });
          return json({ error: 'הכתובת כבר בשימוש במאמר אחר.' }, 409);
        }
        const fields = { ...pick(draft, ARTICLE_FIELDS), published: !!draft?.published };
        const row = await base44.asServiceRole.entities.BlogPost.create(fields);
        const newId = row?.id ?? null;
        await mirror(rid, 'upsert', 'blog_posts?on_conflict=base44_id', newId, { ...fields, slug, base44_id: newId });
        result = { ok: true, id: newId };
        break;
      }
      case 'updateArticle': {
        const fields = pick(draft, ARTICLE_FIELDS);
        // The slug key is absent from the mirror body unless the draft carries a
        // valid one; a null or empty slug would defeat the NOT NULL column.
        const slug = draft?.slug;
        if (slug !== undefined) {
          if (!isValidSlug(slug)) {
            log('warn', 'article.slug_invalid', { rid, op });
            return json({ error: 'כתובת המאמר חסרה או אינה תקינה.' }, 400);
          }
          if (await slugTaken(slug, id)) {
            log('warn', 'article.slug_taken', { rid, op });
            return json({ error: 'הכתובת כבר בשימוש במאמר אחר.' }, 409);
          }
        }
        await base44.asServiceRole.entities.BlogPost.update(id, fields);
        await mirror(
          rid, 'update', 'blog_posts', id,
          slug === undefined ? fields : { ...fields, slug },
          `?base44_id=eq.${encodeURIComponent(id)}`,
        );
        break;
      }
      case 'removeArticle': {
        await deleteBase44(() => base44.asServiceRole.entities.BlogPost.delete(id));
        await mirror(rid, 'delete', 'blog_posts', id, null, `?base44_id=eq.${encodeURIComponent(id)}`);
        break;
      }
      case 'createTestimonial': {
        const fields = {
          ...pick(draft, TESTIMONIAL_FIELDS),
          rating: Number(draft?.rating) || 5,
          source: draft?.source || 'google',
        };
        const row = await base44.asServiceRole.entities.Testimonial.create(fields);
        const newId = row?.id ?? null;
        await mirror(rid, 'upsert', 'testimonials?on_conflict=base44_id', newId, { ...fields, base44_id: newId });
        result = { ok: true, id: newId };
        break;
      }
      case 'removeTestimonial': {
        await deleteBase44(() => base44.asServiceRole.entities.Testimonial.delete(id));
        await mirror(rid, 'delete', 'testimonials', id, null, `?base44_id=eq.${encodeURIComponent(id)}`);
        break;
      }
      default:
        log('warn', 'op.unknown', { rid, op: String(op).slice(0, 40) });
        return json({ error: 'פעולה לא מוכרת.' }, 400);
    }

    log('info', 'request.end', { rid, op, ms: Date.now() - startedAt });
    return json(result);
  } catch (e) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String(e?.message ?? e).slice(0, 200) });
    return json({ error: 'הפעולה נכשלה.', rid }, 500);
  }
}
