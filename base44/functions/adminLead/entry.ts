import { createClientFromRequest } from 'npm:@base44/sdk@0.8.53';

/** שם הפונקציה כפי שהוא מופיע בכל שורת יומן שלה. */
const FN = 'adminLead';

/**
 * שורת יומן מובנית. מה קרה, לא מי — אין כאן שם, טלפון או כתובת מייל, רק מזהה
 * הפנייה והפעולה. משוכפלת בכל פונקציה בכוונה; אין מודול משותף ב-Base44.
 */
function log(level, event, fields) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, fn: FN, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

const newRequestId = () => crypto.randomUUID().slice(0, 8);

/** ערכי `status` של הישות Lead — base44/entities/Lead.jsonc. */
const STATUSES = ['new', 'contacted', 'closed', 'escalated', 'partial'];

/**
 * מזהה פנייה סביר: אותיות, ספרות, מקף וקו תחתון. המזהה נכנס ישר למסנן של
 * Supabase (`base44_id=eq.<id>`), ותו כמו `&` או `,` היה מרחיב אותו.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * שינוי סטטוס ומחיקה של פנייה, בשתי הרשתות.
 *
 * הדפדפן כתב רק ל-Base44, ו-Supabase — ממנו האזור האישי של המבקר קורא — נשאר
 * עם הסטטוס `new` ועם פנייה ש-Dorit כבר מחקה, גם כשהמחיקה באה בעקבות בקשת
 * מחיקה של המבקר עצמו.
 */
export default async function(req) {
  const rid = newRequestId();
  const startedAt = Date.now();
  const json = (body, status = 200) => Response.json({ ...body, rid }, { status });
  log('info', 'request.start', { rid });

  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let base44;
  let me;
  try {
    base44 = createClientFromRequest(req);
    me = await base44.auth.me();
  } catch (e) {
    const status = e?.status ?? e?.response?.status;
    if (status === 401 || status === 403) {
      log('warn', 'auth.anonymous', { rid });
      return json({ error: 'נדרשת התחברות.' }, 401);
    }
    log('error', 'auth.failed', { rid, status: status ?? null, err: String(e?.message ?? e).slice(0, 200) });
    return json({ error: 'לא הצלחנו לאמת את ההרשאה. אפשר לנסות שוב.' }, 500);
  }

  // הפונקציה כותבת ב-asServiceRole, שעוקף את כללי ההרשאות — זו הבדיקה שמחליפה אותם.
  if (me?.role !== 'admin') {
    log('warn', 'auth.not_admin', { rid });
    return json({ error: 'הפעולה מותרת למנהלים בלבד.' }, 403);
  }

  const body = await req.json().catch(() => null);
  const action = body?.action;
  const id = body?.id;
  const status = body?.status;

  if ((action !== 'status' && action !== 'delete') || typeof id !== 'string' || !ID_PATTERN.test(id)) {
    log('warn', 'request.invalid', { rid, action: typeof action === 'string' ? action.slice(0, 20) : null });
    return json({ error: 'הבקשה אינה תקינה.' }, 400);
  }
  if (action === 'status' && !STATUSES.includes(status)) {
    log('warn', 'request.invalid_status', { rid, action, id });
    return json({ error: 'הבקשה אינה תקינה.' }, 400);
  }

  // Supabase קודם, ורק אחריו Base44. שתי הכתיבות אידמפוטנטיות, ולכן כשל באמצע
  // משאיר את הפנייה ברשימת המנהל, וניסיון חוזר משלים אותו. הסדר ההפוך — Base44
  // ואז כשל ב-Supabase — היה מסיר את הפנייה מהרשימה ומשאיר את עותקה ב-Supabase,
  // ואיתו את מה שהמבקר רואה באזור האישי, בלי שום דרך לחזור אליו.
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !key) {
    // לא מוגדר — כותבים ל-Base44 בלבד. נרשם ולא שותק, בדיוק כמו ב-submitLead.
    log('warn', 'lead.mirror_skipped', { rid, action, id, hasUrl: Boolean(url), hasKey: Boolean(key) });
  } else {
    try {
      // 0 שורות תואמות זה בסדר: פנייה ששיקופה ביצירה נכשל. פגישה נמחקת עם
      // הפנייה — on delete cascade ב-meetings.lead_base44_id.
      const res = await fetch(`${url}/rest/v1/leads?base44_id=eq.${encodeURIComponent(id)}`, {
        method: action === 'delete' ? 'DELETE' : 'PATCH',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: action === 'delete' ? undefined : JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      log('info', 'lead.mirrored', { rid, action, id });
    } catch (e) {
      log('error', 'lead.mirror_failed', { rid, action, id, err: String(e?.message ?? e).slice(0, 200) });
      return json({ error: 'לא הצלחנו לשמור את השינוי. אפשר לנסות שוב.' }, 502);
    }
  }

  try {
    if (action === 'delete') await base44.asServiceRole.entities.Lead.delete(id);
    else await base44.asServiceRole.entities.Lead.update(id, { status });
  } catch (e) {
    log('error', 'lead.write_failed', { rid, action, id, err: String(e?.message ?? e).slice(0, 200) });
    return json({ error: 'לא הצלחנו לשמור את השינוי. אפשר לנסות שוב.' }, 502);
  }

  log('info', 'request.end', { rid, action, id, ms: Date.now() - startedAt });
  return json({ ok: true });
}
