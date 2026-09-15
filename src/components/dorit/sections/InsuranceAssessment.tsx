import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Check,
  RotateCcw,
  Heart,
  HeartPulse,
  Activity,
  Shield,
  Umbrella,
  Briefcase,
  TrendingUp,
  Calendar,
} from "lucide-react";

interface Option {
  value: string;
  label: string;
}

interface Question {
  id: string;
  label: string;
  hint: string;
  options: Option[];
}

const QUESTIONS: Question[] = [
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

interface Recommendation {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  why: string;
  priority: boolean;
}

function buildRecommendations(answers: Record<string, string>): Recommendation[] {
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

export default function InsuranceAssessment() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const current = QUESTIONS[step];
  const progress = done ? 100 : (step / QUESTIONS.length) * 100;

  const choose = (value: string) => {
    const next = { ...answers, [current.id]: value };
    setAnswers(next);
    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
    } else {
      setDone(true);
    }
  };

  const back = () => {
    if (step > 0) setStep(step - 1);
  };

  const restart = () => {
    setAnswers({});
    setStep(0);
    setDone(false);
  };

  const recs = done ? buildRecommendations(answers) : [];
  const priorityCount = recs.filter((r) => r.priority).length;

  return (
    <section id="assessment" className="py-24 md:py-32 bg-background border-t border-border">
      <div className="max-w-[1100px] mx-auto px-6 md:px-10">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <span className="text-[11px] tracking-[0.12em] text-accent">
            בדיקה עצמית
          </span>
          <h2 className="font-heading text-4xl md:text-5xl mt-5 leading-tight">
            איזה ביטוח באמת מתאים לך?
          </h2>
          <p className="mt-6 text-muted-foreground leading-relaxed">
            ארבע שאלות קצרות — ותקבל/י תמונה ברורה של סוגי הביטוח הרלוונטיים לשלב
            החיים שלך. אין כאן ייעוץ פיננסי, אלא מפת דרכים ראשונית להבנת הצרכים.
          </p>
        </div>

        <div className="bg-card border border-border rounded-sm overflow-hidden">
          {/* Progress bar */}
          <div className="h-1 bg-secondary">
            <motion.div
              className="h-full bg-highlight"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>

          <div className="p-8 md:p-12">
            <AnimatePresence mode="wait">
              {!done ? (
                <motion.div
                  key={current.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="flex items-center justify-between mb-8">
                    <span className="text-[11px] tracking-[0.12em] text-muted-foreground">
                      שאלה {step + 1} מתוך {QUESTIONS.length}
                    </span>
                    {step > 0 && (
                      <button
                        onClick={back}
                        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-accent transition-colors"
                      >
                        <ArrowLeft size={15} />
                        חזרה
                      </button>
                    )}
                  </div>

                  <h3 className="font-heading text-2xl md:text-3xl mb-2 leading-snug">
                    {current.label}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-8">{current.hint}</p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {current.options.map((opt) => {
                      const selected = answers[current.id] === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => choose(opt.value)}
                          className={`group text-right p-5 border rounded-sm transition-all duration-200 ${
                            selected
                              ? "border-highlight bg-highlight-muted/40"
                              : "border-border hover:border-accent hover:bg-secondary/50"
                          }`}
                        >
                          <span className="flex items-center justify-between">
                            <span className="font-body text-lg">{opt.label}</span>
                            <span
                              className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                                selected
                                  ? "border-highlight bg-highlight text-primary-foreground"
                                  : "border-border group-hover:border-accent"
                              }`}
                            >
                              {selected && <Check size={12} />}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="results"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="flex items-center justify-between mb-8">
                    <span className="text-[11px] tracking-[0.12em] text-muted-foreground">
                      התוצאה שלך
                    </span>
                    <button
                      onClick={restart}
                      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-accent transition-colors"
                    >
                      <RotateCcw size={15} />
                      התחלה מחדש
                    </button>
                  </div>

                  <h3 className="font-heading text-3xl md:text-4xl mb-3 leading-tight">
                    {recs.length} סוגי ביטוח רלוונטיים עבורך
                  </h3>
                  <p className="text-muted-foreground mb-12">
                    {priorityCount > 0
                      ? `${priorityCount} מהם מומלצים כעדיפות גבוהה לפי התשובות שלך.`
                      : "לפי התשובות שלך, אלו סוגי הביטוח שכדאי לבחון."}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {recs.map((rec, idx) => {
                      const Icon = rec.icon;
                      return (
                        <motion.div
                          key={rec.title}
                          initial={{ opacity: 0, y: 12 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, delay: idx * 0.08 }}
                          className={`flex gap-5 p-6 md:p-7 border rounded-sm transition-colors duration-300 ${
                            rec.priority
                              ? "border-highlight/40 bg-highlight-muted/15 hover:bg-highlight-muted/25"
                              : "border-border bg-secondary/30 hover:bg-secondary/50"
                          }`}
                        >
                          <div
                            className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
                              rec.priority ? "bg-highlight text-primary-foreground" : "bg-background text-accent border border-border"
                            }`}
                          >
                            <Icon size={22} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2.5 mb-2">
                              <h4 className="font-heading text-xl">{rec.title}</h4>
                              {rec.priority && (
                                <span className="text-[10px] tracking-[0.2em] uppercase text-highlight-strong border border-highlight/40 px-2 py-0.5 rounded-sm">
                                  עדיפות גבוהה
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed">{rec.why}</p>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>

                  <div className="mt-12 pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-5">
                    <p className="text-sm text-muted-foreground text-center sm:text-right">
                      ההערכה כאן היא כללית בלבד. להמלצות מדויקות — כדאי לשוחח עם דורית.
                    </p>
                    <a
                      href="#start"
                      className="inline-flex items-center gap-2 px-7 py-3.5 bg-highlight text-primary-foreground font-medium hover:bg-highlight-strong transition-colors duration-300 shadow-sm whitespace-nowrap"
                    >
                      <Calendar size={18} />
                      לשיחה קצרה עם דורית
                    </a>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground/70 mt-6 max-w-xl mx-auto leading-relaxed">
          הכלי נועד להערכה ראשונית בלבד ואינו מהווה ייעוץ פיננסי או המלצה לרכישת
          מוצר. ההמלצות המדויקות ניתנות אך ורק בפגישה אישית.
        </p>
      </div>
    </section>
  );
}