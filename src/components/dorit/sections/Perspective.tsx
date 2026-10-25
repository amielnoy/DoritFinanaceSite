import React from "react";
import { Hourglass, PieChart, Quote, ShieldCheck, TrendingUp, UserCheck, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";

interface Guideline {
  n: string;
  icon: LucideIcon;
  title: string;
  body: string;
}

const GUIDELINES: Guideline[] = [
  {
    n: "01",
    icon: UserCheck,
    title: "היעזרו באנשי מקצוע מנוסים",
    body: "אנשי מקצוע שחיים את השוק ביומיום ויודעים להתאים בזמן אמת את הפעולות לצרכים האישיים שלכם — לא תבניות גנריות, אלא החלטות מדויקות.",
  },
  {
    n: "02",
    icon: Hourglass,
    title: "אל תפעלו בחיפזון",
    body: "ברוב המקרים אין צורך לשנות באופן קיצוני את רמת הסיכון. קיצוץ עמדות בעיצומם של מבצעים עלול לפגוע ברווחיות לשנים ארוכות.",
  },
  {
    n: "03",
    icon: PieChart,
    title: "אמצו פיזור ואיזון",
    body: "חלקו את הכספים בין אפיקים שונים — בארץ ובחו״ל, חשיפה למט״ח ולמטבע המקומי, חלוקה נכונה בין מניות ואג״ח. פיזור הופך את ההשקעה למאזנת את עצמה.",
  },
  {
    n: "04",
    icon: Wallet,
    title: "שמרו על נזילות",
    body: "נזילות של חלק מהכספים היא יצירת ביטחון כלכלי. וכדאי לזכור — משבר יוצר גם הזדמנויות שנוכל לנצל במקרה הצורך.",
  },
  {
    n: "05",
    icon: TrendingUp,
    title: "אופטימיות וראייה ארוכת טווח",
    body: "ממלחמות העבר למדנו שלאחריהן (למעט יום כיפור) היתה עלייה מהירה של השוק, אפילו מעבר לרמה שלפניהן. גם המלחמה הזו, בסופו של דבר, תהיה מאחורינו.",
  },
];

/**
 * The essay in a card, her quote beside it in a blue one, and the five
 * guidelines as a grid of cards: three, then two. The words are hers and
 * unchanged; the paragraph's closing sentence, its point, is set apart.
 */
export default function Perspective() {
  return (
    <section id="perspective" className="relative py-16 md:py-24 border-b border-border">
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] flex flex-col gap-12 md:gap-16">
        {/* Header */}
        <div className="max-w-3xl">
          <Eyebrow>
            נקודת מבט · מתוך השטח
          </Eyebrow>
          {/* The page's h1: this section is /perspective's opening and is
              rendered nowhere else. It was an h2, which left the page with no
              h1 at all (D-08, manual test 2026-10-14). */}
          <h1 className="font-heading font-extrabold text-[clamp(34px,4.4vw,56px)] mt-5 leading-[1.15] tracking-[-0.02em]">
            בזמנים לא ודאיים,
            <br />
            <span className="text-accent">הקול השקול הוא הנכס</span>
          </h1>
        </div>

        {/* Anecdote in her voice */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          <div className="lg:col-span-7 card-raised p-6 sm:p-10 space-y-6 text-foreground/80 leading-relaxed">
            <p>
              מיד אחרי ה-7 באוקטובר התחילו לפנות אליי לקוחות רבים. כמעט כל שיחה
              נפתחה בהתנצלות: <span className="font-semibold text-accent">״הכל בסדר אצלך?״, ״אפשר לדבר עכשיו?״, ״אני מצטער שאני פונה, אבל...״</span> —
              כאילו הרגישו נבוכים להטריד אותי ב״שטויות שלהם״ בזמן מלחמה.
            </p>
            <p>
              אבל אין דבר רחוק יותר מ״שטויות״. משבר כלכלי מביא חוסר יציבות ומצבי
              קיצון, אך לפני ההיבטים הכלכליים נדרשת הכרה בעובדה שמשבר כזה שזור
              בהתמודדויות נפשיות לא פשוטות — חוסר ודאות, חרדות, דאגה לקרובים
              ולמקום מגורים בטוח.
            </p>
            <p className="flex items-start gap-3 rounded-xl border border-highlight/20 bg-highlight/5 p-5 text-foreground">
              <ShieldCheck size={22} strokeWidth={1.75} className="text-accent shrink-0 mt-1" aria-hidden="true" />
              <span>
                ולכן, גם כשמתנהלת מלחמה, נדרש לפעול באופן שקול ואחראי — מתוך
                שיקולים כלכליים ולא מתוך אמוציות.
              </span>
            </p>
          </div>

          <aside className="lg:col-span-5 relative overflow-hidden rounded-2xl bg-primary text-primary-foreground p-8 sm:p-10 shadow-[0_12px_32px_-12px_hsl(var(--primary)/0.5)]">
            <Quote size={32} className="text-primary-foreground/60 mb-5" strokeWidth={1.25} aria-hidden="true" />
            <p className="font-heading font-bold text-2xl md:text-[28px] leading-snug">
              ״הלקוחות שלי לא צריכים להתנצל. החיים הכלכליים שלהם הם בדיוק
              המקום שבו האנושיות והמקצועיות נפגשות.״
            </p>
            <p className="mt-6 text-[15px] font-medium text-primary-foreground/85">
              — דורית גוב ארי
            </p>
          </aside>
        </div>

        {/* Guidelines */}
        <div>
          <h2 className="font-heading font-bold text-[clamp(26px,3vw,36px)] leading-[1.2] mb-8">
            חמישה עקרונות לניהול כלכלי בזמן משבר
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            {GUIDELINES.map((g, i) => {
              const Icon = g.icon;
              return (
                <div
                  key={g.n}
                  className={`group card-raised p-6 sm:p-7 flex flex-col gap-3 transition-shadow duration-300 hover:shadow-md ${i < 3 ? "md:col-span-2" : "md:col-span-3"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="w-11 h-11 rounded-xl bg-secondary flex items-center justify-center text-accent transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground" aria-hidden="true">
                      <Icon size={22} strokeWidth={1.5} />
                    </span>
                    <span className="font-heading font-bold text-[32px] leading-none text-muted-foreground group-hover:text-accent transition-colors duration-300 lining-nums tabular-nums">
                      {g.n}
                    </span>
                  </div>
                  <h3 className="font-heading font-bold text-xl leading-snug mt-2">
                    {g.title}
                  </h3>
                  <p className="text-[17px] text-foreground/80 leading-relaxed">
                    {g.body}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
