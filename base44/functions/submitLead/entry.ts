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
  // Never surface provider response bodies or credentials in public warnings.
  if (!response.ok) throw new Error(`mailer_http_${response.status}`);
  const result = await response.json().catch(() => null);
  if (!result?.ok) throw new Error('mailer_rejected');
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
const SHEET_COLUMNS = [
  'מועד', 'סוג האירוע', 'מקור', 'מסלול', 'סוכן', 'נושא', 'מועד מבוקש',
  'שם', 'טלפון', 'אימייל', 'מזהה רשומה', 'סיבת העברה', 'תקציר',
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

/** הוספת שורה אחת ליומן. מחזירה מחרוזת מצב לנספח התפעולי. */
async function appendEventRow(base44, row) {
  if (!SHEET_ID) return 'לא מוגדר';
  const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlesheets');
  if (!accessToken) return 'אין חיבור';

  const range = `${SHEET_TAB}!A:${String.fromCharCode(64 + SHEET_COLUMNS.length)}`;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}` +
      `:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [row] }),
    },
  );
  if (!res.ok) throw new Error(`sheets ${res.status}`);
  return 'נרשם ✓';
}

/** סוג האירוע כפי שהוא נרשם בגיליון — הערך שמאפשר לסנן את הגיליון לפי סוג. */
function eventTypeFor(source) {
  if (source === 'consultation') return 'consultation_request';
  if (source === 'detailed') return 'detailed_enquiry';
  if (source === 'interview') return 'interview_summary';
  return 'quick_contact';
}

/** נספח תפעולי — מה עלה בגורלם של השמירה, היומן והמיילים. */
function buildOpsFooter(source, { leadId, topic, calendar, sheet, warnings }) {
  return [
    `── מצב תפעולי ──`,
    `מקור: ${source || 'quick'}`,
    `נושא: ${topic || '—'}`,
    `מזהה רשומה: ${leadId || '—'}`,
    `יומן: ${calendar}`,
    `גיליון: ${sheet}`,
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

function headingFor(source) {
  if (source === 'consultation') return 'בקשת ייעוץ חדשה';
  if (source === 'detailed') return 'פנייה מפורטת מהאתר';
  if (source === 'interview') return 'סיכום ראיון היכרות';
  return 'פנייה חדשה מהאתר';
}

function buildAgentBody(source, data) {
  const header = headingFor(source);
  const lines = [
    `${header} — ${new Date().toLocaleString("he-IL")}`,
    ``,
    `שם: ${data.name}`,
    `טלפון: ${data.phone}`,
    `אימייל: ${data.email || '—'}`,
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
function buildAgentHtml(source, data, ops) {
  const heading = headingFor(source);

  // 1 · מי פנה. טלפון ואימייל כקישורים — זו ההודעה שפותחים בטלפון כדי לחייג.
  const who = block('מי פנה', [
    detailRow('שם', data.name),
    detailRow('טלפון', data.phone, { link: `tel:${String(data.phone || '').replace(/[^\d+]/g, '')}` }),
    detailRow('אימייל', data.email, { link: data.email ? `mailto:${data.email}` : '', last: true }),
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
  const opsBlock = ops
    ? block('מצב תפעולי', [
        detailRow('מקור', ops.source || 'quick'),
        detailRow('מזהה רשומה', ops.leadId),
        detailRow('יומן', ops.calendar),
        detailRow('גיליון', ops.sheet),
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
          <p style="margin:14px 0 0; font-size:13px; color:${MAIL.muted};">${escapeHtml(new Date().toLocaleString('he-IL'))}</p>
        </td></tr>
        <tr><td style="padding:26px 40px 10px;">${who}${what}${summary}${opsBlock}</td></tr>
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
function clientMailFor(source, data) {
  const firstName = (data.name || '').split(' ')[0];
  if (source === 'interview') {
    return {
      firstName,
      eyebrow: 'אישור קבלה',
      heading: 'קיבלנו את סיכום השיחה',
      intro:
        'תודה על השיחה ועל הזמן. הסיכום שאישרתם הועבר אליי כפי שהוא, ואחזור אליכם אישית תוך יום עסקים אחד לתיאום הפגישה הראשונה.',
      panelTitle: 'מה נשמר',
      details: [['נושא מרכזי', data.topic || 'הקשר כללי']],
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
          <p style="margin:0 0 4px; font-size:11px; color:rgba(249,247,242,0.5); line-height:1.6;">דורית גוב ארי — סוכנות ביטוח בע״מ · רישיון סוכן מרשות שוק ההון מספר L-00107009</p>
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
    return [
      `שלום ${firstName}, תודה על השיחה. הסיכום שאישרתם הועבר אליי כפי שהוא.`,
      `נושא מרכזי: ${data.topic || 'הקשר כללי'}`,
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
      return Response.json({ error: 'נדרשים שם וטלפון' }, { status: 400 });
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
          { error: 'לא הצלחנו לעדכן את הפנייה. נסו שוב או צרו קשר ישירות.', details: e?.message },
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
        { error: 'לא הצלחנו לשמור את הפנייה. נסו שוב או צרו קשר ישירות.', details: e?.message },
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
    });

    // מכאן והלאה — מיטבי. הפנייה כבר שמורה, ולכן כשל בהודעה מדווח
    // בתשובה במקום להיכשל, כדי שניתן יהיה לנטר אותו.
    const warnings = [];

    // ראיון חלקי נגמר בשמירה. הוא ימשיך להתעדכן כשהמבקר יסיים; אם לא יסיים,
    // הרשומה נשארת כ-partial וגלויה במסך הפניות — וזה ההבדל בין נוטש שנעלם
    // לנוטש שאפשר לחזור אליו.
    if (partial) {
      log('info', 'request.end', { rid, ms: Date.now() - startedAt, leadId, stage: 'partial', notified: false });
      return Response.json({ ok: true, leadId, stage: 'partial', notified: false, warnings });
    }

    // הודעה לדורית — הפנייה המלאה, כולל תקציר השיחה אם הסוכן מסר אחד.
    // ההודעה התפעולית נשלחת בסוף, אחרי היומן, כדי שתוכל לדווח גם עליו.
    try {
      await sendMail({
        base44,
        to: SECONDARY_EMAIL,
        subject,
        // אותה פנייה, בעיצוב האתר. הטקסט נשלח לצידו כגיבוי ולא במקומו.
        html: buildAgentHtml(source, data, null),
        text: agentBody,
        rid,
        role: 'agency',
      });
    } catch (e) {
      log('warn', 'mail.failed', { rid, role: 'agency', err: String(e?.message ?? e).slice(0, 200) });
      warnings.push(deliveryWarning('secondary_email_failed', e));
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

    // יצירת אירוע תזכורת ביומן Outlook — מיטבי, רק עבור בקשות ייעוץ
    // הראיון מתאם פגישה בעצמו מאז שסוכן התיאום מוזג לתוכו, ולכן הוא מקבל
    // תזכורת ביומן בדיוק כמו בקשת ייעוץ — אבל רק כשבאמת סוכם מועד.
    const booksCalendar = source === 'consultation' || (source === 'interview' && Boolean(scheduledAt));
    let calendar = booksCalendar ? 'לא נוצר' : 'לא רלוונטי';
    if (booksCalendar) try {
      const { accessToken } = await base44.asServiceRole.connectors.getConnection('outlook');
      if (accessToken) {
        let calStartIso, calEndIso;
        if (scheduledAt) {
          const calStart = new Date(scheduledAt);
          const calEnd = new Date(calStart.getTime() + 30 * 60 * 1000);
          calStartIso = calStart.toISOString();
          calEndIso = calEnd.toISOString();
        } else {
          const now = new Date();
          const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          const yyyy = tomorrow.getUTCFullYear();
          const mm = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(tomorrow.getUTCDate()).padStart(2, '0');
          calStartIso = `${yyyy}-${mm}-${dd}T09:00:00`;
          calEndIso = `${yyyy}-${mm}-${dd}T09:30:00`;
        }

        const calSubject = subject;
        const calContent = `${agentBody}\n\nלייצר קשר ולתאם מעקב.`;

        await fetch('https://graph.microsoft.com/v1.0/me/events', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            subject: calSubject,
            body: { contentType: 'Text', content: calContent },
            start: { dateTime: calStartIso, timeZone: 'Israel Standard Time' },
            end: { dateTime: calEndIso, timeZone: 'Israel Standard Time' },
            isReminderOn: true,
            reminderMinutesBeforeStart: 60,
          }),
        });
        calendar = 'אירוע נוצר ✓';
      }
    } catch (e) {
      log('warn', 'calendar.failed', { rid });
      warnings.push('calendar_event_failed');
    }

    // רישום ביומן האירועים — מיטבי. הגיליון הוא תצוגה, לא מקור האמת: הרשומה
    // כבר נשמרה, ולכן כשל כאן מדווח ב-warnings ואינו מפיל את הפנייה.
    let sheet = 'לא נרשם';
    try {
      sheet = await appendEventRow(base44, [
        new Date().toISOString(),
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
      ]);
      log('info', 'sheet.appended', { rid, tab: SHEET_TAB, status: sheet });
    } catch (e) {
      log('warn', 'sheet.append_failed', { rid, tab: SHEET_TAB, err: String(e?.message ?? e).slice(0, 200) });
      warnings.push('sheet_append_failed');
    }

    // עותק לצוות התפעול — אותה פנייה מלאה, בתוספת נספח המצב. נשלח אחרון
    // כדי שיוכל לדווח גם על תוצאת היומן והגיליון. ראו ההערה ליד NOTIFY_EMAILS.
    // The same full lead the agent gets, plus the ops appendix — see the note
    // beside NOTIFY_EMAILS, and the consent wording it obliges. Each mailbox is
    // its own attempt: one that bounces must not take the others with it.
    const opsHtml = buildAgentHtml(source, data, { source, leadId, topic, calendar, sheet, warnings });
    const opsText = `${agentBody}\n\n${buildOpsFooter(source, { leadId, topic, calendar, sheet, warnings })}`;
    for (const to of NOTIFY_EMAILS) {
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
    }

    log('info', 'request.end', { rid, ms: Date.now() - startedAt, leadId, source: source || 'quick', warnings: warnings.length });
    return Response.json({ ok: true, leadId, warnings });
  } catch (error) {
    log('error', 'request.failed', { rid, ms: Date.now() - startedAt, err: String(error?.message ?? error).slice(0, 200) });
    return Response.json({ error: error.message }, { status: 500 });
  }
}