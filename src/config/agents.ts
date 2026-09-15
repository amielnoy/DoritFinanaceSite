import { BookOpen, MessagesSquare } from "lucide-react";
import type { AgentDescriptor } from "@/components/dorit/chat/AgentChat";

/**
 * The on-site agents, expressed as data.
 *
 * Open/Closed: adding an agent is a new entry in this table, not another
 * two-hundred-line component.
 *
 * `bookingAssistant` used to be a third entry and a third section. Booking a
 * first meeting was never a separate errand from being interviewed for one —
 * the visitor had already answered six questions before meeting a second chat
 * that asked for their name again. The interview now closes the meeting itself;
 * see the scheduling step in `base44/agents/needs_interview.jsonc`. Everything that genuinely differed between
 * NeedsInterviewChat, BookingAssistantChat and BlogRecommenderChat is here;
 * everything they shared now lives once, in <AgentChat />.
 */
export type AgentKey = "needsInterview" | "blogRecommender";

export const AGENTS: Record<AgentKey, AgentDescriptor> = {
  needsInterview: {
    agent: "needs_interview",
    icon: MessagesSquare,
    sectionId: "interview",
    sectionClassName: "py-24 md:py-32 border-t border-border/60",
    eyebrow: "05 · ההקשבה",
    heading: "שיחה קצרה <br /> לפני הפגישה",
    blurb: "כמה שאלות רגועות, אחת בכל פעם — כדי שדורית תגיע מוכנה ותדע בדיוק למה להקשיב. בסוף השיחה אפשר לקבוע את הפגישה עצמה, באותו מקום.",
    note: "הסיכום נשלח לדורית ולצוות שמתפעל את האתר מטעמה, ומאפשר פגישה ראשונה ממוקדת ואישית יותר.",
    panelTitle: "ראיון היכרות",
    panelSubtitle: "עם הסוכן של דורית",
    inputLabel: "הודעה לסוכן ההיכרות",
    greeting: "שלום, נעים להכיר. אני כאן כדי להכיר אותך קצת — לשמוע באיזה שלב אתה/את בחיים, מה יש ומה חסר, ומה הדאגה או היעד המרכזי כרגע. כך דורית תגיע מוכנה לפגישה הראשונה. נתחיל: ספר/י בקצרה על המצב הנוכחי — משפחה, עבודה, שלב בחיים.",
    conversationName: "ראיון צרכים",
    conversationDescription: "ראיון היכרות ותיאום פגישה",
    tagline:
      "בינה מלאכותית שמשרתת את הלקוח עד לרגע שבו נדרש בעל רישיון — ואז מעבירה לסוכן.",
    guardrails: {
      allowed: [
        "מקשיב ושואל שאלה אחת בכל פעם",
        "מברר את ההקשר הכללי",
        "מסכם לקראת הפגישה",
        "קובע את מועד הפגישה",
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
  blogRecommender: {
    agent: "blog_recommender",
    icon: BookOpen,
    sectionId: "blog-recommender",
    sectionClassName: "py-24 md:py-32 border-t border-border/60",
    eyebrow: "הקריאה",
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
