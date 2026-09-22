import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/** שם הפונקציה כפי שהוא מופיע בכל שורת יומן שלה. */
const FN = 'createConsultationEvent';

/**
 * שורת יומן מובנית — JSON בשורה אחת, לפלט הפונקציה.
 *
 * Base44 אוסף את פלט הקונסולה ומגיש אותו ב-`base44 logs`, ומשם job יומי שומר
 * אותו תחת `logs/` במאגר. עד כה הפונקציות לא כתבו לשם דבר, והאבחון היחיד היה
 * נספח האזהרות שבמייל — כלומר אפשר היה לאבחן רק פנייה שהמייל שלה בכלל יצא.
 *
 * הכלל שקובע מה נכנס לכאן: **מה קרה, לא מה נאמר.** אירוע, תוצאה, משך ומזהה
 * בקשה — ולעולם לא שם, טלפון, אימייל, הודעה, תקציר או פרופיל. יומן הוא המקום
 * היחיד שבקשת מחיקה אינה מגיעה אליו, ולכן הקשירה בין שורות נעשית דרך `rid`
 * ולא דרך זהות האדם. tests/contract/logging.contract.test.ts נכשל אם שדה אסור
 * מגיע לכאן.
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
 * מועד "שעון קיר" — מחרוזת בלי אזור זמן ובלי Z, ועוד דקות עליה.
 *
 * גם Google וגם Graph מצפים ל-dateTime מקומי לצד שדה timeZone נפרד. הקוד כאן
 * המיר קודם דרך `new Date(scheduledAt).toISOString()`, וזה הצמיד Z למחרוזת —
 * ואז ה-offset שבמחרוזת גובר על timeZone, כך ש-10:00 שביקש המבקר נכנס ליומן
 * ב-13:00. לכן אין כאן מעבר דרך רגע אמיתי בזמן: השדות נשארים כפי שנמסרו,
 * ו-Date.UTC משמש כאן כאריתמטיקה על שעון קיר בלבד.
 *
 * משוכפלת בכל פונקציה בכוונה — אין מודול משותף ב-Base44. משוכפל זה בסדר,
 * מפוצל זה לא.
 */
function wallClock(iso, addMinutes = 0) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) + addMinutes * 60000;
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** התאריך של מחר לפי שעון ישראל — לא לפי UTC, שמזיז אותו ביום סביב חצות. */
function tomorrowInIsrael() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' });
}


export default async function(req) {
  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { name, phone, email, topic, timing, notes, scheduledAt } = body || {};

    if (!name || !phone) {
      log('warn', 'request.rejected', { rid, reason: 'missing_contact_fields' });
      return Response.json({ error: 'נדרשים שם וטלפון' }, { status: 400 });
    }

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');

    // תזמון האירוע — לפי המועד שסוכם, או תזכורת למחר ב-09:00 כשלא סוכם מועד.
    //
    // האירוע נוצר גם בלי מועד מוסכם, כי אירוע שלא נוצר הוא פנייה שנשכחת. אבל
    // הוא חייב להיראות שונה: עד כה שובץ "מחר ב-09:00" בשקט, וזה נראה ביומן
    // בדיוק כמו מועד שסוכם — מי שחיפש את הפגישה ביום שביקש לא מצא דבר.
    const agreedStart = wallClock(scheduledAt);
    const startIso = agreedStart ?? `${tomorrowInIsrael()}T09:00:00`;
    const endIso = wallClock(startIso, 30);
    const slotAgreed = Boolean(agreedStart);

    const summary = slotAgreed
      ? `ייעוץ חדש — ${name}`
      : `לתאם מועד — ${name}`;
    const description = [
      `פנייה חדשה מהאתר`,
      ``,
      `שם: ${name}`,
      `טלפון: ${phone}`,
      `אימייל: ${email || '—'}`,
      `תחום ייעוץ: ${topic || '—'}`,
      `מועד מבוקש: ${timing || '—'}`,
      `הערות: ${notes || '—'}`,
      ``,
      `לייצר קשר ולתאם את פגישת הייעוץ הראשונה.`,
    ].join('\n');

    const eventBody = {
      summary,
      description,
      start: { dateTime: startIso, timeZone: 'Asia/Jerusalem' },
      end: { dateTime: endIso, timeZone: 'Asia/Jerusalem' },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 60 },
          { method: 'email', minutes: 720 },
        ],
      },
    };

    const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    });

    if (!res.ok) {
      const errText = await res.text();
      // סטטוס בלבד: גוף השגיאה של Google חוזר לקורא, ואינו נכתב ליומן שנשמר.
      log('error', 'calendar.rejected', { rid, provider: 'google', status: res.status });
      return Response.json({ error: 'שגיאת Google Calendar', details: errText }, { status: 502 });
    }

    const data = await res.json();
    log('info', 'calendar.created', { rid, ms: Date.now() - startedAt, provider: 'google', eventId: data.id });
    return Response.json({ ok: true, eventId: data.id, htmlLink: data.htmlLink });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String(error?.message ?? error).slice(0, 200) });
    return Response.json({ error: error.message }, { status: 500 });
  }
}