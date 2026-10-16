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
  /** Which recommendation — stable across languages. */
  id: string;
  /** Which of its reasons applied. */
  reason: string;
  /** The Hebrew name and reason (REC_TITLES, REC_REASONS). */
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

/** Each recommendation's name, by id — the Hebrew; other languages in tools.json (`assess.rec.<id>`). */
export const REC_TITLES = {
  life: "ביטוח חיים",
  health: "ביטוח בריאות משלים",
  disability: "ביטוח אובדן כושר עבודה",
  accidents: "ביטוח תאונות אישיות",
  pension: "תכנון פנסיוני / מנהלים",
  critical: "ביטוח מחלות קשות",
  review: "בחינת קרן השתלמות / פנסיה",
} as const;

/** Why it is recommended, by reason — the Hebrew; other languages in tools.json (`assess.why.<reason>`). */
export const REC_REASONS = {
  "life.parent": "ילדים תלויים בהכנסתך — ביטוח חיים מבטיח שהם יהיו מוגנים גם אם משהו יקרה.",
  "life.mortgage": "משכנתא משמעותית נשארת גם בלעדיך — ביטוח חיים מגן על המשפחה מפני נטל כלכלי.",
  "life.couple": "בן/בת זוג תלויים בהכנסתך המשותפת — כדאי להבטיח הגנה בסיסית.",
  "health.history": "רקע רפואי משפחתי מעלה את החשיבות של כיסוי לרפואה פרטית, תרופות וטיפולים שאינם בסל.",
  "health.general": "גם בריאות תקינה נזקקת לרפואה פרטית, טיפולים ותרופות שמחוץ לסל הבסיסי.",
  "disability.selfEmployed": "עצמאי/ת שאינו/ה עובד/ת עקב מחלה או תאונה — ההכנסה נעצרת לחלוטין. זה הביטוח הקריטי ביותר עבורך.",
  "disability.family": "כשהמשפחה תלויה בהכנסתך ויש משכנתא — אובדן כושר עבודה מגן על היכולת להמשיך ולעמוד בהתחייבויות.",
  "accidents": "כיסוי לנזקי גוף מתאונות — רלוונטי במיוחד לעצמאיים שאינם מוגנים דרך מעסיק.",
  "pension.retiree": "לקראת פרישה חשוב לבחון את מוצרי החיסכון, דמי הניהול ומסלולי הפרישה — כדי למקסם את ההכנסה הפנסיונית.",
  "pension.parent": "עם ילדים בבית קל לדחות את החיסכון לפרישה — אבל דמי הניהול ובחירת המסלול בשנים האלה מצטברים לעשרות אלפי שקלים עד הפרישה.",
  "critical": "רקע משפחתי מצדיק כיסוי למחלות קשות — פיצוי חד-פעמי שמאפשר התמודדות כלכלית בעת משבר בריאותי.",
  "review": "שכירים רבים משלמים דמי ניהול גבוהים מבלי לדעת — כדאי לבחון את המוצרים הקיימים ולהוריד עלויות.",
} as const;

const rec = (
  icon: LucideIcon,
  id: keyof typeof REC_TITLES,
  reason: keyof typeof REC_REASONS,
  priority: boolean,
): Recommendation => ({ icon, id, reason, title: REC_TITLES[id], why: REC_REASONS[reason], priority });

export function buildRecommendations(answers: Answers): Recommendation[] {
  const recs: Recommendation[] = [];
  const stage = answers.stage;
  const work = answers.work;
  const mortgage = answers.mortgage;
  const health = answers.health;

  if (stage === "parent" || mortgage === "yes" || stage === "couple") {
    recs.push(rec(Heart, "life", stage === "parent" ? "life.parent" : mortgage === "yes" ? "life.mortgage" : "life.couple", true));
  }

  recs.push(rec(Activity, "health", health === "yes" ? "health.history" : "health.general", health === "yes"));

  if (work === "selfemployed" || (mortgage === "yes" && stage === "parent")) {
    recs.push(rec(Shield, "disability", work === "selfemployed" ? "disability.selfEmployed" : "disability.family", true));
  }

  if (work === "selfemployed") {
    recs.push(rec(Umbrella, "accidents", "accidents", false));
  }

  if (stage === "retiree" || stage === "parent") {
    recs.push(rec(TrendingUp, "pension", stage === "retiree" ? "pension.retiree" : "pension.parent", stage === "retiree"));
  }

  if (health === "yes") {
    recs.push(rec(HeartPulse, "critical", "critical", false));
  }

  if (work === "employee" && stage !== "retiree") {
    recs.push(rec(Briefcase, "review", "review", false));
  }

  return recs;
}
