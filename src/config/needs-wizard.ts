/**
 * The needs wizard: the same fields the interview agent collects, as choices.
 *
 * The free-text interview (`base44/agents/needs_interview.jsonc`) took a visitor
 * many turns, several minutes and a model's patience to produce what Dorit
 * receives — and an anonymous visitor's agent cannot even save it (A-59), so the
 * page submits the close regardless. A deterministic form asks the same
 * questions in about two minutes and submits through the same call.
 *
 * What must not drift: every profile key here exists in the agent's list and in
 * `submitLead`'s `INTERVIEW_TRACKS`, which keeps only the keys it knows —
 * `tests/contract/needs-wizard.contract.test.ts` fails when they part.
 */

/** "Asked, and the visitor does not know." A real answer — never written for a question not asked. */
export const UNKNOWN = "לא ידוע למבקר";

/** The chip that records `UNKNOWN`. */
export const UNKNOWN_LABEL = "לא יודע/ת";

export type Track = "pension" | "insurance" | "retirement" | "tax" | "savings" | "self_employed" | "general";

export interface Question {
  /** The profile key, exactly as the agent and `submitLead` name it. */
  key: string;
  /** The question, as the visitor reads it (the fieldset's legend). */
  legend: string;
  /** How the answer is labelled on the summary screen. */
  label: string;
  options: readonly string[];
  multi?: boolean;
  /** Choosing this option reveals a short free-text field (fees). */
  revealsText?: { option: string; placeholder: string };
  /** A free-text question rather than chips (general → notes). */
  textOnly?: { placeholder: string };
}

export const LIFE_STAGE: Question = {
  key: "life_stage",
  legend: "איפה את/ה בחיים כרגע?",
  label: "שלב חיים",
  options: ["רווק/ה", "זוג בלי ילדים", "משפחה עם ילדים קטנים", "ילדים בוגרים", "לקראת פרישה", "כבר בפרישה"],
};

export interface Concern {
  label: string;
  /** Absent for the claim option, which leaves the wizard for a person. */
  track?: Track;
  claim?: true;
}

export const CONCERN_LEGEND = "מה הכי מעסיק אותך כרגע?";
export const CONCERN_LABEL = "דאגה מרכזית";
export const CONCERNS: readonly Concern[] = [
  { label: "דמי ניהול / הפנסיה שלי", track: "pension" },
  { label: "ביטוחים והגנה על המשפחה", track: "insurance" },
  { label: "פרישה וקיבוע זכויות", track: "retirement" },
  { label: "מס / החזר מס", track: "tax" },
  { label: "חיסכון למטרה", track: "savings" },
  { label: "אני עצמאי/ת", track: "self_employed" },
  { label: "רוצה תמונה כללית", track: "general" },
  { label: "תביעה או בעיה בפוליסה קיימת", claim: true },
];

export const GOAL: Question = {
  key: "goal",
  legend: "מה היית רוצה שיצא מהפגישה?",
  label: "יעד עיקרי",
  options: ["לדעת שאני מסודר/ת", "להוריד עלויות", "לתכנן פרישה", "להגן על המשפחה", "לחסוך למטרה"],
};

const PRODUCTS = ["פנסיה", "גמל", "השתלמות"] as const;

export const TRACK_QUESTIONS: Record<Track, readonly Question[]> = {
  pension: [
    { key: "employer", legend: "מה המעמד התעסוקתי שלך?", label: "מעסיק / מעמד תעסוקתי", options: ["שכיר/ה", "עצמאי/ת", "שניהם", "לא עובד/ת כרגע"] },
    { key: "seniority", legend: "כמה שנות ותק, בערך?", label: "ותק", options: ["עד 5 שנים", "5–15", "15–25", "מעל 25"] },
    { key: "products", legend: "אילו מוצרים יש לך היום?", label: "מוצרים קיימים", options: PRODUCTS, multi: true },
    {
      key: "fees",
      legend: "ידוע לך מה דמי הניהול שלך?",
      label: "דמי ניהול — כפי שנמסר",
      options: ["יודע/ת", UNKNOWN_LABEL],
      revealsText: { option: "יודע/ת", placeholder: "למשל: 0.5% מהצבירה" },
    },
  ],
  insurance: [
    { key: "dependents", legend: "מי תלוי בך כלכלית?", label: "תלויים", options: ["בן/בת זוג", "ילדים", "הורים", "אף אחד"], multi: true },
    { key: "mortgage", legend: "יש משכנתא פעילה?", label: "משכנתא", options: ["אין", "עד 10 שנים", "10–20 שנים", "מעל 20 שנים"] },
    // A flag and nothing more. The wizard never asks what the issue is and has
    // no field to describe it in — health data stays out of the record.
    { key: "health_flag", legend: "יש נושא בריאותי שכדאי לדבר עליו בפגישה?", label: "סוגיה בריאותית לפגישה", options: ["יש נושא לדיון בפגישה", "אין"] },
    { key: "coverage", legend: "אילו כיסויים יש לך כבר?", label: "כיסויים קיימים", options: ["ביטוח חיים", "בריאות", "אובדן כושר עבודה", "ביטוח משכנתא"], multi: true },
  ],
  retirement: [
    { key: "retirement_horizon", legend: "מתי הפרישה?", label: "אופק הפרישה", options: ["כבר פרשתי", "עד שנה", "1–3 שנים", "3–5 שנים", "יותר מ-5"] },
    { key: "employment_status", legend: "מה המעמד התעסוקתי שלך היום?", label: "מעמד תעסוקתי נוכחי", options: ["שכיר/ה", "עצמאי/ת", "שילוב", "סיימתי לעבוד"] },
    { key: "rights_fixing", legend: "נעשה כבר קיבוע זכויות?", label: "קיבוע זכויות — האם נעשה", options: ["נעשה", "לא נעשה"] },
    { key: "severance_history", legend: "נמשכו פיצויים בעבר?", label: "פיצויים — האם נמשכו בעבר", options: ["כן", "לא"] },
  ],
  tax: [
    { key: "tax_event", legend: "מה האירוע שמעסיק אותך?", label: "האירוע המיסויי שמעסיק", options: ["פרישה", "מכירת נכס", "ירושה", "הכנסה נוספת", "החזר מס"] },
    { key: "filing_status", legend: "את/ה מגיש/ה דוח שנתי?", label: "הגשת דוח שנתי", options: ["מגיש/ה", "לא מגיש/ה"] },
    { key: "prior_handling", legend: "הנושא טופל בעבר על ידי רואה חשבון או יועץ מס?", label: "האם טופל בעבר על ידי גורם מקצועי", options: ["כן", "לא"] },
    { key: "products", legend: "אילו מוצרים יש לך היום?", label: "מוצרים קיימים", options: [...PRODUCTS, "ביטוחים"], multi: true },
  ],
  savings: [
    { key: "horizon", legend: "לכמה זמן הכסף מיועד?", label: "טווח החיסכון", options: ["עד שנה", "1–3 שנים", "3–10 שנים", "מעל 10"] },
    { key: "purpose", legend: "למה הוא נועד?", label: "ייעוד הכסף", options: ["ילדים", "דירה", "כרית ביטחון", "פרישה מוקדמת"] },
    { key: "existing_savings", legend: "אילו אפיקים קיימים כבר?", label: "אפיקים קיימים", options: ["גמל להשקעה", "השתלמות", "פיקדון", "תיק השקעות", "חיסכון לכל ילד", "כלום"], multi: true },
    { key: "liquidity", legend: "הכסף צריך להיות נזיל?", label: "צורך בנזילות", options: ["צריך/ה גישה מהירה", "בעוד כמה שנים", "לא צריך/ה"] },
  ],
  self_employed: [
    { key: "business_type", legend: "מה תחום העיסוק?", label: "תחום העיסוק", options: ["שירותים", "מסחר", "טכנולוגיה", "בריאות", "אחר"] },
    { key: "years_active", legend: "כמה שנים בעסק?", label: "ותק בעסק", options: ["עד 2", "2–5", "5–10", "מעל 10"] },
    { key: "pension_status", legend: "יש לך הסדר פנסיוני לעצמאים?", label: "פנסיה לעצמאים", options: ["יש", "אין"] },
    { key: "study_fund_status", legend: "יש לך קרן השתלמות לעצמאים?", label: "קרן השתלמות לעצמאים", options: ["יש", "אין"] },
  ],
  general: [
    { key: "products", legend: "אילו מוצרים יש לך היום?", label: "מוצרים קיימים", options: [...PRODUCTS, "ביטוחים"], multi: true },
    { key: "notes", legend: "משהו שחשוב לך לשתף?", label: "מה עוד המבקר רצה לשתף", options: [], textOnly: { placeholder: "משפט או שניים" } },
  ],
};

/**
 * Section 7א of the agent's instructions, verbatim. An offer, not a request —
 * the clearinghouse needs a signed power of attorney, never an ID number, and
 * the wizard asks for neither.
 */
export const CLEARINGHOUSE_TEXT =
  "לדורית יש אפשרות לשלוף עבורך תמונת מצב פנסיונית מלאה מהמסלקה הפנסיונית לפני הפגישה, כדי שלא נצטרך לבנות אותה מהזיכרון. זה מחייב ייפוי כוח חתום ממך — דורית תשלח לך אותו, ואפשר גם להסדיר את זה בפגישה עצמה.";

export const CLEARINGHOUSE: Question = {
  key: "clearinghouse",
  legend: "זה מעניין אותך?",
  label: "שליפת נתוני מסלקה",
  options: ["מעוניין/ת", "לא כרגע"],
};

/** What "לא כרגע" is recorded as — the value the agent writes. */
export const CLEARINGHOUSE_VALUES: Record<string, string> = { "מעוניין/ת": "מעוניין/ת", "לא כרגע": "לא" };

export const MEETING_TOPICS = [
  "פיננסים, מיסוי וקיבוע זכויות",
  "גמל, השתלמות ופנסיה",
  "ביטוחי חיים ובריאות",
] as const;
export type MeetingTopic = (typeof MEETING_TOPICS)[number];

/** Derived, not asked: the track already says which meeting this is. */
export const TOPIC_BY_TRACK: Record<Track, MeetingTopic> = {
  pension: "גמל, השתלמות ופנסיה",
  self_employed: "גמל, השתלמות ופנסיה",
  savings: "גמל, השתלמות ופנסיה",
  insurance: "ביטוחי חיים ובריאות",
  retirement: "פיננסים, מיסוי וקיבוע זכויות",
  tax: "פיננסים, מיסוי וקיבוע זכויות",
  general: "פיננסים, מיסוי וקיבוע זכויות",
};

export const SLOTS = [
  { key: "morning", label: "בוקר 09:00–12:00", start: "09:00" },
  { key: "noon", label: "צהריים 12:00–15:00", start: "12:00" },
  { key: "afternoon", label: "אחה״צ 15:00–18:00", start: "15:00" },
] as const;
export type SlotKey = (typeof SLOTS)[number]["key"];

export type DayChoice = "tomorrow" | "this_week" | "next_week" | "date";
export const DAY_LABELS: Record<DayChoice, string> = {
  tomorrow: "מחר",
  this_week: "השבוע",
  next_week: "השבוע הבא",
  date: "בחירת תאריך",
};

export const TIME_NOTE = "זו העדפה בלבד — התיאום הסופי מול דורית.";

export const CONTACT_INTRO =
  "כדי שדורית תוכל לחזור אליך; הפרטים נשמרים אצלה ואצל הצוות שמתפעל את האתר מטעמה.";

export const NOTES_HINT = "בלי ת״ז, מספרי פוליסה או מידע רפואי";

export const CONFIRMATION_FOLLOW_UP = "דורית תחזור אליך אישית לאישור סופי תוך יום עסקים אחד.";

/** Compliance section 6 of the agent's instructions, verbatim. */
export const TRANSPARENCY =
  "הפרטים נשמרים אצל דורית ואצל הצוות שמתפעל את האתר מטעמה, לצורך חזרה אליך ובהתאם למדיניות הפרטיות באתר. אפשר לבקש עיון, תיקון או מחיקה בכל עת.";

/**
 * The one line between screens, chosen by the answer just given.
 *
 * Warmth about the feeling, never reassurance about the situation — the
 * agent's compliance section draws that line for a reason: "אין מה לדאוג" or
 * "זה נשמע בסדר" is a judgement of someone's finances, made by a form.
 */
export const ACKNOWLEDGEMENTS = {
  unknown: "זה בסדר גמור — בדיוק את זה בודקים בפגישה.",
  skipped: "אפשר להשאיר את זה פתוח ולהשלים בפגישה.",
  answered: [
    "תודה — זה עוזר לדורית להבין מאיפה להתחיל.",
    "מצוין, ממשיכים.",
    "רשמתי. עוד כמה שאלות קצרות.",
    "תודה, זה ייתן לפגישה כיוון ברור.",
  ],
} as const;
