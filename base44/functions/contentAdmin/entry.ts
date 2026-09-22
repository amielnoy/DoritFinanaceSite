import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

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
 * האימות נעשה מול Supabase — חתימה מזויפת נדחית שם, לא כאן — ואז התפקיד נקרא
 * מטבלת `profiles`, שהיא הסמכות היחידה על מי מנהל.
 */
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
  if (role !== 'admin') {
    log('warn', 'auth.not_admin', { rid, userId: user.id });
    return { ok: false, status: 403, error: 'הפעולה מותרת למנהלים בלבד.' };
  }

  log('info', 'auth.ok', { rid, userId: user.id });
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

/** שיקוף ל-Supabase. לעולם לא זורק — Base44 הוא המקור הסמכותי בשלב הזה. */
async function mirror(rid, op, table, body, query = '') {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !key) return;
  try {
    const res = await fetch(`${url}/rest/v1/${table}${query}`, {
      method: op === 'delete' ? 'DELETE' : 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: op === 'delete' ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 140)}`);
    log('info', 'content.mirrored', { rid, table, op });
  } catch (e) {
    log('warn', 'content.mirror_failed', { rid, table, op, err: String(e?.message ?? e).slice(0, 200) });
  }
}

export default async function(req) {
  const rid = newRequestId();
  const startedAt = Date.now();
  const json = (body, status = 200) => Response.json(body, { status });

  log('info', 'request.start', { rid });

  try {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => null);
    const { op, id, draft } = body || {};

    const gate = await requireAdmin(req, rid);
    if (!gate.ok) return json({ error: gate.error }, gate.status);

    let result = { ok: true };

    switch (op) {
      case 'createArticle': {
        const fields = { ...pick(draft, ARTICLE_FIELDS), published: !!draft?.published };
        const row = await base44.asServiceRole.entities.BlogPost.create(fields);
        const newId = row?.id ?? null;
        await mirror(rid, 'upsert', 'blog_posts?on_conflict=base44_id', { ...fields, base44_id: newId });
        result = { ok: true, id: newId };
        break;
      }
      case 'updateArticle': {
        const fields = pick(draft, ARTICLE_FIELDS);
        await base44.asServiceRole.entities.BlogPost.update(id, fields);
        await mirror(rid, 'upsert', 'blog_posts?on_conflict=base44_id', { ...fields, base44_id: id });
        break;
      }
      case 'removeArticle': {
        await base44.asServiceRole.entities.BlogPost.delete(id);
        await mirror(rid, 'delete', 'blog_posts', null, `?base44_id=eq.${encodeURIComponent(id)}`);
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
        await mirror(rid, 'upsert', 'testimonials?on_conflict=base44_id', { ...fields, base44_id: newId });
        result = { ok: true, id: newId };
        break;
      }
      case 'removeTestimonial': {
        await base44.asServiceRole.entities.Testimonial.delete(id);
        await mirror(rid, 'delete', 'testimonials', null, `?base44_id=eq.${encodeURIComponent(id)}`);
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
    return json({ error: 'הפעולה נכשלה.', details: e?.message }, 500);
  }
}
