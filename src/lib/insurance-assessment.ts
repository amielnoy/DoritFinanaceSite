import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Briefcase,
  Heart,
  HeartPulse,
  Shield,
  TrendingUp,
  Umbrella,
} from "lucide-react";

/**
 * The self-assessment's questions and the rules that turn answers into a
 * list of insurance types to look at.
 *
 * Pulled out of the section component so the rules can be unit-tested the way
 * `pension-fee.ts` is: this is the one piece of the home page that makes a
 * claim about what a visitor should consider, and a rule that silently stops
 * firing is exactly the kind of regression a rendered component hides.
 *
 * No product recommendation is made here — the copy names insurance *types*
 * and every result ends by pointing at a conversation with דורית.
 */

export interface Option {
  value: string;
  label: string;
}

export interface Question {
  id: "stage" | "work" | "mortgage" | "health";
  label: string;
  hint: string;
  options: Option[];
}

export type Answers = Partial<Record<Question["id"], string>>;

export interface Recommendation {
  icon: LucideIcon;
  title: string;
  why: string;
  priority: boolean;
}

export const QUESTIONS: Question[] = [
  {
    id: "stage",
    label: "באיזה שלב חיים את/ה?",
    hint: "השלב הנוכחי משפיע על סדר העדיפויות",
    options: [
      { value: "single", label: "רווק/ה" },
      { value: "couple", label: "זוג ללא ילדים" },
      { value: "parent", label: "הורה לילדים" },
      { value: "retiree", label: "לקראת פרישה / פרוש/ת" },
    ],
  },
  {
    id: "work",
    label: "איך את/ה עובד/ת?",
    hint: "אופן התעסוקה משנה את סוג ההגנה הנדרשת",
    options: [
      { value: "employee", label: "שכיר/ה" },
      { value: "selfemployed", label: "עצמאי/ת" },
      { value: "none", label: "לא עובד/ת כרגע" },
    ],
  },
  {
    id: "mortgage",
    label: "יש משכנתא או הלוואות משמעותיות?",
    hint: "התחייבויות גבוהות מחייבות הגנה על המשפחה",
    options: [
      { value: "yes", label: "כן" },
      { value: "no", label: "לא" },
    ],
  },
  {
    id: "health",
    label: "יש מחלות כרוניות או סיכון משפחתי?",
    hint: "רקע רפואי משפיע על היקף הכיסוי המומלץ",
    options: [
      { value: "yes", label: "כן" },
      { value: "no", label: "לא / לא יודע/ת" },
    ],
  },
];

export function buildRecommendations(answers: Answers): Recommendation[] {
  const recs: Recommendation[] = [];
  const stage = answers.stage;
  const work = answers.work;
  const mortgage = answers.mortgage;
  const health = answers.health;

  // ביטוח חיים — תלויים או התחייבויות
  if (stage === "parent" || mortgage === "yes" || stage === "couple") {
    recs.push({
      icon: Heart,
      title: "ביטוח חיים",
      why:
        stage === "parent"
          ? "ילדים תלויים בהכנסתך — ביטוח חיים מבטיח שהם יהיו מוגנים גם אם משהו יקרה."
          : mortgage === "yes"
          ? "משכנתא משמעותית נשארת גם בלעדיך — ביטוח חיים מגן על המשפחה מפני נטל כלכלי."
          : "בן/בת זוג תלויים בהכנסתך המשותפת — כדאי להבטיח הגנה בסיסית.",
      priority: true,
    });
  }

  // ביטוח בריאות משלים — כולם, חזק יותר עם סיכון
  recs.push({
    icon: Activity,
    title: "ביטוח בריאות משלים",
    why:
      health === "yes"
        ? "רקע רפואי משפחתי מעלה את החשיבות של כיסוי לרפואה פרטית, תרופות וטיפולים שאינם בסל."
        : "גם בריאות תקינה נזקקת לרפואה פרטית, טיפולים ותרופות שמחוץ לסל הבסיסי.",
    priority: health === "yes",
  });

  // אובדן כושר עבודה — עצמאי או מפרנס עיקרי עם משכנתא
  if (work === "selfemployed" || (mortgage === "yes" && stage === "parent")) {
    recs.push({
      icon: Shield,
      title: "ביטוח אובדן כושר עבודה",
      why:
        work === "selfemployed"
          ? "עצמאי/ת שאינו/ה עובד/ת עקב מחלה או תאונה — ההכנסה נעצרת לחלוטין. זה הביטוח הקריטי ביותר עבורך."
          : "כשהמשפחה תלויה בהכנסתך ויש משכנתא — אובדן כושר עבודה מגן על היכולת להמשיך ולעמוד בהתחייבויות.",
      priority: true,
    });
  }

  // תאונות אישיות — עצמאי
  if (work === "selfemployed") {
    recs.push({
      icon: Umbrella,
      title: "ביטוח תאונות אישיות",
      why: "כיסוי לנזקי גוף מתאונות — רלוונטי במיוחד לעצמאיים שאינם מוגנים דרך מעסיק.",
      priority: false,
    });
  }

  // תכנון פנסיוני — הורה או לקראת פרישה
  if (stage === "retiree" || stage === "parent") {
    recs.push({
      icon: TrendingUp,
      title: "תכנון פנסיוני / מנהלים",
      why:
        stage === "retiree"
          ? "לקראת פרישה חשוב לבחון את מוצרי החיסכון, דמי הניהול ומסלולי הפרישה — כדי למקסם את ההכנסה הפנסיונית."
          : "ככל שמתקרבים לפרישה, דמי הניהול ובחירת המסלול משפיעים על עשרות אלפי שקלים בעתיד.",
      priority: stage === "retiree",
    });
  }

  // מחלות קשות — סיכון בריאותי
  if (health === "yes") {
    recs.push({
      icon: HeartPulse,
      title: "ביטוח מחלות קשות",
      why: "רקע משפחתי מצדיק כיסוי למחלות קשות — פיצוי חד-פעמי שמאפשר התמודדות כלכלית בעת משבר בריאותי.",
      priority: false,
    });
  }

  // מנהלים לשכיר — נדיר שיש, אבל רלוונטי
  if (work === "employee" && stage !== "retiree") {
    recs.push({
      icon: Briefcase,
      title: "בחינת קרן השתלמות / פנסיה",
      why: "שכירים רבים משלמים דמי ניהול גבוהים מבלי לדעת — כדאי לבחון את המוצרים הקיימים ולהוריד עלויות.",
      priority: false,
    });
  }

  return recs;
}
