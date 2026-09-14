import type { AgentDescriptor } from "@/components/dorit/chat/AgentChat";

/**
 * The three on-site agents, expressed as data.
 *
 * Open/Closed: adding a fourth agent is a new entry in this table, not a fourth
 * two-hundred-line component. Everything that genuinely differed between
 * NeedsInterviewChat, BookingAssistantChat and BlogRecommenderChat is here;
 * everything they shared now lives once, in <AgentChat />.
 */
export type AgentKey = "needsInterview" | "bookingAssistant" | "blogRecommender";

export const AGENTS: Record<AgentKey, AgentDescriptor> = {
  needsInterview: {
    agent: "needs_interview",
    sectionId: "interview",
    sectionClassName: "py-24 md:py-32 border-t border-border/60",
    eyebrow: "06 · ההקשבה",
    heading: "שיחה קצרה <br /> לפני הפגישה",
    blurb: "כמה שאלות רגועות, אחת בכל פעם — כדי שדורית תגיע מוכנה ותדע בדיוק למה להקשיב. ללא התחייבות, ללא נוסחאות. רק הקשבה.",
    note: "הסיכום נשמר אצל דורית בלבד, ומאפשר פגישה ראשונה ממוקדת ואישית יותר.",
    panelTitle: "ראיון היכרות",
    panelSubtitle: "עם הסוכן של דורית",
    inputLabel: "הודעה לסוכן ההיכרות",
    greeting: "שלום, נעים להכיר. אני כאן כדי להכיר אותך קצת — לשמוע באיזה שלב אתה/את בחיים, מה יש ומה חסר, ומה הדאגה או היעד המרכזי כרגע. כך דורית תגיע מוכנה לפגישה הראשונה. נתחיל: ספר/י בקצרה על המצב הנוכחי — משפחה, עבודה, שלב בחיים.",
    conversationName: "ראיון צרכים",
    conversationDescription: "ראיון היכרות עם מבקר",
    tagline:
      "בינה מלאכותית שמשרתת את הלקוח עד לרגע שבו נדרש בעל רישיון — ואז מעבירה לסוכן.",
    guardrails: {
      allowed: [
        "מקשיב ושואל שאלה אחת בכל פעם",
        "מברר את ההקשר הכללי",
        "מסכם לקראת הפגישה",
      ],
      forbidden: [
        "לא ממליץ על מוצר או גוף",
        "לא מוסר תשואות, דמי ניהול או חישובים",
        "לא מפרש פוליסה ולא מטפל בתביעה או בתלונה",
      ],
      handoff:
        "בכל שאלה שדורשת בעל רישיון, בכל ספק — וברגע שתבקשו, בכפתור שבראש הצ׳אט.",
    },
  },
  bookingAssistant: {
    agent: "booking_assistant",
    sectionId: "booking-assistant",
    sectionClassName: "py-24 md:py-32 border-t border-border/60 bg-secondary/30",
    eyebrow: "08 · הקו הישיר",
    heading: "קובעים פגישה <br /> בשיחה",
    blurb: "שיחה קצרה עם העוזרת של דורית — בוחרים נושא, מועד, ומשאירים פרטים. הפגישה נקבעת ישירות ביומנים של דורית, והיא חוזרת לאישור סופי תוך יום עסקים.",
    note: "הפרטים נשמרים אצל דורית בלבד, והתיאום המדויק נעשה איתה אישית.",
    panelTitle: "תיאום פגישת היכרות",
    panelSubtitle: "עם העוזרת של דורית",
    inputLabel: "הודעה לסוכן תיאום הפגישות",
    greeting: "שלום, נעים להכיר. אני כאן כדי לעזור לקבוע את פגישת ההיכרות הראשונה עם דורית — שיחה קצרה ותכליתית. באיזה נושא נרצה להיפגש? אפשר לבחור: פיננסים מיסוי וקיבוע זכויות, גמל/השתלמות/פנסיה, או ביטוחי חיים ובריאות.",
    conversationName: "תיאום פגישה",
    conversationDescription: "תיאום פגישת היכרות",
  },
  blogRecommender: {
    agent: "blog_recommender",
    sectionId: "blog-recommender",
    sectionClassName: "py-24 md:py-32 border-t border-border/60",
    eyebrow: "09 · הקריאה",
    heading: "מה <br /> לקרוא?",
    blurb: "ספרו בקצרה על הדאגה או הסקרנות הפיננסית שלכם, והעוזרת של דורית תמליץ על המאמרים הרלוונטיים ביותר מהבלוג — מותאמים אישית לשאלה שלכם.",
    note: "המלצות מדויקות, על בסיס תוכן המאמרים שכבר פורסמו.",
    panelTitle: "המלצות קריאה",
    panelSubtitle: "עם העוזרת של דורית",
    inputLabel: "הודעה לסוכן המלצות התוכן",
    greeting: "שלום. אני כאן כדי להמליץ לך על מאמרים רלוונטיים מהבלוג של דורית. באיזה נושא פיננסי מעניין אותך לקרוא? למשל: פנסיה, גמל והשתלמות, מיסוי, קיבוע זכויות, ביטוחי חיים ובריאות, דמי ניהול, פרישה.",
    conversationName: "המלצות קריאה",
    conversationDescription: "המלצות מאמרים לפי נושא",
  },
};
