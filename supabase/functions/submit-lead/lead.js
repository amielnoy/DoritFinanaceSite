// What submit-lead says and stores, moved verbatim from
// base44/functions/submitLead/entry.ts: the mail and sheet builders, the
// interview schema and the guards' limits. Plain JavaScript, as it was, so the
// two stay comparable line by line while both are deployed. The only edits:
// there is no per-enquiry Doc, so the footers and the links no longer name one,
// and the operations appendix reports the mailed invitations in its place.
// escapeHtml, greetingName and channelLine are the shared copies.
import { channelLine } from '../_shared/attribution.ts';
import { greetingName } from '../_shared/guard.ts';
import { escapeHtml } from '../_shared/html.ts';

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
export function wallClock(iso, addMinutes = 0) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) + addMinutes * 60000;
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** התאריך של מחר לפי שעון ישראל — לא לפי UTC, שמזיז אותו ביום סביב חצות. */
export function tomorrowInIsrael() {
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
export function israelInstant(wall) {
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

// Who receives an enquiry — the mailboxes, the agent and the diary — lives in
// one place for every Edge function: ../_shared/recipients.ts (Architecture N-01).
export {
  CALENDAR_ATTENDEES,
  INVITE_ATTENDEES,
  INVITE_FALLBACK_GOOGLE,
  NOTIFY_EMAILS,
  SECONDARY_EMAIL,
} from '../_shared/recipients.ts';

/** כתובת השולח של המערכת (MAIL_FROM של dorit-mailer): מארגן ההזמנה, ולעולם לא אחד מהמוזמנים. */
export const INVITE_ORGANIZER = "notifications@mail.govari-fin.co.il";


/**
 * הסרת מזהים רגישים מתקציר שנכתב על ידי מודל.
 *
 * משוכפל מ-escalateToHuman/entry.ts בכוונה: כל פונקציה ב-Base44 היא נקודת
 * כניסה עצמאית ואין ביניהן מודול משותף. שתי העותקות חייבות להישאר זהות —
 * tests/contract/agents.contract.test.ts נכשל אם אחת מהן מתפצלת.
 */
export function redact(text) {
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
// זהו עותק שלישי של פרטי המבקר, אחרי המאגר והמיילים. הוא מתרוקן לילה-לילה
// כשהפנייה במאגר עוברת אנונימיזציה או נמחקת — supabase/functions/sheet-retention.
// מזהה הגיליון מגיע מהסביבה ולא מהקוד: המאגר ציבורי, ופריסה בלי גיליון צריכה
// להמשיך לעבוד. ריק = הרישום מדולג בשקט ומדווח כ"לא מוגדר" בנספח התפעולי.
export const SHEET_TAB = (Deno.env.get('SHEET_TAB') || 'Events').trim();

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
export const SHEET_COLUMNS = [
  'מועד', 'סוג האירוע', 'מקור', 'מסלול', 'סוכן', 'נושא', 'מועד מבוקש',
  'שם', 'טלפון', 'אימייל', 'מזהה רשומה', 'סיבת העברה', 'תקציר',
  'מועד הפגישה', 'שלב חיים', 'יעד עיקרי', 'דאגה מרכזית', 'מסלקה', 'שלמות',
];

/** סוג האירוע כפי שהוא נרשם בגיליון — הערך שמאפשר לסנן את הגיליון לפי סוג. */
export function eventTypeFor(source) {
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
export function buildLinksFooter({ sheet }) {
  const rows = [
    ['יומן האירועים', sheet],
  ].filter(([, v]) => linkIn(v));
  if (!rows.length) return '';
  return [`── קישורים ──`, ...rows.map(([label, v]) => `${label}: ${linkIn(v)}`)].join('\n');
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

export const INTERVIEW_COMMON = [
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

// The short questionnaire's own answers (2026-10-14): how soon, and whether a
// clearinghouse report already exists — a fact for Dorit; the pull itself is
// still only the flag above. Kept in the profile and the mail, but outside
// interviewCompleteness: the AI interview never asks them, and they must not
// make its answers look fewer.
export const INTERVIEW_EXTRA = [
  ['urgency', 'דחיפות'],
  ['clearinghouse_report', 'דוח מסלקה פנסיונית'],
];

export const INTERVIEW_TRACKS = {
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
// הקריאה השנייה מעדכנת את אותה רשומה במקום ליצור שנייה — כל עוד הרשומה עדיין
// partial ושייכת לאותו אדם (findOpenInterview). ראיון שכבר הסתיים לא נפתח
// מחדש, ולכן ריצה שלישית היא רשומה משלה.
export const INTERVIEW_WINDOW_MS = 6 * 60 * 60 * 1000;

/** שם להשוואה: בלי רווחים כפולים ובלי הבדלי אותיות גדולות. */
export const normalizeName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * אותו אדם לפי מה שידוע: אותו שם — או שם שאחד מהם הוא תחילתו של השני, "דנה"
 * מול "דנה כהן" — וכתובת שאינה סותרת. טלפון לבדו אינו סוד: מי שיודע מספר של
 * מישהו אחר לא יכול לדרוס בו את הראיון שלו.
 */
export function sameInterviewee(lead, name, email) {
  const stored = normalizeName(lead?.name);
  const incoming = normalizeName(name);
  if (!stored || !incoming) return false;
  const nameMatches = stored === incoming || stored.startsWith(`${incoming} `) || incoming.startsWith(`${stored} `);
  if (!nameMatches) return false;
  const storedEmail = String(lead?.email ?? '').trim().toLowerCase();
  const incomingEmail = String(email ?? '').trim().toLowerCase();
  return !storedEmail || !incomingEmail || storedEmail === incomingEmail;
}

/**
 * כמה מהשדות של המסלול נענו בפועל.
 *
 * בלי זה ראיון יסודי וראיון בן שתי תשובות נראים אותו דבר במבט ראשון, ואי אפשר
 * לתעדף. ההפרדה בין "נענה: לא ידוע" ל"לא נשאל" נשמרת כאן: ערך שנמסר כ"לא ידוע"
 * נספר כתשובה — זו אינפורמציה על המבקר — ושדה חסר אינו נספר כלל.
 */
export function interviewCompleteness(rows, track) {
  const fields = interviewFields(track);
  const counted = new Set(fields.map(([, label]) => label));
  const total = fields.length;
  // INTERVIEW_EXTRA rows are in the profile, not in the count.
  rows = rows.filter(([label]) => counted.has(label));
  const answered = rows.length;
  const unknown = rows.filter(([, value]) => /^לא ידוע/.test(String(value))).length;
  return { answered, total, unknown };
}

/** "5 מתוך 7 שדות נענו · 2 מהם לא ידועים למבקר" */
export function completenessLine({ answered, total, unknown }) {
  const base = `${answered} מתוך ${total} שדות נענו`;
  return unknown ? `${base} · ${unknown} מהם לא ידועים למבקר` : base;
}

/** סדר השדות של מסלול, כולל המשותפים. מסלול לא מוכר מקבל את המשותפים בלבד. */
export function interviewFields(track) {
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
export function profileValue(pairs, label) {
  const hit = (pairs || []).find(([l]) => l === label);
  return hit ? hit[1] : '';
}

export function buildInterviewProfile(profile, track) {
  const given = profile && typeof profile === 'object' ? profile : {};
  return [...interviewFields(track), ...INTERVIEW_EXTRA]
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
export const INTERVIEW_DECLARATION =
  'הסיכום נאסף על ידי עוזר אוטומטי, שאוסף מידע בלבד. אין בו ייעוץ, שיווק פנסיוני ' +
  'או המלצה, והוא אינו בירור צרכים — בירור הצרכים נעשה על ידי דורית בפגישה, כנדרש בדין. ' +
  'הפרטים נמסרו על ידי המבקר ולא אומתו.';

export function eyebrowFor(source) {
  return source === 'interview' ? 'ראיון היכרות' : 'פנייה מהאתר';
}

export function headingFor(source) {
  if (source === 'consultation') return 'בקשת ייעוץ חדשה';
  if (source === 'detailed') return 'פנייה מפורטת מהאתר';
  if (source === 'interview') return 'סיכום ראיון היכרות';
  return 'פנייה חדשה מהאתר';
}

export function buildAgentBody(source, data) {
  const header = headingFor(source);
  const channelText = channelLine(data);
  const lines = [
    `${header} — ${new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`,
    ``,
    `שם: ${data.name}`,
    `טלפון: ${data.phone}`,
    `אימייל: ${data.email || '—'}`,
    `נשלח מ: ${data.device || 'לא ידוע'}`,
    ...(channelText ? [`הגיע/ה דרך: ${channelText}`] : []),
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
export const MAIL = {
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
export const linkIn = (value) => (String(value || '').match(/https?:\/\/\S+/) || [''])[0];
export const statusOf = (value) => String(value || '').replace(/\s*—\s*https?:\/\/\S+/, '').trim();

export function detailRow(label, value, { link = '', last = false } = {}) {
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
export function block(title, inner, { tone = 'panel' } = {}) {
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
export function proseRow(text) {
  return `
              <tr><td style="padding:2px 0 0; font-size:15px; color:${MAIL.body}; font-family:Arial,sans-serif; line-height:1.8; text-align:right; white-space:pre-line;">${escapeHtml(text || '—')}</td></tr>`;
}

/**
 * ההודעה הפנימית כ-HTML. `ops` הוא הנספח התפעולי, ונשלח רק לצוות —
 * דורית מקבלת את אותה הודעה בלעדיו.
 */
export function buildAgentHtml(source, data, ops, links = null) {
  const heading = headingFor(source);

  // 1 · מי פנה. טלפון ואימייל כקישורים — זו ההודעה שפותחים בטלפון כדי לחייג.
  const whoChannelText = channelLine(data);
  const who = block('מי פנה', [
    detailRow('שם', data.name),
    detailRow('טלפון', data.phone, { link: `tel:${String(data.phone || '').replace(/[^\d+]/g, '')}` }),
    detailRow('אימייל', data.email, { link: data.email ? `mailto:${data.email}` : '' }),
    detailRow('נשלח מ', data.device || 'לא ידוע', { last: !whoChannelText }),
    ...(whoChannelText ? [detailRow('הגיע/ה דרך', whoChannelText, { last: true })] : []),
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
        detailRow('הזמנות', ops.invites),
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
export const POA_URL = (Deno.env.get('POA_URL') || '').trim();

/**
 * Whether the interview's answers asked for the clearinghouse pull.
 *
 * `profile` is the redacted [label, value] pairs buildInterviewProfile kept;
 * it drops an empty answer, so a row at all means the question was answered.
 */
export function wantsClearinghouse(profile) {
  // The flag's own label exactly: "דוח מסלקה פנסיונית" (whether a report
  // exists) also names the clearinghouse and must never start a request.
  const row = (Array.isArray(profile) ? profile : [])
    .find(([label]) => String(label) === 'שליפת נתוני מסלקה — מעוניין/ת');
  return Boolean(row) && String(row[1]).startsWith('מעוניין');
}

/**
 * The interview confirmation when the clearinghouse request replaces the
 * mandate (PR A, MASLEKA_ENABLED; Ruling 21: one mail). The link itself is
 * `data.maslekaLink`, built by the handler from a token it just issued and
 * rendered as html.ts's https-only button — never read from the request, so
 * no visitor can put a link of theirs into a mail from Dorit.
 */
export const MASLEKA_INTRO =
  'תודה על השיחה ועל הזמן. הסיכום שאישרתם הועבר אליי כפי שהוא, ואחזור אליכם אישית תוך יום עסקים אחד לתיאום הפגישה הראשונה. ביקשתם שאשלוף עבורכם תמונת מצב פנסיונית מהמסלקה — הכפתור שלמטה מוביל לעמוד האישי שלכם למסירת קוד ייפוי הכוח, ושם מחכה ההסבר המלא, צעד אחר צעד.';
export const MASLEKA_ACTION_LABEL = 'למסירת קוד המסלקה';

/** ערך קצר בלי שום דבר שנראה כמו קישור או כתובת, או ברירת המחדל. */
export function plainOr(value, fallback) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s || s.length > 60) return fallback;
  return /:\/\/|www\.|@|[<>]|\.[a-z]{2,}\b/i.test(s) ? fallback : s;
}

export const LEAD_FIELD_LIMITS = {
  name: 80,
  phone: 30,
  email: 254,
  source: 40,
  stage: 20,
  track: 40,
  topic: 200,
  timing: 200,
  meetingTopic: 200,
  scheduledAt: 60,
  consent_version: 40,
  consent_at: 60,
  notes: 4000,
  message: 10000,
  summary: 10000,
};

export function clientMailFor(source, data) {
  const firstName = greetingName(data.name);
  if (source === 'interview') {
    // רק למי שאמר שהוא מעוניין. 'לא' או שדה חסר — אין אזכור, ואין מסמך שנשלח
    // למי שלא ביקש אותו.
    //
    // `data.profile` כבר אינו האובייקט הגולמי אלא מערך זוגות [תווית, ערך]
    // שעבר redact, ולכן הבדיקה היא על התווית. buildInterviewProfile משמיט שדה
    // ריק, כך שעצם קיומה של השורה אומר שנשאל ונענה.
    const wants = wantsClearinghouse(data?.profile);
    // With the clearinghouse pipeline on, the personal /masleka link replaces
    // the mandate, as a button; with it off (or when the request could not be
    // created) the letter is exactly what it was — no `action` key at all.
    const maslekaOffered = wants && typeof data?.maslekaLink === 'string' && data.maslekaLink !== '';
    const poaOffered = wants && !maslekaOffered && POA_URL;
    const mail = {
      firstName,
      eyebrow: 'אישור קבלה',
      heading: 'קיבלנו את סיכום השיחה',
      intro: maslekaOffered
        ? MASLEKA_INTRO
        : poaOffered
        ? 'תודה על השיחה ועל הזמן. הסיכום שאישרתם הועבר אליי כפי שהוא, ואחזור אליכם אישית תוך יום עסקים אחד לתיאום הפגישה הראשונה. ביקשתם שאשלוף עבורכם תמונת מצב פנסיונית מהמסלקה — לשם כך נדרש ייפוי כוח חתום, והוא מצורף כאן למטה. אפשר לחתום עליו לפני הפגישה, וכך נגיע אליה עם התמונה המלאה.'
        : 'תודה על השיחה ועל הזמן. הסיכום שאישרתם הועבר אליי כפי שהוא, ואחזור אליכם אישית תוך יום עסקים אחד לתיאום הפגישה הראשונה.',
      panelTitle: 'מה נשמר',
      details: poaOffered
        ? [['נושא מרכזי', plainOr(data.topic, 'הקשר כללי')], ['ייפוי כוח למסלקה', POA_URL]]
        : [['נושא מרכזי', plainOr(data.topic, 'הקשר כללי')]],
    };
    return maslekaOffered ? { ...mail, action: { label: MASLEKA_ACTION_LABEL, href: data.maslekaLink } } : mail;
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
      ? [['תחום ייעוץ', plainOr(data.topic, 'ייעוץ כללי')], ['מועד מבוקש', plainOr(data.timing, 'לפי תיאום')]]
      : [],
  };
}

export function buildClientText(source, data) {
  const firstName = greetingName(data.name);
  // What the visitor typed comes back only when it carries nothing link-like.
  const hello = firstName ? `שלום ${firstName}, ` : 'שלום, ';
  const when = plainOr(data.timing, 'לפי תיאום');
  if (source === 'interview') {
    // התאום של גרסת ה-HTML. שתי המחציות של אותו מייל חייבות לומר אותו דבר —
    // לקוח שאינו מציג HTML מקבל את הטקסט, ואם רק אחת מהן מזכירה את ייפוי הכוח
    // הוא קיים או לא קיים לפי היכולת של תוכנת הדואר שלו.
    const wants = wantsClearinghouse(data?.profile);
    const maslekaOffered = wants && typeof data?.maslekaLink === 'string' && data.maslekaLink !== '';
    return [
      `${hello}תודה על השיחה. הסיכום שאישרתם הועבר אליי כפי שהוא.`,
      `נושא מרכזי: ${plainOr(data.topic, 'הקשר כללי')}`,
      ...(maslekaOffered
        ? [`מסירת קוד המסלקה — הקישור האישי שלכם: ${data.maslekaLink}`]
        : wants && POA_URL
        ? [`ייפוי כוח לשליפת נתוני מסלקה — לחתימה לפני הפגישה: ${POA_URL}`]
        : []),
      `אחזור אליכם אישית תוך יום עסקים אחד לתיאום הפגישה הראשונה.`,
      `לכל שאלה — ניתן להשיב ישירות למייל זה.`,
      `בברכה, דורית גוב ארי · dorit@govari-fin.co.il`,
    ].join('\n');
  }
  if (source === 'consultation') {
    return [
      `${hello}קיבלתי את בקשת הייעוץ והפרטים תועדו בהצלחה.`,
      `נושא: ${plainOr(data.topic, 'ייעוץ כללי')} · מועד מבוקש: ${when}`,
      `אחזור אליכם אישית תוך יום עסקים אחד לתיאום מדויק.`,
      `לכל שאלה — ניתן להשיב ישירות למייל זה.`,
      `בברכה, דורית גוב ארי · dorit@govari-fin.co.il`,
    ].join('\n');
  }
  return [
    `${hello}קיבלתי את פנייתכם והפרטים תועדו בהצלחה.`,
    `אחזור אליכם אישית בהקדם האפשרי.`,
    `לכל שאלה — ניתן להשיב ישירות למייל זה.`,
    `בברכה, דורית גוב ארי · dorit@govari-fin.co.il`,
  ].join('\n');
}

/**
 * Whether the visitor said it is urgent — the questionnaire's "דחוף" answer.
 * `profile` is the [label, value] pairs buildInterviewProfile kept.
 */
export function isUrgent(profile) {
  const row = (Array.isArray(profile) ? profile : []).find(([label]) => String(label) === 'דחיפות');
  return Boolean(row) && String(row[1]).startsWith('דחוף');
}

export function subjectFor(source, data) {
  if (source === 'interview') return `${isUrgent(data.profile) ? '🔴 דחוף — ' : ''}סיכום ראיון היכרות — ${data.name}`;
  if (source === 'consultation') return `בקשת ייעוץ חדשה — ${data.name}`;
  if (source === 'detailed') return `פנייה מפורטת — ${data.name} (${data.topic || 'כללי'})`;
  return `פנייה חדשה מהאתר — ${data.name}`;
}

