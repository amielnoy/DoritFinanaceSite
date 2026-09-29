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

/**
 * שני היומנים, ומה שונה ביניהם.
 *
 * היומן של דורית הוא Outlook — הדומיין `govari-fin.co.il` מפנה ל-Microsoft 365,
 * וזה מה שפתוח מולה ביום העבודה. לכן `outlook` ראשון ברשימה, וכשרק אחד ייכתב
 * הוא זה. Google נשאר נתמך במלואו: הוא היה היעד היחיד עד כה, ופנייה שכבר יש לה
 * אירוע שם היא לא פנייה שכדאי להזיז בשקט.
 *
 * ההבדלים בין השניים קטנים ומלכודתיים, ולכן הם יושבים כאן ולא פזורים בקוד:
 *
 *   - **שם אזור הזמן.** Graph מצפה לשם של Windows (`Israel Standard Time`),
 *     Google לשם IANA (`Asia/Jerusalem`). כל אחד מהם שקט כשמקבלים את האחר.
 *   - **שמות השדות.** `subject`/`body` מול `summary`/`description`.
 *   - **קישור לאירוע.** `webLink` מול `htmlLink`.
 *   - **תזכורות.** ל-Google אפשר למסור כמה, ולכן יש בו גם תזכורת מייל 12 שעות
 *     לפני. ל-Graph יש שדה אחד בלבד, `reminderMinutesBeforeStart`, ולכן שם
 *     נשארת רק תזכורת השעה. זה הבדל אמיתי בין שני היומנים ולא השמטה.
 */
const CALENDARS = {
  outlook: {
    connector: 'outlook',
    url: 'https://graph.microsoft.com/v1.0/me/events',
    body: ({ summary, description, startIso, endIso }) => ({
      subject: summary,
      body: { contentType: 'Text', content: description },
      start: { dateTime: startIso, timeZone: 'Israel Standard Time' },
      end: { dateTime: endIso, timeZone: 'Israel Standard Time' },
      isReminderOn: true,
      reminderMinutesBeforeStart: 60,
    }),
    link: (data) => data.webLink,
  },
  google: {
    connector: 'googlecalendar',
    url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    body: ({ summary, description, startIso, endIso }) => ({
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
    }),
    link: (data) => data.htmlLink,
  },
};

/**
 * לאילו יומנים נכתב — ברירת המחדל היא שניהם.
 *
 * משוכפלת בכל פונקציה שכותבת ליומן בכוונה — אין מודול משותף ב-Base44.
 * משוכפל זה בסדר, מפוצל זה לא, ו-agents.contract.test.ts נכשל כששני העותקים
 * מתפצלים.
 */
const CALENDAR_PROVIDERS = (Deno.env.get('CALENDAR_PROVIDERS') || 'outlook,google')
  .split(',')
  .map((p) => p.trim().toLowerCase())
  .filter((p) => p in CALENDARS);

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

    if (CALENDAR_PROVIDERS.length === 0) {
      // CALENDAR_PROVIDERS הוגדר ולא נותר בו שם מוכר. שתיקה כאן הייתה מחזירה
      // ok על בקשה שלא נכתבה לשום יומן.
      log('error', 'calendar.no_provider', { rid });
      return Response.json({ error: 'לא מוגדר יומן יעד' }, { status: 500 });
    }

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

    const event = { summary, description, startIso, endIso };
    const events = [];
    const warnings = [];

    // ברצף ולא במקביל. שני היומנים כותבים את אותה פגישה, ושגיאת הרשאה על
    // הראשון היא כמעט תמיד אותה שגיאה על השני — עדיף שורת יומן אחת לכל אחד
    // בסדר קריא מאשר שתיים שנכנסות יחד.
    for (const provider of CALENDAR_PROVIDERS) {
      const cal = CALENDARS[provider];
      try {
        const { accessToken } = await base44.asServiceRole.connectors.getConnection(cal.connector);
        if (!accessToken) {
          // מחובר-למחצה זה מצב אמיתי: המחבר מוגדר במאגר, ואיש לא אישר אותו
          // מול הספק. זו אזהרה ולא שגיאה — היומן השני עדיין יקבל את הפגישה.
          log('warn', 'calendar.not_connected', { rid, provider });
          warnings.push(`${provider}_not_connected`);
          continue;
        }

        const res = await fetch(cal.url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(cal.body(event)),
        });

        if (!res.ok) {
          // סטטוס בלבד: גוף השגיאה של הספק חוזר לקורא, ואינו נכתב ליומן שנשמר.
          const errText = await res.text();
          log('error', 'calendar.rejected', { rid, provider, status: res.status });
          warnings.push(`${provider}_rejected_${res.status}`);
          events.push({ provider, ok: false, details: errText });
          continue;
        }

        const data = await res.json();
        log('info', 'calendar.created', { rid, provider, eventId: data.id });
        events.push({ provider, ok: true, eventId: data.id, link: cal.link(data) });
      } catch (e) {
        log('error', 'calendar.failed', { rid, provider, err: String(e?.message ?? e).slice(0, 200) });
        warnings.push(`${provider}_failed`);
        events.push({ provider, ok: false });
      }
    }

    const created = events.filter((e) => e.ok);

    if (created.length === 0) {
      // אף יומן לא קיבל את הפגישה. 502 ולא 200-עם-אזהרה: מי שקורא לפונקציה
      // הזו רוצה לדעת שאין אירוע בשום מקום, וזה בדיוק המצב שבו שתיקה עולה
      // בפנייה שנשכחת.
      log('error', 'calendar.none_created', { rid, ms: Date.now() - startedAt, warnings });
      const details = events.map((e) => e.details).filter(Boolean).join(' | ');
      return Response.json({ error: 'שגיאת יומן', details, warnings }, { status: 502 });
    }

    log('info', 'request.end', {
      rid,
      ms: Date.now() - startedAt,
      created: created.map((e) => e.provider),
      warnings,
    });

    // eventId ו-htmlLink נשארים ברמה העליונה מהיומן הראשון שהצליח, כדי שקורא
    // שנכתב מול התשובה הקודמת ימשיך לעבוד. הפירוט המלא יושב ב-events.
    return Response.json({
      ok: true,
      eventId: created[0].eventId,
      htmlLink: created[0].link,
      events,
      warnings,
    });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String(error?.message ?? error).slice(0, 200) });
    return Response.json({ error: error.message }, { status: 500 });
  }
}
