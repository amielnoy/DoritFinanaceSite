import { BookOpen, LifeBuoy, MessagesSquare } from "lucide-react";
import type { AgentDescriptor } from "@/components/dorit/chat/AgentChat";
import { SUPPORT_CONSENT_POINTS } from "@/config/compliance";

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
export type AgentKey = "needsInterview" | "blogRecommender" | "support";

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
  /**
   * The open question, with no interview attached.
   *
   * The other two chats each want something from the visitor: one interviews
   * them, one recommends reading. Someone who arrives with a plain question —
   * what is a קרן השתלמות, what happens at the first meeting — had nowhere to
   * ask it and had to start an interview to find out. This is the same agent
   * that answers on WhatsApp, so the answer is the same answer wherever it is
   * asked; see `base44/agents/support_agent.jsonc`.
   */
  support: {
    agent: "support_agent",
    icon: LifeBuoy,
    sectionId: "support-chat",
    sectionClassName: "py-24 md:py-32 border-t border-border/60",
    eyebrow: "שאלה חופשית",
    heading: "לא מצאתם <br /> את התשובה?",
    blurb: "שאלו כאן בחופשיות. העוזר של דורית עונה על שאלות כלליות מתוך התוכן שפורסם באתר — מסביר מונחים ומפנה למאמר הרלוונטי. לשאלה שנוגעת למקרה שלכם, הוא מעביר לדורית עצמה.",
    note: "אין צורך למסור פרטים כדי לשאול. תוכן השיחה נשמר אצל דורית ואצל הצוות שמתפעל את האתר מטעמה.",
    panelTitle: "שאלות ותשובות",
    panelSubtitle: "עם העוזר של דורית",
    inputLabel: "הודעה לסוכן התמיכה",
    greeting: "שלום, כאן העוזר האוטומטי של דורית גוב ארי — לא דורית עצמה. אני עונה על שאלות כלליות מתוך התוכן שפורסם באתר, לא נותן ייעוץ, ואפשר לעבור לדורית בכל רגע. מה תרצו לדעת?",
    conversationName: "שאלה לתמיכה",
    conversationDescription: "מענה על שאלות כלליות מתוך תוכן האתר",
    consentPoints: SUPPORT_CONSENT_POINTS,
    tagline:
      "עונה ממה שכבר פורסם. כל דבר שנוגע למקרה שלכם עובר לדורית — היא בעלת הרישיון, לא הצ׳אט.",
    guardrails: {
      allowed: [
        "מסביר מונחים באופן כללי",
        "מפנה למאמר שפורסם בבלוג",
        "עונה מה כולל השירות ואיך קובעים פגישה",
      ],
      forbidden: [
        "לא עונה על 'מה כדאי לי' ולא על מקרה אישי",
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
