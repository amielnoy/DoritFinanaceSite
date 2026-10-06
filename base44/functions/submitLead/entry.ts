import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';

/** שם הפונקציה כפי שהוא מופיע בכל שורת יומן שלה. */
const FN = 'submitLead';

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
 * מועד שעון-קיר ישראלי → רגע מוחלט, לעמודת timestamptz.
 *
 * scheduledAt הוא "2026-09-24T10:00:00" ללא אזור זמן, והכוונה היא 10:00
 * בישראל. שליחה כזו ל-Postgres נקראת כ-UTC ומחזירה בדיוק את ההסחה של שלוש
 * השעות שזה עתה תוקנה בכותבי היומן — רק שהפעם היא נשמרת במסד ואין לוג שיגלה.
 *
 * ישראל היא UTC+2 או UTC+3 לפי השעון הקיץ, ולכן ההיסט אינו קבוע ואי אפשר
 * לכתוב אותו. במקום לנחש: מנסים את שניהם ובוחרים את זה שחוזר לאותה שעת קיר.
 * בשעה הכפולה של סוף שעון הקיץ שתיהן מתאימות, והראשונה — ההיסט הקיצי — היא
 * הנכונה, כי היא המוקדמת מבין השתיים.
 */
function israelInstant(wall) {
  const w = String(wall || '').slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(w)) return null;
  const asUtc = Date.parse(`${w.length === 16 ? `${w}:00` : w}Z`);
  if (Number.isNaN(asUtc)) return null;
  for (const offsetHours of [3, 2]) {
    const t = asUtc - offsetHours * 3600000;
    const back = new Date(t).toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }).replace(' ', 'T');
    if (back.slice(0, 16) === w.slice(0, 16)) return new Date(t).toISOString();
  }
  return null;
}



// שני נמענים, שניהם מקבלים את הפנייה המלאה.
//
// SECONDARY_EMAIL הוא הסוכנת. NOTIFY_EMAILS הן תיבות הצוות שמתפעל את האתר מטעמה,
// ומקבל בנוסף נספח מצב על השמירה, היומן והמיילים.
//
// זה מחייב גילוי, וקיים כזה: נוסח ההסכמה ב-src/config/compliance.ts ומדיניות
// הפרטיות אומרים "אצל דורית ואצל הצוות שמתפעל את האתר מטעמה" — ולא "אצל
// דורית בלבד", שהיה הנוסח הקודם והיה הופך להצהרה לא נכונה ברגע שנשלח עותק
// החוצה. tests/contract/agents.contract.test.ts אוכף שהקוד והנוסח מסכימים,
// לשני הכיוונים: מי שיצמצם כאן את השליחה חייב להחזיר גם את הנוסח.
// כמה תיבות, אותו צוות. הרשימה קיימת כדי שתוספת תיבה תהיה שורה אחת ולא
// שכפול של הקריאה — וכדי שכשל במסירה לתיבה אחת לא ימנע את השאר.
/**
 * מי מוזמן לפגישה, בנוסף לבעל היומן.
 *
 * דורית ראשונה ברשימה, וזו תקלה שתוקנה ולא החלטה חדשה. כאן היה כתוב שהאירוע
 * נוצר ביומן של מי שאישר את המחבר, שזו דורית, ולכן היא המארגנת ואינה צריכה
 * הזמנה. ההנחה הזו לא נבדקה מעולם ולא הייתה נכונה: את מחבר `outlook` אישר
 * amielnoy@outlook.com, האירוע נוצר ביומן *שלו*, ודורית לא הייתה לא מארגנת
 * ולא מוזמנת — כלומר לא הייתה לה פגישה ביומן בכלל. ראו A-54.
 *
 * ההזמנה המפורשת מתקנת את זה בלי להיות תלויה בשאלה מי אישר את המחבר, וזה
 * העיקר: אם המחבר יחובר מחדש בשמה, היא תהיה גם המארגנת וההזמנה תהיה מיותרת
 * אך לא מזיקה. התלות היחידה שנשארת היא שהיא תאשר אותה.
 *
 * כל כתובת כאן חייבת לקבל את הפנייה עצמה בדואר — NOTIFY_EMAILS או
 * SECONDARY_EMAIL. זה גילוי, לא נוחות: אסור להזמין לפגישה מי שלא ראה את
 * הפנייה שהולידה אותה. tests/contract/agents.contract.test.ts אוכף בדיוק את
 * זה, ונכשל כשהרשימות מתפצלות — תיבה שנוספה לאחת ולא לשנייה אינה מרימה שגיאה
 * בשום מקום, היא פשוט מקבלת פחות.
 */
const CALENDAR_ATTENDEES = [
  "dorit@govari-fin.co.il",
  "amielnoy@gmail.com",
  "amielnoy@outlook.com",
];

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
 *   - **שליחת הזמנה.** Graph שולח הזמנה למשתתפים מעצמו. Google לא שולח דבר
 *     אלא אם מבקשים `sendUpdates=all` בכתובת — בלי זה המשתתף נוסף לאירוע,
 *     ההזמנה לא יוצאת, והיומן שלו נשאר ריק בלי ששום שגיאה נאמרת.
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
      attendees: CALENDAR_ATTENDEES.map((address) => ({
        emailAddress: { address },
        type: 'required',
      })),
      isReminderOn: true,
      reminderMinutesBeforeStart: 60,
    }),
    link: (data) => data.webLink,
  },
  google: {
    connector: 'googlecalendar',
    url: 'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all',
    body: ({ summary, description, startIso, endIso }) => ({
      summary,
      description,
      start: { dateTime: startIso, timeZone: 'Asia/Jerusalem' },
      end: { dateTime: endIso, timeZone: 'Asia/Jerusalem' },
      attendees: CALENDAR_ATTENDEES.map((email) => ({ email })),
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

const NOTIFY_EMAILS = ["amielnoy@gmail.com", "amielnoy@outlook.com"];

// מי מהם אפשר להגיע אליו דרך Core של Base44.
//
// Core מוסרת אך ורק למשתמש רשום של האפליקציה, ורישום אינו דבר שאפשר להוסיף
// בצד: הוא נוצר כשהכתובת נכנסת לאפליקציה עצמה. לכן הרשימה הזו אינה "מי בצוות"
// אלא "למי הפלטפורמה מסוגלת למסור", והיא מכוונת להצטמצם לאפס — כל כתובת שעוברת
// לשירות הדואר מפסיקה להיות תלויה בחשבון.
//
// כל השאר — הסוכנת, התיבה השנייה והמבקר — עוברים דרך dorit-mailer.
const CORE_EMAILS = ["amielnoy@gmail.com"];

// Include a safe delivery reason in the operations notification.
function deliveryWarning(label, error) {
  const reason = String(error?.message ?? error ?? '').slice(0, 300);
  return reason ? `${label} (${reason})` : label;
}
const SECONDARY_EMAIL = "dorit@govari-fin.co.il";

/**
 * The one way this app sends mail, over two transports chosen by recipient.
 *
 * `CORE_EMAILS` go through Base44's own `Core.SendEmail`, which delivers only
 * to registered users of the app. Everyone else — the agency, the second
 * operations mailbox and the visitor — goes through the `dorit-mailer` Pages
 * Function, which sends from the agency's verified domain via Resend.
 *
 * The split is not about who they are, it is about what each transport can
 * reach. Core needs an account that only exists once the address has signed
 * into the app, which is a dependency worth shedding: `CORE_EMAILS` is meant
 * to shrink to nothing once the sending domain is verified.
 *
 * Two transports is what caused the original silent failure — the agency was on
 * a path that could not deliver to her and nobody noticed, because the copy
 * that *did* arrive looked like success. The split is deliberate this time and
 * each failure carries its reason, but it is worth remembering which is which
 * when only some of the three arrive.
 *
 * What travels is the finished message: these functions own the templates, the
 * escaping and `redact()` on anything a model wrote.
 */
/**
 * מה הספק שבקצה אמר, במילון סגור.
 *
 * ה-mailer מחזיר סירוב עם `failed: ["http_403"]` — הסיבה האמיתית, מ-Resend.
 * הקוד כאן זרק לפני שקרא אותה, ולכן כל מה ששרד היה "ה-mailer החזיר 502":
 * מספיק כדי לדעת שדורית לא קיבלה את הסיכום, לא מספיק כדי לדעת למה. בפועל זה
 * הבדל בין תיקון של חמש דקות לבין בוקר שלם.
 *
 * זה אינו חשיפה של גוף תשובה: הערכים הם אוצר מילים סגור — `http_<status>`,
 * `no_message_id`, `network_error` — ומה שאינו תואם לו נזרק. אין כאן טקסט
 * חופשי מהספק ואין אישורי גישה.
 *
 * משוכפלת בכל פונקציה ששולחת דואר בכוונה — אין מודול משותף ב-Base44.
 * משוכפל זה בסדר, מפוצל זה לא.
 */
function upstreamReasons(result) {
  const reasons = Array.isArray(result?.failed) ? result.failed : [];
  const safe = [...new Set(reasons.filter(
    (r) => typeof r === 'string' && /^(http_\d{3}|no_message_id|network_error)$/.test(r)
  ))];
  return safe.length ? `:${safe.join(',')}` : '';
}

async function sendMail({ base44, to, subject, html, text, body, rid, role }) {
  // התפקיד ולא הכתובת. אחד הנמענים הוא המבקר עצמו, וכתובתו לא תיכתב ליומן
  // שנשמר לאורך זמן — `role` מספיק כדי לדעת איזה עותק לא יצא.
  const started = Date.now();
  if (CORE_EMAILS.includes(to)) {
    // `html` and `body` are alternatives, not companions: passing both makes
    // Base44 reject the whole call with "SendEmail accepts only …", and the
    // rejection is a validation error rather than a delivery failure — so the
    // enquiry is saved, a warning is recorded, and nobody is told. That is what
    // stopped the operations copy arriving after the transports were split.
    const plain = text ?? body;
    await base44.asServiceRole.integrations.Core.SendEmail(
      html ? { to, subject, html, text: plain } : { to, subject, body: plain },
    );
    log('info', 'mail.sent', { rid, role, transport: 'core', ms: Date.now() - started });
    return;
  }

  const endpoint = Deno.env.get('MAILER_URL')?.trim();
  const token = Deno.env.get('MAILER_TOKEN')?.trim();
  if (!endpoint || !token) throw new Error('mailer_not_configured');

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'rendered',
        to,
        subject,
        html,
        text: text ?? body,
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error('mailer_network_error');
  }
  // Never surface provider response bodies or credentials in public warnings —
  // only the closed vocabulary `upstreamReasons` allows through. The body is
  // read before the status is judged, because on a refusal it is the only place
  // the cause exists.
  const result = await response.json().catch(() => null);
  const why = upstreamReasons(result);
  if (!response.ok) throw new Error(`mailer_http_${response.status}${why}`);
  if (!result?.ok) throw new Error(`mailer_rejected${why}`);
  // A 200 can still carry refusals: one recipient was accepted and another was
  // not. Reporting that as a clean send is how a copy goes missing with every
  // indicator green.
  if (why) log('warn', 'mail.partial', { rid, role, transport: 'mailer', why: why.slice(1) });
  log('info', 'mail.sent', { rid, role, transport: 'mailer', ms: Date.now() - started });
}


/**
 * הסרת מזהים רגישים מתקציר שנכתב על ידי מודל.
 *
 * משוכפל מ-escalateToHuman/entry.ts בכוונה: כל פונקציה ב-Base44 היא נקודת
 * כניסה עצמאית ואין ביניהן מודול משותף. שתי העותקות חייבות להישאר זהות —
 * tests/contract/agents.contract.test.ts נכשל אם אחת מהן מתפצלת.
 */
function redact(text) {
  if (!text) return '';
  return String(text)
    .replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, '[הושמט — מספר כרטיס]')
    .replace(/\bIL\d{2}[A-Z0-9]{17,}\b/gi, '[הושמט — חשבון בנק]')
    .replace(/\b\d{9}\b/g, '[הושמט — מספר מזהה]')
    .replace(/\b\d{6,8}\b/g, '[הושמט — מספר]')
    .slice(0, 2000);
}

// ── יומן האירועים בגיליון Google ──────────────────────────────────────────
//
// מזהה הגיליון מתוך כתובת ה-URL שלו:
//   https://docs.google.com/spreadsheets/d/<המזהה>/edit
// ריק = הרישום מדולג בשקט, כדי שהתקנה בלי גיליון תמשיך לעבוד.
//
// זהו עותק שלישי של פרטי המבקר, אחרי המאגר והמיילים, והיחיד שאינו נמחק על ידי
// מחיקת רשומה במאגר. ראו את ההערה על שמירה ב-base44/agents/COMPLIANCE.md §6.
// מזהה הגיליון מגיע מהסביבה ולא מהקוד: המאגר ציבורי, ופריסה בלי גיליון צריכה
// להמשיך לעבוד. ריק = הרישום מדולג בשקט ומדווח כ"לא מוגדר" בנספח התפעולי.
const SHEET_ID = (Deno.env.get('SHEET_ID') || '').trim();
const SHEET_TAB = (Deno.env.get('SHEET_TAB') || 'Events').trim();

/**
 * סדר העמודות בגיליון.
 *
 * משוכפל בכל פונקציה שכותבת ליומן, ו-tests/contract/agents.contract.test.ts
 * נכשל אם שתי הרשימות מתפצלות — שורה שנכתבת בסדר אחר הורסת את הגיליון בשקט,
 * בלי שדבר ייכשל.
 */
// ── עמודות גיליון האירועים ────────────────────────────────────────────────
//
// שש האחרונות נוספו אחרי שהתברר מה הגיליון לא יכול לענות עליו. ראיון אוסף
// שמונה שדות מובנים, וכולם נדחסו לתא 'תקציר' אחד — טקסט חופשי שאי אפשר לסנן,
// למיין או לספור. דורית לא יכלה לשאול "מי מעוניין בשליפה מהמסלקה?" או "כמה
// ראיונות הושלמו במלואם?", שתי שאלות שהגיליון קיים בשבילן.
//
// נוספו בסוף ולא באמצע, כדי ששורות קיימות יישארו מיושרות מול הכותרות.
//
// ארבע מהן הן INTERVIEW_COMMON — השדות שנשאלים בכל ראיון ולכן השוואתיים בין
// ראיונות. שדות ייחודיים למסלול נשארים ב'תקציר': הם שונים ממסלול למסלול,
// ועמודה שמלאה רק בשליש מהשורות גרועה מטקסט.
const SHEET_COLUMNS = [
  'מועד', 'סוג האירוע', 'מקור', 'מסלול', 'סוכן', 'נושא', 'מועד מבוקש',
  'שם', 'טלפון', 'אימייל', 'מזהה רשומה', 'סיבת העברה', 'תקציר',
  'מועד הפגישה', 'שלב חיים', 'יעד עיקרי', 'דאגה מרכזית', 'מסלקה', 'שלמות',
];

/**
 * שיקוף הפנייה ל-Supabase. לעולם לא זורק.
 *
 * Base44 הוא המקור הסמכותי בשלב הזה: הפנייה כבר נשמרה לפני שמגיעים לכאן, וכשל
 * בשיקוף הוא עניין של התאמה בין שני מאגרים — לא של פנייה שאבדה. לכן הוא נרשם
 * ביומן ואינו מחזיר שגיאה למבקר, שאצלו הכל הצליח.
 *
 * `on_conflict=base44_id` עם merge-duplicates: מסלול הראיון מעדכן רשומה קיימת
 * במקום ליצור חדשה, ואותה קריאה משרתת את שני המסלולים בלי לדעת מי מהם קרא לה.
 *
 * מפתח השירות עוקף RLS. זה נדרש: קריאת העדכון של ראיון פתוח חסומה למנהלים
 * בלבד, ולפונקציה אין משתמש מחובר מאחוריה.
 */
async function mirrorLeadToSupabase(rid, base44Id, row) {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  // לא מוגדר — אין שיקוף. נרשם ולא שותק: יציאה שקטה כאן נראית בדיוק כמו שיקוף
  // שהצליח, והיא מה שהפך פנייה חסרה ב-Supabase לחקירה במקום לשורה ביומן.
  if (!url || !key || !base44Id) {
    log('warn', 'lead.mirror_skipped', { rid, hasUrl: Boolean(url), hasKey: Boolean(key), hasId: Boolean(base44Id) });
    return;
  }

  try {
    const res = await fetch(`${url}/rest/v1/leads?on_conflict=base44_id`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ ...row, base44_id: base44Id }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 140)}`);
    log('info', 'lead.mirrored', { rid, base44Id });
  } catch (e) {
    log('warn', 'lead.mirror_failed', { rid, base44Id, err: String(e?.message ?? e).slice(0, 200) });
  }
}

/**
 * שיקוף הפגישה ל-Supabase. לעולם לא זורק, בדיוק כמו שיקוף הפנייה.
 *
 * `on_conflict=lead_base44_id` עם merge-duplicates: הראיון כותב פעמיים — פעם
 * כשסוכם המועד ופעם אחרי שהיומן ענה — ושתי הקריאות נוחתות על אותה שורה. לכן
 * גם אין כאן דריסה בריק: נשלחים רק השדות שהקריאה הזו באמת יודעת עליהם.
 *
 * ה-FK אל leads(base44_id) אומר שהפנייה חייבת להיות משוקפת קודם. היא כן —
 * mirrorLeadToSupabase רץ לפני — ואם היא נכשלה, גם זה ייכשל וייכתב ביומן
 * במקום להשתיק את עצמו.
 */
async function mirrorMeetingToSupabase(rid, base44Id, row) {
  const url = (Deno.env.get('SUPABASE_URL') || '').trim();
  const key = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !key || !base44Id) {
    log('warn', 'meeting.mirror_skipped', { rid, hasUrl: Boolean(url), hasKey: Boolean(key), hasId: Boolean(base44Id) });
    return;
  }

  try {
    const res = await fetch(`${url}/rest/v1/meetings?on_conflict=lead_base44_id`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ ...row, lead_base44_id: base44Id }),
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 140)}`);
    log('info', 'meeting.mirrored', { rid, base44Id, scheduled: Boolean(row.scheduled_at) });
  } catch (e) {
    log('warn', 'meeting.mirror_failed', { rid, base44Id, err: String(e?.message ?? e).slice(0, 200) });
  }
}

/** הוספת שורה אחת ליומן. מחזירה מחרוזת מצב לנספח התפעולי. */
async function appendEventRow(base44, row) {
  if (!SHEET_ID) return 'לא מוגדר';
  const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlesheets');
  if (!accessToken) return 'אין חיבור';

  // שם העמודה האחרונה. `String.fromCharCode(64 + n)` עבד עד 26 ואז התחיל
  // לייצר תווים שאינם אותיות — טווח פגום, ובקשה שנדחית. בראיון יש כבר 19
  // עמודות, וזה קרוב מכדי להשאיר כך.
  let lastColumn = '';
  for (let n = SHEET_COLUMNS.length; n > 0; ) {
    const r = (n - 1) % 26;
    lastColumn = String.fromCharCode(65 + r) + lastColumn;
    n = (n - r - 1) / 26;
  }

  // USER_ENTERED מפרש כל תא כאילו אדם הקליד אותו, ולכן '0549988754' נשמר
  // כמספר 549988754 — האפס המוביל אובד, והטלפון הופך לבלתי שמיש. בגיליון,
  // שהוא העותק ששורד מחיקת רשומה, זו אבדת מידע ולא עניין של תצוגה. גרש מוביל
  // אומר ל-Sheets "זה טקסט" ואינו נראה בתא.
  const cells = row.map((v) => {
    const s = v == null ? '' : String(v);
    return /^0\d+$/.test(s) ? `'${s}` : s;
  });

  const range = `${SHEET_TAB}!A:${lastColumn}`;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}` +
      `:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [cells] }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!res.ok) throw new Error(`sheets ${res.status}`);
  // הסטטוס נושא את הקישור, כמו המסמך. עד כה הוא אמר שהשורה נכתבה ולא לאן,
  // ומי שרצה לראות אותה חיפש את הגיליון לבד.
  return `נרשם ✓ — https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
}

/**
 * יצירת מסמך סיכום ב-Google Docs. מיטבי, כמו היומן והגיליון.
 *
 * המסמך הוא עותק נוסף של הפנייה — אחרי המאגר, המיילים, היומן והגיליון — ונועד
 * למי שמעדיף לקרוא סיכומים ב-Docs או לשמור אותם לתיק. התוכן זהה למייל שדורית
 * מקבלת (buildAgentBody), והכותרת זהה לנושא המייל. המסמך נוצר ב-Drive של
 * החשבון המחובר, והקישור אליו נשלח בנספח התפעולי.
 *
 * משוכפלת בכל פונקציה שכותבת ל-Docs בכוונה — אין מודול משותף ב-Base44.
 * משוכפל זה בסדר, מפוצל זה לא.
 */
async function createConsultationDoc(base44, rid, source, data) {
  const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledocs');
  if (!accessToken) return 'אין חיבור';

  const title = subjectFor(source, data);
  const createRes = await fetch('https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
    // מוגבל בזמן — ראו ההערה ליד ההודעה לדורית.
    signal: AbortSignal.timeout(10000),
  });
  if (!createRes.ok) throw new Error(`docs create ${createRes.status}`);
  const { documentId } = await createRes.json();

  // התוכן המלא של הפנייה — אותו טקסט שיוצא במייל לדורית.
  const text = buildAgentBody(source, data);
  const updateRes = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{ insertText: { location: { index: 1 }, text } }],
    }),
    // מוגבל בזמן — ראו ההערה ליד ההודעה לדורית.
    signal: AbortSignal.timeout(10000),
  });
  if (!updateRes.ok) throw new Error(`docs update ${updateRes.status}`);

  log('info', 'doc.created', { rid, documentId });
  return `נוצר ✓ — https://docs.google.com/document/d/${documentId}/edit`;
}

/** סוג האירוע כפי שהוא נרשם בגיליון — הערך שמאפשר לסנן את הגיליון לפי סוג. */
function eventTypeFor(source) {
  if (source === 'consultation') return 'consultation_request';
  if (source === 'detailed') return 'detailed_enquiry';
  if (source === 'interview') return 'interview_summary';
  return 'quick_contact';
}

/** נספח תפעולי — מה עלה בגורלם של השמירה, היומן והמיילים. */
/**
 * הקישורים לעותקים, בטקסט. התאום של linksBlock, ובדיוק מאותה סיבה שיש תאום
 * לכל גוף מייל כאן: לקוח דואר שאינו מציג HTML מקבל את אותו תוכן ולא פחות
 * ממנו — וקישור שקיים רק בגרסת ה-HTML הוא בדיוק מה שנעלם בלי להשמיע קול.
 *
 * linkIn מחזיר כלום כששורת המצב אומרת "לא נרשם" או "לא נוצר", ולכן הכשל
 * נראה כהיעדר הקישור, לא כקישור שבור.
 */
function buildLinksFooter({ sheet, doc }) {
  const rows = [
    ['סיכום השיחה', doc],
    ['יומן האירועים', sheet],
  ].filter(([, v]) => linkIn(v));
  if (!rows.length) return '';
  return [`── קישורים ──`, ...rows.map(([label, v]) => `${label}: ${linkIn(v)}`)].join('\n');
}

function buildOpsFooter(source, { leadId, topic, calendar, sheet, doc, warnings }) {
  return [
    `── מצב תפעולי ──`,
    `מקור: ${source || 'quick'}`,
    `נושא: ${topic || '—'}`,
    `מזהה רשומה: ${leadId || '—'}`,
    `יומן: ${calendar}`,
    `גיליון: ${sheet}`,
    `מסמך: ${doc}`,
    `תקלות: ${warnings.length ? warnings.join(', ') : 'אין'}`,
  ].join('\n');
}

/**
 * כותרת ההודעה הפנימית, לפי מקור הפנייה.
 *
 * הוצאה החוצה כשנוסף מקור רביעי: buildAgentBody ו-buildAgentHtml החזיקו כל אחת
 * עותק של אותה שרשרת תנאים, ומקור שנוסף רק לאחת מהן היה שולח מייל שכותרתו
 * אומרת דבר אחד וגופו דבר אחר.
 */
// ── סכימת ראיון ההיכרות ───────────────────────────────────────────────────
//
// עד כאן הראיון הסתיים בפסקת טקסט חופשי שהמודל ניסח. זה קריא, אבל אינו ניתן
// להשוואה בין ראיונות, ומה שנאסף השתנה משיחה לשיחה לפי מה שהמודל בחר לזכור.
// כאן הוא מוסר שדות בעלי שם, והפונקציה היא שמחליטה מה נכנס למייל: מפתח שאינו
// ברשימה נזרק, ולכן שדה שהמודל המציא אינו יכול להגיע לדורית או למאגר.
//
// המסלול נגזר מהיעד שהמבקר תיאר, ולכן השאלות הנשאלות משתנות איתו.

const INTERVIEW_COMMON = [
  ['life_stage', 'שלב חיים'],
  ['goal', 'יעד עיקרי'],
  ['concern', 'דאגה מרכזית'],
  // שליפת נתונים מהמסלקה הפנסיונית — דגל בלבד: "מעוניין/ת" או "לא".
  //
  // דורית יכולה להגיע לפגישה עם תמונת מצב פנסיונית מלאה במקום לבנות אותה
  // מהזיכרון של המבקר, וזה משנה את איכות הפגישה הראשונה. מה שהשליפה מחייבת
  // הוא ייפוי כוח חתום — לא מספר זהות: המסלקה פועלת מכוח חוק הפיקוח על
  // שירותים פיננסיים (ייעוץ, שיווק ומערכת סליקה פנסיונית), התשס״ה-2005,
  // ומשיבה לבעל רישיון רק כשהבקשה נושאת את הרשאת הלקוח.
  //
  // ולכן הראיון אוסף כאן כוונה ולא מזהה. ת״ז שתוקלד בצ׳אט לא תקדם את השליפה
  // באף שלב — היא רק תניח מספר זהות ברשומה, בשלוש תיבות דואר ובגיליון, אחרי
  // שהמבקר אישר נוסח שאומר לו במפורש לא למסור אותה. החתימה נאספת על ידי
  // דורית, בערוץ שנועד לכך.
  ['clearinghouse', 'שליפת נתוני מסלקה — מעוניין/ת'],
];

const INTERVIEW_TRACKS = {
  pension: {
    label: 'פנסיה, גמל והשתלמות',
    fields: [
      ['employer', 'מעסיק / מעמד תעסוקתי'],
      ['seniority', 'ותק'],
      ['products', 'מוצרים קיימים'],
      ['fees', 'דמי ניהול — כפי שנמסר על ידי המבקר'],
    ],
  },
  insurance: {
    label: 'ביטוחי חיים ובריאות',
    fields: [
      ['dependents', 'תלויים'],
      ['mortgage', 'משכנתא'],
      // דגל בלבד: "יש נושא בריאותי לדיון" / "אין". פירוט רפואי אינו נאסף
      // ואינו נשמר — ראו את ההערה על מידע רגיש ליד buildInterviewProfile.
      ['health_flag', 'סוגיה בריאותית לפגישה'],
      ['coverage', 'כיסויים קיימים'],
    ],
  },
  retirement: {
    label: 'פרישה וקיבוע זכויות',
    fields: [
      ['retirement_horizon', 'אופק הפרישה'],
      ['employment_status', 'מעמד תעסוקתי נוכחי'],
      ['rights_fixing', 'קיבוע זכויות — האם נעשה'],
      ['severance_history', 'פיצויים — האם נמשכו בעבר'],
    ],
  },
  tax: {
    label: 'מיסוי ופיננסים',
    fields: [
      ['tax_event', 'האירוע המיסויי שמעסיק'],
      ['filing_status', 'הגשת דוח שנתי'],
      ['prior_handling', 'האם טופל בעבר על ידי גורם מקצועי'],
      ['products', 'מוצרים קיימים'],
    ],
  },
  savings: {
    label: 'חיסכון לטווח',
    fields: [
      ['horizon', 'טווח החיסכון'],
      ['purpose', 'ייעוד הכסף'],
      ['existing_savings', 'אפיקים קיימים'],
      ['liquidity', 'צורך בנזילות'],
    ],
  },
  self_employed: {
    label: 'עצמאים',
    fields: [
      ['business_type', 'תחום העיסוק'],
      ['years_active', 'ותק בעסק'],
      ['pension_status', 'פנסיה לעצמאים'],
      ['study_fund_status', 'קרן השתלמות לעצמאים'],
    ],
  },
  general: {
    label: 'הקשר כללי',
    fields: [
      ['products', 'מוצרים קיימים'],
      ['notes', 'מה עוד המבקר רצה לשתף'],
    ],
  },
};

// ── ראיון אחד, רשומה אחת ──────────────────────────────────────────────────
//
// הסוכן מוסר את הראיון פעמיים: פעם אחת ברגע שיש שם, טלפון ויעד — לפני שאלות
// המסלול — ופעם שנייה בסיומו. הקריאה הראשונה נועדה למי שנוטש: עד כה פרטי הקשר
// נאספו אחרונים, ולכן מבקר שענה על ארבע שאלות וסגר את החלון נעלם בלי שייוותר
// דבר. עכשיו נשארת רשומה, מסומנת כ-partial.
//
// הקריאה השנייה מעדכנת את אותה רשומה במקום ליצור שנייה — וזו גם ההגנה מפני
// מבקר שמריץ את הראיון שלוש פעמים.
const INTERVIEW_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * הראיון הפתוח של אותו מספר טלפון, אם קיים בחלון הזמן.
 *
 * החיפוש מיטבי: אם הוא נכשל נוצרת רשומה חדשה, כי רשומה כפולה עדיפה על ראיון
 * שאבד. נעשה ב-asServiceRole מפני שקריאת Lead חסומה ל-RLS של מנהל בלבד.
 */
async function findOpenInterview(base44, phone) {
  if (!phone) return null;
  try {
    const found = await base44.asServiceRole.entities.Lead.filter({
      phone,
      source: 'interview',
    });
    const cutoff = Date.now() - INTERVIEW_WINDOW_MS;
    const open = (found || []).filter((lead) => {
      const at = Date.parse(lead?.created_date ?? '');
      return Number.isNaN(at) ? true : at >= cutoff;
    });
    // האחרון קודם: ריצה חוזרת מתחברת לראיון העדכני ולא לישן.
    return open.length ? open[open.length - 1] : null;
  } catch (e) {
    return null;
  }
}

/**
 * כמה מהשדות של המסלול נענו בפועל.
 *
 * בלי זה ראיון יסודי וראיון בן שתי תשובות נראים אותו דבר במבט ראשון, ואי אפשר
 * לתעדף. ההפרדה בין "נענה: לא ידוע" ל"לא נשאל" נשמרת כאן: ערך שנמסר כ"לא ידוע"
 * נספר כתשובה — זו אינפורמציה על המבקר — ושדה חסר אינו נספר כלל.
 */
function interviewCompleteness(rows, track) {
  const total = interviewFields(track).length;
  const answered = rows.length;
  const unknown = rows.filter(([, value]) => /^לא ידוע/.test(String(value))).length;
  return { answered, total, unknown };
}

/** "5 מתוך 7 שדות נענו · 2 מהם לא ידועים למבקר" */
function completenessLine({ answered, total, unknown }) {
  const base = `${answered} מתוך ${total} שדות נענו`;
  return unknown ? `${base} · ${unknown} מהם לא ידועים למבקר` : base;
}

/** סדר השדות של מסלול, כולל המשותפים. מסלול לא מוכר מקבל את המשותפים בלבד. */
function interviewFields(track) {
  const chosen = INTERVIEW_TRACKS[track];
  return chosen ? [...INTERVIEW_COMMON, ...chosen.fields] : [...INTERVIEW_COMMON];
}

/**
 * הפרופיל שהמודל מסר, מסונן לשדות המוכרים בלבד ומנוקה ממזהים.
 *
 * זהו הגבול בין מה שהמודל כתב לבין מה שיוצא מכאן. כל ערך עובר redact() —
 * הסוכן מונחה לא לרשום מזהים, אבל הפרופיל נכתב על ידי מודל ששמע את המבקר
 * מקליד אותם. שדה ריק מושמט ואינו מוצג כמקף.
 */
/**
 * ערך שדה מתוך הפרופיל, לפי התווית.
 *
 * `buildInterviewProfile` מחזיר זוגות [תווית, ערך] ולא אובייקט — התווית היא
 * מה ששורד עד לכאן, והמפתח המקורי כבר לא. חיפוש לפי תווית נראה שביר, ולכן
 * agents.contract.test.ts מוודא שכל תווית שמבוקשת כאן קיימת בסכימה.
 */
function profileValue(pairs, label) {
  const hit = (pairs || []).find(([l]) => l === label);
  return hit ? hit[1] : '';
}

function buildInterviewProfile(profile, track) {
  const given = profile && typeof profile === 'object' ? profile : {};
  return interviewFields(track)
    .map(([key, label]) => [label, redact(given[key])])
    .filter(([, value]) => value);
}

/**
 * ההצהרה שמתלווה לכל ראיון.
 *
 * הראיון נראה כמו בירור צרכים ואינו בירור צרכים, וההבדל הזה הוא רגולטורי ולא
 * סגנוני. הוא נאמר למבקר בפתיחת השיחה; זה העותק שנוסע עם הסיכום, כדי שגם מי
 * שקורא אותו בדיעבד — דורית, או בודק מטעמה — יראה מה המסמך הזה אינו.
 */
const INTERVIEW_DECLARATION =
  'הסיכום נאסף על ידי עוזר אוטומטי, שאוסף מידע בלבד. אין בו ייעוץ, שיווק פנסיוני ' +
  'או המלצה, והוא אינו בירור צרכים — בירור הצרכים נעשה על ידי דורית בפגישה, כנדרש בדין. ' +
  'הפרטים נמסרו על ידי המבקר ולא אומתו.';

function eyebrowFor(source) {
  return source === 'interview' ? 'ראיון היכרות' : 'פנייה מהאתר';
}

/**
 * מאיזה מכשיר נשלחה הפנייה.
 *
 * נגזר מ-User-Agent של הבקשה, ולא ממשהו שהדפדפן מוסר בגוף הפנייה: זה מגיע
 * מאותה בקשה שיצרה את הפנייה, ואין טופס שיכול לשקר עליו בטעות.
 *
 * תווית ולא המחרוזת המלאה. ל-User-Agent אין מה לחפש במייל שנשמר שנים, והשאלה
 * שהוא עונה עליה כאן היא "מהטלפון או מהמחשב" — לא איזו גרסת דפדפן.
 *
 * iPadOS מדווח על עצמו כ-Macintosh, ולכן אייפד ללא בקשת אתר-שולחן ייספר
 * כ-Mac. עדיף מלנחש: תווית שגויה גרועה מתווית כללית.
 */
function deviceLabel(ua) {
  const s = String(ua || '');
  if (!s) return 'לא ידוע';
  if (/Android/i.test(s)) return 'אנדרואיד';
  if (/iPhone/i.test(s)) return 'אייפון';
  if (/iPad/i.test(s)) return 'אייפד';
  if (/Macintosh|Mac OS X/i.test(s)) return 'מחשב Mac';
  if (/Windows/i.test(s)) return 'מחשב Windows';
  if (/Linux/i.test(s)) return 'מחשב Linux';
  return 'לא ידוע';
}

function headingFor(source) {
  if (source === 'consultation') return 'בקשת ייעוץ חדשה';
  if (source === 'detailed') return 'פנייה מפורטת מהאתר';
  if (source === 'interview') return 'סיכום ראיון היכרות';
  return 'פנייה חדשה מהאתר';
}

function buildAgentBody(source, data) {
  const header = headingFor(source);
  const lines = [
    `${header} — ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`,
    ``,
    `שם: ${data.name}`,
    `טלפון: ${data.phone}`,
    `אימייל: ${data.email || '—'}`,
    `נשלח מ: ${data.device || 'לא ידוע'}`,
  ];
  if (source === 'consultation') {
    lines.push(`תחום ייעוץ: ${data.topic || '—'}`);
    lines.push(`מועד מבוקש: ${data.timing || 'לפי תיאום'}`);
    lines.push(`הערות: ${data.notes || '—'}`);
  } else if (source === 'detailed') {
    lines.push(`שירות מבוקש: ${data.topic || '—'}`);
    lines.push(`מועד מועדף ליצירת קשר: ${data.timing || '—'}`);
    lines.push(``, `הודעה אישית:`, data.message || '—');
  } else if (source === 'interview') {
    lines.push(`מסלול: ${data.trackLabel || '—'}`);
    lines.push(`נושא הפגישה: ${data.topic || '—'}`);
    lines.push(`מועד מבוקש: ${data.timing || 'לפי תיאום'}`);
    lines.push(``, `פרופיל המבקר (כפי שאישר אותו בשיחה):`);
    if (data.profile && data.profile.length) {
      for (const [label, value] of data.profile) lines.push(`${label}: ${value}`);
    } else {
      lines.push(data.message || '—');
    }
    if (data.completeness) lines.push(`שלמות: ${completenessLine(data.completeness)}`);
    lines.push(``, `— ${INTERVIEW_DECLARATION}`);
  } else {
    lines.push(``, `הודעה:`, data.message || '—');
  }
  if (data.summary) {
    lines.push(``, `תקציר השיחה (לאחר השמטת פרטים רגישים):`, data.summary);
  }
  return lines.join('\n');
}

// ── ההודעה הפנימית, בעיצוב של האתר ────────────────────────────────────────
//
// buildAgentBody לבדו נשלח כ-`body`, ו-Gmail מקפל אותו לפסקה אחת: שמונה שדות,
// שם, טלפון, נושא, מועד והנספח התפעולי — הכל בשורה רצה אחת. פנייה חדשה היא
// הדבר שדורית צריכה לקרוא בשנייה אחת בטלפון, וזה בדיוק מה שלא היה אפשרי.
//
// אותו מידע, ללא שינוי, בארבעה בלוקים מופרדים: מי פנה, מה ביקש, תקציר השיחה
// (אם יש) והמצב התפעולי. הפלטה זהה לזו של buildClientHtml למטה — שני המיילים
// יוצאים מאותה כתובת ונראים כמו אותה סוכנות.
//
// The plain text goes out as `text` alongside it, unchanged: a client that
// cannot render HTML still gets every field, and `buildAgentBody` stays the
// single definition of what a notification contains.

/** לוח הצבעים של המיילים — אותם ערכים כמו src/index.css, בקוד שאינו רואה טוקנים. */
const MAIL = {
  page: '#F9F7F2',      // --background · Warm Parchment
  card: '#FFFFFF',
  panel: '#F6F1EA',
  ink: '#1A1A1B',       // --foreground · Obsidian Matte
  body: '#3D3D3F',
  muted: '#7D6B5D',     // --accent · Deep Taupe
  border: '#E5DDD0',
  panelBorder: '#E0D4C6',
  rule: '#C3AD96',      // --highlight-muted
  alert: '#EF4444',     // --destructive
};

/** שורת "תווית: ערך" אחת בתוך בלוק. */
/**
 * פיצול שורת מצב לכותרת ולקישור.
 *
 * שורות המצב של היומן, הגיליון והמסמך נושאות כתובת בתוך הטקסט — הגרסה הטקסטואלית
 * של המייל צריכה אותה שם, כי אין בה מקום אחר לשים אותה. בגרסת ה-HTML כתובת
 * מלאה בתוך תא טבלה היא שורה ארוכה שאי-אפשר ללחוץ עליה, ולכן כאן היא נעשית
 * הקישור של התא והטקסט נשאר קצר.
 */
const linkIn = (value) => (String(value || '').match(/https?:\/\/\S+/) || [''])[0];
const statusOf = (value) => String(value || '').replace(/\s*—\s*https?:\/\/\S+/, '').trim();

function detailRow(label, value, { link = '', last = false } = {}) {
  const shown = escapeHtml(value || '—');
  const cell = link
    ? `<a href="${escapeHtml(link)}" style="color:${MAIL.ink}; text-decoration:none;">${shown}</a>`
    : shown;
  const divider = last
    ? ''
    : `<tr><td colspan="2" style="padding:0; font-size:0; line-height:0; border-top:1px solid ${MAIL.panelBorder};">&nbsp;</td></tr>`;
  return `
              <tr>
                <td style="padding:9px 0; font-size:13px; color:${MAIL.muted}; font-family:Arial,sans-serif; width:120px; text-align:right; vertical-align:top;">${escapeHtml(label)}</td>
                <td style="padding:9px 0; font-size:15px; color:${MAIL.ink}; font-family:Arial,sans-serif; font-weight:bold; text-align:right;">${cell}</td>
              </tr>${divider}`;
}

/** בלוק אחד: כותרת קטנה ומסגרת סביב תוכן. */
function block(title, inner, { tone = 'panel' } = {}) {
  const bg = tone === 'plain' ? MAIL.card : MAIL.panel;
  const edge = tone === 'alert' ? MAIL.alert : MAIL.panelBorder;
  return `
        <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px; background:${bg}; border:1px solid ${edge}; border-radius:6px;">
          <tr><td style="padding:22px 26px;">
            <p style="margin:0 0 14px; font-size:11px; letter-spacing:0.22em; text-transform:uppercase; color:${MAIL.muted}; font-family:Arial,sans-serif; text-align:right;">${escapeHtml(title)}</p>
            <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%">${inner}
            </table>
          </td></tr>
        </table>`;
}

/** פסקת טקסט חופשי בתוך בלוק — הודעה, הערות, תקציר. */
function proseRow(text) {
  return `
              <tr><td style="padding:2px 0 0; font-size:15px; color:${MAIL.body}; font-family:Arial,sans-serif; line-height:1.8; text-align:right; white-space:pre-line;">${escapeHtml(text || '—')}</td></tr>`;
}

/**
 * ההודעה הפנימית כ-HTML. `ops` הוא הנספח התפעולי, ונשלח רק לצוות —
 * דורית מקבלת את אותה הודעה בלעדיו.
 */
function buildAgentHtml(source, data, ops, links = null) {
  const heading = headingFor(source);

  // 1 · מי פנה. טלפון ואימייל כקישורים — זו ההודעה שפותחים בטלפון כדי לחייג.
  const who = block('מי פנה', [
    detailRow('שם', data.name),
    detailRow('טלפון', data.phone, { link: `tel:${String(data.phone || '').replace(/[^\d+]/g, '')}` }),
    detailRow('אימייל', data.email, { link: data.email ? `mailto:${data.email}` : '' }),
    detailRow('נשלח מ', data.device || 'לא ידוע', { last: true }),
  ].join(''));

  // 2 · מה ביקש. השדות משתנים לפי מקור הפנייה, בדיוק כמו בגרסת הטקסט.
  let what;
  if (source === 'consultation') {
    what = block('הבקשה', [
      detailRow('תחום ייעוץ', data.topic),
      detailRow('מועד מבוקש', data.timing || 'לפי תיאום'),
      detailRow('הערות', data.notes, { last: true }),
    ].join(''));
  } else if (source === 'detailed') {
    what = block('הבקשה', [
      detailRow('שירות מבוקש', data.topic),
      detailRow('מועד מועדף', data.timing, { last: true }),
    ].join('')) + block('הודעה אישית', proseRow(data.message));
  } else if (source === 'interview') {
    // הראיון אינו בקשה אלא פרופיל. השדות קבועים ונגזרים מהמסלול, ולכן שני
    // ראיונות באותו מסלול נקראים אותו דבר ואפשר להשוות ביניהם.
    const rows = data.profile ?? [];
    what = block('הראיון', [
        detailRow('מסלול', data.trackLabel),
        detailRow('שלמות', data.completeness ? completenessLine(data.completeness) : ''),
        detailRow('נושא הפגישה', data.topic),
        detailRow('מועד מבוקש', data.timing || 'לפי תיאום', { last: true }),
      ].join(''))
      + block(
          'פרופיל המבקר · כפי שאישר אותו בשיחה',
          rows.length
            ? rows.map(([label, value], i) =>
                detailRow(label, value, { last: i === rows.length - 1 })).join('')
            : proseRow(data.message),
        )
      // ההצהרה אחרונה ובנימה שקטה: היא מסייגת את מה שמעליה, ולכן היא באה אחריו.
      + block('מה המסמך הזה אינו', proseRow(INTERVIEW_DECLARATION));
  } else {
    what = block('הודעה', proseRow(data.message));
  }

  // 3 · תקציר השיחה, רק כשסוכן אוטומטי מסר אחד. כבר עבר redact.
  const summary = data.summary
    ? block('תקציר השיחה · לאחר השמטת פרטים רגישים', proseRow(data.summary))
    : '';

  // 4 · המצב התפעולי, רק לצוות. מסגרת אדומה כשמשהו נפל, כדי שתקלה תיראה
  //     מהמסך הראשון ולא מהשורה השביעית.
  // 4a · הקישורים לעותקים, לדורית. הנספח התפעולי כבר נושא אותם לצוות, ולכן
  //      הבלוק הזה מופיע רק כשאין נספח — אותה הודעה לא צריכה לומר פעמיים איפה
  //      נשמר הסיכום.
  const linkRows = links
    ? [
        ['סיכום השיחה', links.doc],
        ['יומן האירועים', links.sheet],
      ].filter(([, v]) => linkIn(v))
    : [];
  const linksBlock = linkRows.length
    ? block('קישורים', linkRows.map(([label, v], i) =>
        detailRow(label, 'לפתיחה', { link: linkIn(v), last: i === linkRows.length - 1 })).join(''))
    : '';

  const opsBlock = ops
    ? block('מצב תפעולי', [
        detailRow('מקור', ops.source || 'quick'),
        detailRow('מזהה רשומה', ops.leadId),
        detailRow('יומן', ops.calendar),
        detailRow('גיליון', statusOf(ops.sheet), { link: linkIn(ops.sheet) }),
        detailRow('מסמך', statusOf(ops.doc), { link: linkIn(ops.doc) }),
        detailRow('תקלות', ops.warnings.length ? ops.warnings.join(', ') : 'אין', { last: true }),
      ].join(''), { tone: ops.warnings.length ? 'alert' : 'panel' })
    : '';

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:${MAIL.page}; font-family:Arial,Helvetica,sans-serif; color:${MAIL.ink}; line-height:1.7; -webkit-text-size-adjust:100%;">
  <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${MAIL.page};">
    <tr><td align="center" style="padding:28px 16px;">
      <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:600px; background:${MAIL.card}; border:1px solid ${MAIL.border}; border-radius:6px; overflow:hidden;">
        <tr><td style="padding:34px 40px 24px; border-bottom:1px solid ${MAIL.border}; text-align:right;">
          <p style="margin:0 0 10px; font-size:11px; letter-spacing:0.3em; text-transform:uppercase; color:${MAIL.muted};">${escapeHtml(eyebrowFor(source))}</p>
          <h1 style="margin:0; font-family:Georgia,serif; font-size:26px; font-weight:bold; color:${MAIL.ink}; line-height:1.3; letter-spacing:-0.02em;">${escapeHtml(heading)}</h1>
          <div style="height:2px; width:44px; background:${MAIL.rule}; margin:18px 0 0;"></div>
          <p style="margin:14px 0 0; font-size:13px; color:${MAIL.muted};">${escapeHtml(new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }))}</p>
        </td></tr>
        <tr><td style="padding:26px 40px 10px;">${who}${what}${summary}${linksBlock}${opsBlock}</td></tr>
        <tr><td style="padding:20px 40px; background:${MAIL.ink}; text-align:center;">
          <p style="margin:0; font-size:11px; color:rgba(249,247,242,0.5);">הודעה אוטומטית מאתר דורית גוב ארי · אין להשיב לכתובת זו</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * מה שמשתנה בין ההודעות של submitLead — התוכן בלבד. התבנית עצמה משותפת.
 */
/**
 * הקישור לייפוי הכוח של המסלקה הפנסיונית, אם הוגדר.
 *
 * מבקר שאמר שהוא מעוניין בשליפת נתוני מסלקה צריך לחתום על ייפוי כוח — זה מה
 * שמקדם את השליפה, ולא מספר זהות שהוקלד בצ׳אט. עד כה המייל אמר לו שדורית
 * תשלח אותו, כלומר משימה ידנית שתלויה בכך שמישהו ייזכר, בין מבקר שהתלהב
 * לבין מסמך שמגיע יומיים אחר כך.
 *
 * מוגדר בסביבה ולא כאן, ומושמט כשאינו מוגדר: פריסה בלי מסמך חוזרת בדיוק
 * לנוסח הקודם במקום להבטיח קישור שאינו קיים. זה ההבדל בין תכונה שמושבתת לבין
 * מייל שמפנה לשום מקום.
 */
const POA_URL = (Deno.env.get('POA_URL') || '').trim();

function clientMailFor(source, data) {
  const firstName = (data.name || '').split(' ')[0];
  if (source === 'interview') {
    // רק למי שאמר שהוא מעוניין. 'לא' או שדה חסר — אין אזכור, ואין מסמך שנשלח
    // למי שלא ביקש אותו.
    //
    // `data.profile` כבר אינו האובייקט הגולמי אלא מערך זוגות [תווית, ערך]
    // שעבר redact, ולכן הבדיקה היא על התווית. buildInterviewProfile משמיט שדה
    // ריק, כך שעצם קיומה של השורה אומר שנשאל ונענה.
    const clearinghouseRow = (Array.isArray(data?.profile) ? data.profile : [])
      .find(([label]) => String(label).includes('מסלקה'));
    const wantsClearinghouse = Boolean(clearinghouseRow) &&
      String(clearinghouseRow[1]).startsWith('מעוניין');
    const poaOffered = wantsClearinghouse && POA_URL;
    return {
      firstName,
      eyebrow: 'אישור קבלה',
      heading: 'קיבלנו את סיכום השיחה',
      intro: poaOffered
        ? 'תודה על השיחה ועל הזמן. הסיכום שאישרתם הועבר אליי כפי שהוא, ואחזור אליכם אישית תוך יום עסקים אחד לתיאום הפגישה הראשונה. ביקשתם שאשלוף עבורכם תמונת מצב פנסיונית מהמסלקה — לשם כך נדרש ייפוי כוח חתום, והוא מצורף כאן למטה. אפשר לחתום עליו לפני הפגישה, וכך נגיע אליה עם התמונה המלאה.'
        : 'תודה על השיחה ועל הזמן. הסיכום שאישרתם הועבר אליי כפי שהוא, ואחזור אליכם אישית תוך יום עסקים אחד לתיאום הפגישה הראשונה.',
      panelTitle: 'מה נשמר',
      details: poaOffered
        ? [['נושא מרכזי', data.topic || 'הקשר כללי'], ['ייפוי כוח למסלקה', POA_URL]]
        : [['נושא מרכזי', data.topic || 'הקשר כללי']],
    };
  }
  const isConsultation = source === 'consultation';
  return {
    firstName,
    eyebrow: 'אישור קבלה',
    heading: isConsultation ? 'קיבלנו את בקשת הייעוץ' : 'קיבלנו את פנייתכם',
    intro: isConsultation
      ? 'תודה שבחרתם לשתף אותי בצרכים שלכם. הפרטים תועדו בהצלחה, ואחזור אליכם אישית תוך יום עסקים אחד לתיאום פגישה מדויקת.'
      : 'תודה שפניתם אליי. הפרטים תועדו בהצלחה, ואחזור אליכם אישית בהקדם האפשרי.',
    panelTitle: 'פרטי הבקשה',
    details: isConsultation
      ? [['תחום ייעוץ', data.topic || 'ייעוץ כללי'], ['מועד מבוקש', data.timing || 'לפי תיאום']]
      : [],
  };
}

/**
 * בריחת תווים לפני שילוב טקסט מהמבקר בגוף HTML.
 *
 * המייל הזה נשלח לכתובת שהמבקר הקליד, מהדומיין המאומת של הסוכנות, והשם והנושא
 * מגיעים ממנו. בלי בריחה אפשר להגיש טופס עם המייל של מישהו אחר ועם שם שהוא
 * בעצם תגית — והנמען מקבל מייל ממותג של דורית שמכיל קישור של התוקף. זה אינו
 * XSS בדפדפן של המבקר אלא וקטור פישינג על חשבון המוניטין של הסוכנות.
 */
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * המייל ללקוח — תבנית אחת לכל הודעה שיוצאת למבקר.
 *
 * זהו המכתב שהלקוח מקבל בשם הסוכנות, ולכן הוא צריך להיראות אותו דבר בכל פעם:
 * אישור בקשת ייעוץ, אישור פנייה ואישור דיווח תביעה. עד כאן היו שתי תבניות —
 * submitClaim החזיק עותק שנשר ממנה: בלי dir="rtl" (כלומר עמודות הפוכות בטבלת
 * הפרטים), בלי text-align, עם גוון פאנל אחר, ובלי escapeHtml על שם הלקוח.
 *
 * מה שמשתנה בין הודעה להודעה הוא תוכן ולא עיצוב, ולכן הוא נכנס כפרמטרים:
 * כותרת קטנה, כותרת, פסקת פתיחה ורשימת שדות. ההודעה עצמה זהה.
 *
 * One letter, three messages. Base44 gives these entry points no shared module,
 * so this function is duplicated by hand — and tests/contract/agents.contract.test.ts
 * fails when the copies stop being identical. Duplicated is fine; drifted is not.
 *
 * Callers pass raw values. Escaping happens here, at the binding site, so a new
 * field cannot be added without it.
 */
function buildClientHtml({ firstName, eyebrow, heading, intro, panelTitle, details }) {
  const rows = (details || []).filter(([, value]) => value);
  const divider =
    `
              <tr>
                <td colspan="2" style="padding:0; font-size:0; line-height:0; border-top:1px solid #E0D4C6;">&nbsp;</td>
              </tr>`;
  const detailRows = rows
    .map(([label, value]) => `
              <tr>
                <td style="padding:10px 0; font-size:13px; color:#7D6B5D; font-family:Arial,sans-serif; width:130px; text-align:right;">${escapeHtml(label)}</td>
                <td style="padding:10px 0; font-size:15px; color:#1A1A1B; font-family:Georgia,serif; font-weight:bold; text-align:right;">${escapeHtml(value)}</td>
              </tr>`)
    .join(divider);

  const detailsBlock = rows.length ? `
        <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:32px 0; background:#F6F1EA; border:1px solid #E0D4C6; border-radius:6px;">
          <tr><td style="padding:28px 32px;">
            <p style="margin:0 0 20px; font-size:11px; letter-spacing:0.25em; text-transform:uppercase; color:#7D6B5D; font-family:Arial,sans-serif; text-align:right;">${escapeHtml(panelTitle)}</p>
            <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%">${detailRows}
            </table>
          </td></tr>
        </table>` : '';

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0; padding:0; background:#F9F7F2; font-family:Arial,Helvetica,sans-serif; color:#1A1A1B; line-height:1.7; -webkit-text-size-adjust:100%;">
  <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9F7F2;">
    <tr><td align="center" style="padding:32px 16px;">
      <table dir="rtl" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:600px; background:#FFFFFF; border:1px solid #E5DDD0; border-radius:6px; overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:40px 48px 30px; border-bottom:1px solid #E5DDD0; text-align:center;">
          <p style="margin:0 0 6px; font-family:Georgia,serif; font-size:24px; font-weight:bold; color:#1A1A1B; letter-spacing:-0.02em;">דורית גוב ארי</p>
          <p style="margin:0; font-size:10px; letter-spacing:0.3em; text-transform:uppercase; color:#7D6B5D;">התכנון שלי — הרווח שלך</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:44px 48px 36px; text-align:right;">
          <p style="margin:0 0 20px; font-size:11px; letter-spacing:0.3em; text-transform:uppercase; color:#7D6B5D;">${escapeHtml(eyebrow)}</p>
          <h1 style="margin:0 0 24px; font-family:Georgia,serif; font-size:28px; font-weight:bold; color:#1A1A1B; line-height:1.3; letter-spacing:-0.02em; text-align:right;">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 16px; font-size:15px; color:#3D3D3F; line-height:1.8; text-align:right;">שלום ${escapeHtml(firstName)},</p>
          <p style="margin:0 0 16px; font-size:15px; color:#3D3D3F; line-height:1.8; text-align:right;">${escapeHtml(intro)}</p>
          ${detailsBlock}
          <div style="height:2px; width:48px; background:#C3AD96; margin:32px 0 20px;"></div>
          <p style="margin:0; font-size:15px; color:#3D3D3F; line-height:1.8; text-align:right;">לכל שאלה או עדכון — ניתן להשיב ישירות למייל זה.</p>
        </td></tr>
        <!-- Signature -->
        <tr><td style="padding:0 48px 40px; text-align:right;">
          <p style="margin:0; font-family:Georgia,serif; font-size:18px; font-weight:bold; color:#1A1A1B;">דורית גוב ארי</p>
          <p style="margin:4px 0 0; font-size:13px; color:#7D6B5D;">מתכננת פיננסית בכירה · רישיון L-00107009</p>
          <p style="margin:8px 0 0; font-size:13px; color:#7D6B5D; direction:ltr; text-align:right;">dorit@govari-fin.co.il</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:26px 48px; background:#1A1A1B; text-align:center;">
          <p style="margin:0 0 4px; font-size:11px; color:rgba(249,247,242,0.5); line-height:1.6;">דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח · רישיון סוכן מרשות שוק ההון מספר L-00107009</p>
          <p style="margin:0; font-size:10px; color:rgba(249,247,242,0.35); letter-spacing:0.15em; text-transform:uppercase;">Designed with Structural Serenity</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildClientText(source, data) {
  const firstName = (data.name || '').split(' ')[0];
  const when = data.timing || 'לפי תיאום';
  if (source === 'interview') {
    // התאום של גרסת ה-HTML. שתי המחציות של אותו מייל חייבות לומר אותו דבר —
    // לקוח שאינו מציג HTML מקבל את הטקסט, ואם רק אחת מהן מזכירה את ייפוי הכוח
    // הוא קיים או לא קיים לפי היכולת של תוכנת הדואר שלו.
    const chRow = (Array.isArray(data?.profile) ? data.profile : [])
      .find(([label]) => String(label).includes('מסלקה'));
    const wantsClearinghouse = Boolean(chRow) && String(chRow[1]).startsWith('מעוניין');
    return [
      `שלום ${firstName}, תודה על השיחה. הסיכום שאישרתם הועבר אליי כפי שהוא.`,
      `נושא מרכזי: ${data.topic || 'הקשר כללי'}`,
      ...(wantsClearinghouse && POA_URL
        ? [`ייפוי כוח לשליפת נתוני מסלקה — לחתימה לפני הפגישה: ${POA_URL}`]
        : []),
      `אחזור אליכם אישית תוך יום עסקים אחד לתיאום הפגישה הראשונה.`,
      `לכל שאלה — ניתן להשיב ישירות למייל זה.`,
      `בברכה, דורית גוב ארי · dorit@govari-fin.co.il`,
    ].join('\n');
  }
  if (source === 'consultation') {
    return [
      `שלום ${firstName}, קיבלתי את בקשת הייעוץ והפרטים תועדו בהצלחה.`,
      `נושא: ${data.topic || 'ייעוץ כללי'} · מועד מבוקש: ${when}`,
      `אחזור אליכם אישית תוך יום עסקים אחד לתיאום מדויק.`,
      `לכל שאלה — ניתן להשיב ישירות למייל זה.`,
      `בברכה, דורית גוב ארי · dorit@govari-fin.co.il`,
    ].join('\n');
  }
  return [
    `שלום ${firstName}, קיבלתי את פנייתכם והפרטים תועדו בהצלחה.`,
    `אחזור אליכם אישית בהקדם האפשרי.`,
    `לכל שאלה — ניתן להשיב ישירות למייל זה.`,
    `בברכה, דורית גוב ארי · dorit@govari-fin.co.il`,
  ].join('\n');
}

function subjectFor(source, data) {
  if (source === 'interview') return `סיכום ראיון היכרות — ${data.name}`;
  if (source === 'consultation') return `בקשת ייעוץ חדשה — ${data.name}`;
  if (source === 'detailed') return `פנייה מפורטת — ${data.name} (${data.topic || 'כללי'})`;
  return `פנייה חדשה מהאתר — ${data.name}`;
}

export default async function(req) {
  const rid = newRequestId();
  const startedAt = Date.now();
  try {
    log('info', 'request.start', { rid });
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { name, phone, email, source, topic, timing, message, notes, scheduledAt, summary, profile, track, stage, meetingTopic, consent_version, consent_at } = body || {};

    if (!name || !phone) {
      log('warn', 'request.rejected', { rid, reason: 'missing_contact_fields', source: source || 'quick' });
      return Response.json({ error: 'נדרשים שם וטלפון', rid }, { status: 400 });
    }

    // התקציר נכתב על ידי מודל, ולכן עובר סינון לפני שהוא נשלח לאן שהוא.
    const safeSummary = redact(summary);

    // ראיון ההיכרות הוא המקור היחיד שבו ה-message נכתב על ידי מודל ולא הוקלד
    // על ידי המבקר — זהו פרופיל שהסוכן ניסח וקיבל עליו אישור. ככזה הוא עובר
    // את אותו סינון כמו התקציר: הסוכן מונחה לא לרשום מזהים, אבל המבקר יכול
    // להקליד ת"ז באמצע השיחה והמודל עלול לשקף אותה בחזרה. בשאר המקורות זהו
    // טקסט חופשי של המבקר עצמו, והוא נשמר כפי שנכתב.
    const safeMessage = source === 'interview' ? redact(message) : message;

    // הפרופיל המובנה. הוא מסונן לשדות המוכרים של המסלול, ומה שנשאר הוא גם מה
    // שנשלח וגם מה שנשמר — הרשומה והמייל אינם יכולים לספר שני סיפורים.
    const safeProfile = source === 'interview' ? buildInterviewProfile(profile, track) : [];
    const trackLabel = INTERVIEW_TRACKS[track]?.label || '';
    const profileText = safeProfile.map(([label, value]) => `${label}: ${value}`).join('\n');
    const completeness = source === 'interview' ? interviewCompleteness(safeProfile, track) : null;

    // הדאגה המרכזית נשאלה כבר כשדה בסכימה. עד כה הסוכן התבקש למסור אותה שוב
    // כ-topic, כלומר אותה עובדה פעמיים, ואחד העותקים אינו מוצג לדורית כלל.
    // כאן היא נגזרת מהסכימה, ו-topic נותר לטפסים שבאמת שולחים אותו.
    // הראיון מתאם כעת גם את הפגישה, ולכן יש לו שני "נושאים": הדאגה שהביאה את
    // המבקר, והנושא שעליו סוכם להיפגש. מה שנרשם ברשומה הוא השני — זה מה שדורית
    // מכינה לקראתו — והדאגה נשארת בפרופיל, שם היא כבר מוצגת.
    const concern = safeProfile.find(([label]) => label === 'דאגה מרכזית')?.[1] || '';
    const effectiveTopic = source === 'interview'
      ? (meetingTopic || concern || topic || '')
      : topic;

    // ראיון חלקי: הרשומה נשמרת ואיש אינו מקבל הודעה. ההודעה שייכת לראיון
    // שהושלם — מייל על כל מי שהתחיל לענות היה הופך את התיבה לרעש.
    const partial = source === 'interview' && stage === 'partial';

    const data = {
      name, phone, email, topic: effectiveTopic, timing,
      message: safeMessage, notes, summary: safeSummary,
      profile: safeProfile, trackLabel, completeness,
      device: deviceLabel(req.headers.get('user-agent')),
    };
    const agentBody = buildAgentBody(source, data);
    const subject = subjectFor(source, data);
    const leadMessage = profileText || safeMessage || notes || '';

    // ── סדר הפעולות ─────────────────────────────────────────────────────
    // הפנייה נשמרת ראשונה. המייל הוא הערוץ השביר (מסירה, דומיין מאומת,
    // נמען רשום) והמאגר הוא האמין — אם נכשלת שליחת המייל, הפנייה כבר
    // מתועדת ואינה אובדת. כשל בשמירה הוא היחיד שמחזיר שגיאה ללקוח.
    //
    // The record is written first. Email is the fragile channel and the
    // database is the reliable one, so a failed send can no longer lose the
    // enquiry; only a failed write is reported to the caller as an error.
    let leadId = null;

    // ראיון שכבר נפתח בשיחה הזו מתעדכן במקום להיווצר מחדש.
    const openInterview = source === 'interview' ? await findOpenInterview(base44, phone) : null;
    // האם השיחה הזו כבר פתחה רשומה. זה מה שמבדיל עדכון מכפילות, וזה השדה
    // שמסביר בדיעבד למה ראיון אחד הופיע פעמיים במסך הפניות.
    log('info', 'lead.resolved', { rid, source: source || 'quick', track: track || '', stage: partial ? 'partial' : 'complete', upsert: Boolean(openInterview?.id) });
    if (openInterview?.id) {
      try {
        await base44.asServiceRole.entities.Lead.update(openInterview.id, {
          email: email || openInterview.email || '',
          topic: effectiveTopic || '',
          message: leadMessage,
          status: partial ? 'partial' : 'new',
          // נשמר מה שכבר נרשם: ההסכמה ניתנה בתחילת השיחה, והעדכון הזה מגיע
          // אחריה. דריסה בריק היתה מוחקת את הראייה שהיא ניתנה.
          consent_version: consent_version || openInterview.consent_version || '',
          consent_at: consent_at || openInterview.consent_at || '',
        });
        leadId = openInterview.id;
        log('info', 'lead.updated', { rid, leadId });
      } catch (e) {
        log('error', 'lead.update_failed', { rid, leadId: openInterview.id, err: String(e?.message ?? e).slice(0, 200) });
        return Response.json(
          { error: 'לא הצלחנו לעדכן את הפנייה. נסו שוב או צרו קשר ישירות.', rid },
          { status: 500 }
        );
      }
    } else try {
      const lead = await base44.entities.Lead.create({
        name,
        phone,
        email: email || '',
        source: source || 'quick',
        topic: effectiveTopic || '',
        timing: timing || '',
        message: leadMessage,
        status: partial ? 'partial' : 'new',
        // איזה נוסח הסכמה הוצג, ומתי. חובת היידוע לפי חוק הגנת הפרטיות
        // (תיקון 13) היא ראייתית: בלי זה אי אפשר לקשור רשומה לנוסח שהמבקר
        // ראה בפועל. ריק כשהפנייה הגיעה ממסלול שלא הציג שער הסכמה — נרשם רק
        // מה שבאמת הוצג, ולעולם לא הסכמה שלא נתבקשה.
        consent_version: consent_version || '',
        consent_at: consent_at || '',
      });
      leadId = lead?.id ?? null;
      log('info', 'lead.created', { rid, leadId, source: source || 'quick' });
    } catch (e) {
      log('error', 'lead.create_failed', { rid, source: source || 'quick', err: String(e?.message ?? e).slice(0, 200) });
      // אין ערוץ גיבוי — הפנייה תאבד. זהו הכשל היחיד שחייב להיכשל בקול.
      return Response.json(
        { error: 'לא הצלחנו לשמור את הפנייה. נסו שוב או צרו קשר ישירות.', rid },
        { status: 500 }
      );
    }

    // שיקוף ל-Supabase. יושב כאן ולא בתוך ענפי היצירה/העדכון כדי שייקרא פעם
    // אחת בדיוק, ואחרי שהכתיבה הסמכותית הצליחה — אותו סדר שבו תופעות הלוואי
    // שבהמשך רצות פעם אחת ולא פעם לכל מאגר.
    await mirrorLeadToSupabase(rid, leadId, {
      name,
      phone,
      email: email || '',
      source: source || 'quick',
      topic: effectiveTopic || '',
      timing: timing || '',
      message: leadMessage,
      status: partial ? 'partial' : 'new',
      consent_version: consent_version || '',
      consent_at: consent_at || null,
      // The meeting, on the enquiry. Until now these four arrived in the
      // payload, were read once on their way to the calendar, and were stored
      // by neither Base44 nor Supabase.
      scheduled_at: israelInstant(scheduledAt),
      meeting_topic: meetingTopic || '',
      notes: notes || '',
      track: track || '',
      // What the personal area shows. The redacted copies the mail already
      // carries — never the raw payload — so the stored version is never more
      // than what was mailed. `profile` keeps the mail's labels, so the page
      // needs no copy of the schema.
      summary: safeSummary || null,
      profile: safeProfile.length ? safeProfile : null,
      track_label: trackLabel || null,
    });

    // And the booking as its own row, when there is a booking to speak of. A
    // quick contact form has no meeting and gets none; an interview that
    // agreed nothing still gets one, because "asked for חמישי and nothing was
    // held" is the case worth being able to query.
    if (scheduledAt || meetingTopic || timing || notes) {
      await mirrorMeetingToSupabase(rid, leadId, {
        scheduled_at: israelInstant(scheduledAt),
        topic: meetingTopic || effectiveTopic || '',
        timing: timing || '',
        notes: notes || '',
        track: track || '',
        source: source === 'consultation' || source === 'interview' ? source : null,
      });
    }

    // מכאן והלאה — מיטבי. הפנייה כבר שמורה, ולכן כשל בהודעה מדווח
    // בתשובה במקום להיכשל, כדי שניתן יהיה לנטר אותו.
    const warnings = [];

    // ראיון חלקי נגמר בשמירה. הוא ימשיך להתעדכן כשהמבקר יסיים; אם לא יסיים,
    // הרשומה נשארת כ-partial וגלויה במסך הפניות — וזה ההבדל בין נוטש שנעלם
    // לנוטש שאפשר לחזור אליו.
    if (partial) {
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, leadId, stage: 'partial', notified: false });
      return Response.json({ ok: true, rid, leadId, stage: 'partial', notified: false, warnings });
    }

    // אישור ללקוח
    if (email) {
      try {
        // הכותרת חייבת לומר את מה שגוף המכתב אומר. clientMailFor פותח ראיון
        // ב"קיבלנו את סיכום השיחה", ונושא שאומר "פנייתכם" הופך את אותו מייל
        // לשני דברים שונים בשורת הנושא ובפתיחה.
        const clientSubject = source === 'interview'
          ? `אישור — קיבלנו את סיכום השיחה · דורית גוב ארי`
          : source === 'consultation'
          ? `אישור — קיבלנו את בקשת הייעוץ שלכם · דורית גוב ארי`
          : `אישור — קיבלנו את פנייתכם · דורית גוב ארי`;
        await sendMail({
          base44,
          to: email,
          subject: clientSubject,
          html: buildClientHtml(clientMailFor(source, data)),
          text: buildClientText(source, data),
          rid,
          role: 'visitor',
        });
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'visitor', err: String(e?.message ?? e).slice(0, 200) });
      warnings.push(deliveryWarning('client_confirmation_failed', e));
      }
    }

    // שלוש הכתיבות החיצוניות יוצאות יחד.
    //
    // הן רצו בתור: יומן, יומן, גיליון, מסמך, ואז הדואר. אף אחת מהן אינה
    // זקוקה לתוצאה של השנייה, אבל כל אחת חיכתה לקודמתה, והסכום הוא שהרג את
    // הדבר היחיד שהמבקר רואה. הקריאה של 4.10 נמשכה 9,989 אלפיות — והסוכן,
    // שאינו ממתין כל כך, אמר למבקר "לא הצלחתי לשמור ולשלוח את המידע", בזמן
    // שהפנייה נשמרה, הדואר יצא, שני היומנים נכתבו ו-warnings היה 0. ראו A-56.
    //
    // יוצאות כאן, נאספות אחרי היומן. ה-catch מחובר ביצירה ולא בהמתנה, אחרת
    // דחייה שמגיעה לפני ה-await היא unhandled rejection שמפילה את הבקשה כולה.
    const sheetPromise = (async () => {
      try {
        const status = await appendEventRow(base44, [
        // שעון ישראל, לא UTC. העמודה הזו נקראת בידי אדם שיושב כאן, ו-Z
        // בסופה הציגה כל אירוע שלוש שעות מוקדם מכפי שקרה. 'sv-SE' נותן
        // YYYY-MM-DD HH:MM:SS, ש-Sheets מזהה כתאריך ולכן גם ממיין נכון.
        new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }),
        eventTypeFor(source),
        source || 'quick',
        trackLabel,               // מסלול — רלוונטי רק בראיון
        '',                       // סוכן — רלוונטי רק בהעברה לאדם
        // הנושא הנרשם הוא זה שנשלח בפועל: בראיון הוא נגזר מנושא הפגישה או
        // מהדאגה המרכזית, ו-`topic` הגולמי כבר אינו מגיע מהסוכן.
        effectiveTopic || '',
        timing || '',
        name,
        phone,
        email || '',
        leadId || '',
        '',                       // סיבת העברה — רלוונטי רק בהעברה לאדם
        // התקציר של הראיון הוא הפרופיל שהסוכן מסר, לא שדה summary נפרד. בלי
        // הנפילה הזו שורת הראיון נרשמת ריקה — שם וטלפון בלי מה שנאסף.
        safeSummary || profileText || safeMessage || '',
          // ── ששת שדות הראיון ─────────────────────────────────────────────
        //
        // עד כאן הם היו בתוך 'תקציר', כטקסט חופשי. שם אי אפשר לסנן, למיין או
        // לספור אותם — ובדיוק זה מה שגיליון נועד לאפשר.
        //
        // 'מועד הפגישה' הוא מה שנכנס ליומן, לא 'מועד מבוקש' שהוא תיאור
        // במילים: רק הראשון ניתן למיון, והשאלה "מה יש לי השבוע" נשאלת עליו.
        wallClock(scheduledAt)?.replace('T', ' ').slice(0, 16) || '',
        profileValue(safeProfile, 'שלב חיים'),
        profileValue(safeProfile, 'יעד עיקרי'),
        profileValue(safeProfile, 'דאגה מרכזית'),
        profileValue(safeProfile, 'שליפת נתוני מסלקה — מעוניין/ת'),
        data.completeness ? completenessLine(data.completeness) : '',
      ]);
        log('info', 'sheet.appended', { rid, tab: SHEET_TAB, status });
        return status;
      } catch (e) {
        log('warn', 'sheet.append_failed', { rid, tab: SHEET_TAB, err: String(e?.message ?? e).slice(0, 200) });
        warnings.push('sheet_append_failed');
        return 'לא נרשם';
      }
    })();

    // רק לפניות מלאות: ייעוץ וראיון שהושלם (ראיון חלקי חוזר מוקדם יותר).
    // פנייה מהירה אינה מייצרת מסמך — אין בה תוכן שמצדיק מסמך.
    const booksDoc = source === 'consultation' || source === 'interview';
    const docPromise = booksDoc
      ? createConsultationDoc(base44, rid, source, data).catch((e) => {
          log('warn', 'doc.failed', { rid, err: String(e?.message ?? e).slice(0, 200) });
          warnings.push('doc_failed');
          return 'לא נוצר';
        })
      : Promise.resolve('לא רלוונטי');

    // יצירת אירוע תזכורת ביומן Outlook — מיטבי, רק עבור בקשות ייעוץ
    // הראיון מתאם פגישה בעצמו מאז שסוכן התיאום מוזג לתוכו, ולכן הוא מקבל
    // תזכורת ביומן בדיוק כמו בקשת ייעוץ — אבל רק כשבאמת סוכם מועד.
    const booksCalendar = source === 'consultation' || (source === 'interview' && Boolean(scheduledAt));
    // "לא רלוונטי" על ראיון בלי מועד היה מטעה: הוא נקרא כמו החלטה, בזמן שמה
    // שקרה הוא שהסוכן לא שלח scheduledAt. מי שקרא את המייל לא ידע שיש מה לתקן.
    let calendar = booksCalendar
      ? 'לא נוצר'
      : (source === 'interview' ? 'לא נקבע מועד' : 'לא רלוונטי');
    // The slot the hold was actually placed on, which is not always the slot
    // that was agreed — it falls back to tomorrow 09:00 when nothing was.
    let calendarStartedAt = null;
    // כל היומנים המוגדרים, ולא רק Graph.
    //
    // זה היה כתוב פעם אחת מול Outlook, ופונקציה שנייה כתבה את אותה פגישה
    // ל-Google — שתי עותקות של אותו קוד, ואחת מהן קיבלה את תיקון אזור הזמן
    // והשנייה לא (A-47). עכשיו הכתיבה אחת, וטבלת הספקים מחזיקה את מה שבאמת
    // שונה ביניהם. חשוב מזה: היא רצה כאן, בשרת, בתוך אותה בקשה ששמרה את
    // הפנייה — ולא כקריאת כלי שנייה שהמודל עשוי לבחור שלא לעשות.
    if (booksCalendar) {
      const calStartIso = wallClock(scheduledAt) ?? `${tomorrowInIsrael()}T09:00:00`;
      const calEndIso = wallClock(calStartIso, 30);
      calendarStartedAt = calStartIso;
      const calContent = `${agentBody}\n\nלייצר קשר ולתאם מעקב.`;
      const event = { summary: subject, description: calContent, startIso: calStartIso, endIso: calEndIso };
      // שני היומנים נכתבים יחד. הם אינם תלויים זה בזה, ובתור הם עלו כשנייה
      // וחצי נוספת על כל פנייה. `booked` נאסף מהתוצאות ולא מתוך הלולאה, כדי
      // שסדר השורה במייל יישאר סדר הספקים ולא סדר התשובות.
      const outcomes = await Promise.all(CALENDAR_PROVIDERS.map(async (provider) => {
        const cal = CALENDARS[provider];
        try {
          const { accessToken } = await base44.asServiceRole.connectors.getConnection(cal.connector);
          if (!accessToken) {
            // מחובר-למחצה זה מצב אמיתי: המחבר מוגדר במאגר, ואיש לא אישר אותו
            // מול הספק. זו אזהרה ולא שגיאה — היומן השני עדיין יקבל את הפגישה.
            log('warn', 'calendar.not_connected', { rid, provider });
            warnings.push(`calendar_${provider}_not_connected`);
            return null;
          }
          const res = await fetch(cal.url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(cal.body(event)),
            // מוגבל בזמן — ראו ההערה ליד ההודעה לדורית.
            signal: AbortSignal.timeout(10000),
          });
          if (!res.ok) {
            log('error', 'calendar.rejected', { rid, provider, status: res.status });
            warnings.push(`calendar_${provider}_rejected`);
            return null;
          }
          log('info', 'calendar.created', { rid, provider });
          return provider;
        } catch (e) {
          log('warn', 'calendar.failed', { rid, provider });
          warnings.push(`calendar_${provider}_failed`);
          return null;
        }
      }));
      const booked = outcomes.filter(Boolean);

      // השורה שדורית קוראת במייל. "נוצר" בלי לומר איפה היה מסתיר בדיוק את
      // המקרה שבו יומן אחד קיבל את הפגישה והשני לא.
      calendar = booked.length
        ? `אירוע נוצר ✓ (${booked.join(', ')}) — ${calStartIso.slice(0, 16).replace('T', ' ')}`
        : 'לא נוצר';
    }

    // The outcome, written back onto the booking. `scheduled_at` is what was
    // agreed and this is what the diary took — tonight's fault was precisely
    // that those two can differ with nothing anywhere saying so.
    if (scheduledAt || meetingTopic || timing || notes) {
      await mirrorMeetingToSupabase(rid, leadId, {
        calendar_status: calendar,
        calendar_at: israelInstant(calendarStartedAt),
      });
    }

    // הגיליון והמסמך, שכבר רצים. שניהם מיטביים — הגיליון הוא תצוגה ולא מקור
    // האמת, והרשומה כבר שמורה — ולכן כשל בהם מדווח ב-warnings ואינו מפיל את
    // הפנייה. נאספים כאן כי ההודעה לדורית נושאת את הקישורים אליהם.
    const [sheet, doc] = await Promise.all([sheetPromise, docPromise]);

    // ── דילוג שקט הוא עדיין דילוג ──────────────────────────────────────────
    //
    // מחבר שלא אושר מחזיר 'אין חיבור' ויוצא — בלי לזרוק, בלי לוג, ובלי
    // warning. בראיון של 4.10 בשעה 22:03 המסמך לא נוצר מהסיבה הזו, והמייל
    // שדורית קיבלה אמר 'תקלות: אין'. זו לא אי-דיוק קטן: 'אין תקלות' הוא
    // המשפט שעל סמכו לא בודקים כלום, ולכן הוא חייב להיות נכון.
    //
    // שני מצבים אינם תקלה ואינם נספרים: 'לא רלוונטי' — פנייה מהירה אינה
    // אמורה לייצר מסמך; ו'לא מוגדר' — אין SHEET_ID, כלומר מישהו בחר לא
    // להפעיל את הרישום, והנספח אומר זאת במפורש. תקלה היא מה שהיה אמור לעבוד
    // ולא עבד: מחבר שאושר ונותק, או כתיבה שנפלה.
    for (const [label, status] of [['sheet', sheet], ['doc', doc]]) {
      const reason =
        status === 'אין חיבור' ? 'not_connected'
        : status === 'לא נרשם' || status === 'לא נוצר' ? 'failed'
        : null;
      if (!reason) continue;
      log('warn', `${label}.skipped`, { rid, reason });
      warnings.push(`${label}_${reason}`);
    }

    // הודעה לדורית — הפנייה המלאה, כולל תקציר השיחה אם הסוכן מסר אחד, ובצידה
    // הקישורים למסמך הסיכום ולשורה ביומן האירועים.
    //
    // ההודעה הזו נשלחה פעם מיד אחרי השמירה, לפני היומן, הגיליון והמסמך. זה
    // היה מוקדם יותר — ולכן גם לפני שהיה קישור לתת. דורית קיבלה את הפנייה
    // ואת העותקים מצאה בעצמה. עכשיו היא נשלחת כאן, אחרי שלושת אלה, וזו הסיבה
    // שלכל אחד מהם יש AbortSignal.timeout: בלעדיו ספק שאינו עונה היה מחזיק
    // את ההודעה היחידה שמישהו ממתין לה. היא ראשונה בקבוצה הזו, לפני תיבות
    // התפעול, כי היא זו שפעולה תלויה בה.
    // ── הקישור לגיליון אינו תלוי במה ש-appendEventRow החזירה ───────────
    //
    // הוא נחלץ עד כה מתוך מחרוזת הסטטוס, ולכן היה בן ערובה שלה: גרסה שהחזירה
    // 'נרשם ✓' בלי כתובת השאירה את דורית בלי קישור, והבלוק כולו נעלם — בלי
    // אזהרה, כי מבחינת הקוד פשוט לא היה מה לקשר.
    //
    // כתובת הגיליון ידועה מ-SHEET_ID ואינה זקוקה לתשובת ה-API. מה שכן נלקח
    // מהסטטוס הוא אם השורה נכתבה: אין טעם לקשר גיליון ששורה לא הגיעה אליו.
    //
    // המסמך נשאר כפי שהוא — מזהה המסמך נוצר בקריאה עצמה, ואם לא נוצר אין לאן
    // לקשר.
    const links = {
      sheet: SHEET_ID && /^נרשם ✓/.test(String(sheet))
        ? `נרשם ✓ — https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`
        : sheet,
      doc,
    };
    try {
      await sendMail({
        base44,
        to: SECONDARY_EMAIL,
        subject,
        // אותה פנייה, בעיצוב האתר. הטקסט נשלח לצידו כגיבוי ולא במקומו.
        html: buildAgentHtml(source, data, null, links),
        text: [agentBody, buildLinksFooter(links)].filter(Boolean).join('\n\n'),
        rid,
        role: 'agency',
      });
    } catch (e) {
      log('warn', 'mail.failed', { rid, role: 'agency', err: String(e?.message ?? e).slice(0, 200) });
      warnings.push(deliveryWarning('secondary_email_failed', e));
    }

    // עותק לצוות התפעול — אותה פנייה מלאה, בתוספת נספח המצב. נשלח אחרון
    // כדי שיוכל לדווח גם על תוצאת היומן והגיליון. ראו ההערה ליד NOTIFY_EMAILS.
    // The same full lead the agent gets, plus the ops appendix — see the note
    // beside NOTIFY_EMAILS, and the consent wording it obliges. Each mailbox is
    // its own attempt: one that bounces must not take the others with it.
    const opsHtml = buildAgentHtml(source, data, { source, leadId, topic, calendar, sheet, doc, warnings });
    const opsText = `${agentBody}\n\n${buildOpsFooter(source, { leadId, topic, calendar, sheet, doc, warnings })}`;
    // יחד, לא בתור. כל תיבה היא עדיין ניסיון נפרד — זו הסיבה שיש כאן catch
    // לכל אחת ולא catch אחד סביב הכול: תיבה שנכשלת אסור שתיקח איתה את השאר.
    await Promise.all(NOTIFY_EMAILS.map(async (to) => {
      try {
        await sendMail({
          base44,
          to,
          subject,
          html: opsHtml,
          text: opsText,
          rid,
          role: 'ops',
        });
      } catch (e) {
        log('warn', 'mail.failed', { rid, role: 'ops', err: String(e?.message ?? e).slice(0, 200) });
        warnings.push(deliveryWarning('notify_email_failed', e));
      }
    }));

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, leadId, source: source || 'quick', warnings: warnings.length });
    return Response.json({ ok: true, rid, leadId, warnings });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String(error?.message ?? error).slice(0, 200) });
    // The id, not the message. `error.message` reached the browser as-is: it
    // told the visitor nothing they could use, and told anyone reading it the
    // shape of our internals. The id is the one thing that is useful to both —
    // they can quote it, and it finds the request in one search.
    return Response.json({ error: 'השמירה נכשלה. אפשר לנסות שוב, או לפנות לדורית ישירות.', rid }, { status: 500 });
  }
}