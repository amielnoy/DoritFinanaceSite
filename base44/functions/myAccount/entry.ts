import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/** שם הפונקציה כפי שהוא מופיע בכל שורת יומן שלה. */
const FN = 'myAccount';

/**
 * שורת יומן מובנית. מה קרה, לא מי — אין כאן כתובת מייל, שם או טלפון.
 * משוכפלת בכל פונקציה בכוונה; אין מודול משותף ב-Base44.
 */
function log(level, event, fields) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, fn: FN, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

const newRequestId = () => crypto.randomUUID().slice(0, 8);

/**
 * העמודות שמבקר רשאי לראות — אותה רשימה ש-enquiries_for בוחרת.
 * כפולה כאן בכוונה: אם ה-SQL ישתנה אי פעם, הפונקציה הזו עדיין לא תעביר עמודה
 * שלא הוחלט עליה.
 */
const VISIBLE = [
  'created_at', 'source', 'track', 'track_label', 'meeting_topic', 'timing',
  'scheduled_at', 'summary', 'profile', 'completed', 'in_calendar',
];
const pick = (row) => Object.fromEntries(VISIBLE.map((k) => [k, row?.[k] ?? null]));

/**
 * האזור האישי של משתמש שמחובר דרך Base44.
 *
 * מזהה את המשתמש, לוקח את כתובתו המאומתת, ומבקש מ-Supabase בדיוק את מה
 * ש-enquiries_for משחררת. ראו docs/superpowers/specs/2026-10-06-personal-area-design.md.
 */
export default async function(req) {
  const rid = newRequestId();
  const startedAt = Date.now();
  const json = (body, status = 200) => Response.json({ ...body, rid }, { status });
  log('info', 'request.start', { rid });

  let me;
  try {
    const base44 = createClientFromRequest(req);
    me = await base44.auth.me();
  } catch (e) {
    const status = e?.status ?? e?.response?.status;
    if (status === 401 || status === 403) {
      log('warn', 'auth.anonymous', { rid });
      return json({ error: 'נדרשת התחברות.' }, 401);
    }
    log('error', 'auth.failed', { rid, status: status ?? null, err: String(e?.message ?? e).slice(0, 200) });
    return json({ error: 'לא הצלחנו לטעון את הפרטים. אפשר לנסות שוב.' }, 500);
  }

  const email = String(me?.email ?? '').trim().toLowerCase();
  if (!email || me?.is_verified !== true || me?.disabled) {
    log('warn', 'auth.not_eligible', { rid, verified: me?.is_verified === true, disabled: Boolean(me?.disabled) });
    return json({ error: 'כתובת המייל בחשבון עדיין לא אומתה.' }, 403);
  }

  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !key) {
    log('error', 'supabase.unconfigured', { rid });
    return json({ error: 'האזור האישי אינו זמין כרגע.' }, 500);
  }

  try {
    const res = await fetch(`${url}/rest/v1/rpc/enquiries_for`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_email: email }),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const rows = await res.json();
    const enquiries = (Array.isArray(rows) ? rows : []).map(pick);
    log('info', 'request.end', { rid, count: enquiries.length, ms: Date.now() - startedAt });
    return json({ ok: true, enquiries });
  } catch (e) {
    log('error', 'supabase.failed', { rid, err: String(e?.message ?? e).slice(0, 200) });
    return json({ error: 'לא הצלחנו לטעון את הפרטים. אפשר לנסות שוב.' }, 500);
  }
}
