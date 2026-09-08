import React, { useRef } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Reveal from "@/components/dorit/Reveal";
import Stars from "@/components/dorit/Stars";

interface Brief {
  tag: string;
  title: string;
  body: string;
  metric: string;
  rating: number;
}

const BRIEFS: Brief[] = [
  {
    tag: "תביעת חיים",
    title: "מ-דחייה לאישור מלא תוך 11 ימים",
    body: "משפחה שנתקלה בסירוב ראשוני לתביעת חיים. ניהלתי את ההליך מול החברה, השלמתי תיעוד והבאתי את הכיסוי המלא — בלי שהמשפחה נאלצה להרים טלפון.",
    metric: "₪850K שולמו",
    rating: 5,
  },
  {
    tag: "תכנון פנסיה",
    title: "מסלול שכפל את ההכנסה הצפויה",
    body: "לקוח עצמאי בן 47 עם תיק מפוזר. איחדתי מוצרים, בניתי מסלול מסלק והתאמתי את החשיפה — התוצאה: הכנסה חודשית צפויה כפולה בפרישה.",
    metric: "x2 הכנסה צפויה",
    rating: 5,
  },
  {
    tag: "ביטוח משכנתא",
    title: "חיסכון של 38% בפרמיה",
    body: "זוג עם משכנתא חדשה קיבל הצעה סטנדרטית. בדקתי את הכיסויים מול פרופיל הסיכון האמיתי, הסרתי כפילויות והוזלתי את העלות משמעותית.",
    metric: "38% חיסכון",
    rating: 5,
  },
  {
    tag: "בריאות",
    title: "כיסוי ניתוח שאושר תוך 48 שעות",
    body: "לקוחה שנזקקה לניתוח דחוף ונדחתה פעמיים. התערבתי ישירות מול מחלקת האישורים, והכיסוי אושר בטרם הניתוח.",
    metric: "48 שעות",
    rating: 5,
  },
  {
    tag: "עסק",
    title: "הגנת הון לבעלי עסק",
    body: "שותפים בעסק בינוני ללא הסכם שותפים. בניתי מערך כיסויים שמבטיח המשכיות עסקית והגנת משפחות במקרה של אובדן כושר או פטירה.",
    metric: "100% הגנה",
    rating: 5,
  },
  {
    tag: "חיסכון פנסיוני",
    title: "חיסכון של ₪420K בעמלות ודמי ניהול",
    body: "שכירה בת 39 שהפרישה לארבעה מוצרים שונים עם דמי ניהול גבוהים. איחדתי לשני מסלולים ממוקדים, מיקחתי מול הגופים המוסדיים והורדתי את העמלות — החיסכון המצטבר עד הפרישה מוערך ב-₪420 אלף.",
    metric: "₪420K חיסכון",
    rating: 5,
  },
  {
    tag: "תכנון פיננסי",
    title: "יציאה לעצמאות עם כרית ביטחון בת 3 שנים",
    body: "זוג בשנות ה-40 שרצה לעבור לעצמאות אך חשש מאי-הוודאות. בניתי תכנון פיננסי רב-שנתי: קרן חירום, מיפוי סיכונים ומסלול השקעה מדורג. כעבור שלוש שנים יצאו לעצמאות עם כרית ביטחון מלאה.",
    metric: "3 שנים לעצמאות",
    rating: 5,
  },
];

export default function ProofCarousel() {
  const ref = useRef<HTMLDivElement>(null);

  const scroll = (dir: number) => {
    if (!ref.current) return;
    // RTL: scrollLeft decreases when scrolling visually-right; invert direction
    const amount = 420;
    ref.current.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  return (
    <section id="proof" className="relative py-24 md:py-32 overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div>
            <Reveal>
              <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
                04 · Proof of Resilience
              </span>
              <h2 className="font-heading text-5xl md:text-6xl mt-4">
                תיקי הצלחה
              </h2>
              <div className="mt-5 flex items-center gap-3">
                <Stars value={5} size={20} />
                <span className="text-sm text-foreground/70">
                  <span className="font-heading text-lg text-foreground">5.0</span> · שביעות רצון מלאה בקרב לקוחות
                </span>
              </div>
            </Reveal>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => scroll(1)}
              className="w-11 h-11 border border-border/60 flex items-center justify-center hover:border-[#C3AD96] hover:text-accent transition-colors duration-300"
              aria-label="הבא"
            >
              <ArrowRight size={18} />
            </button>
            <button
              onClick={() => scroll(-1)}
              className="w-11 h-11 border border-border/60 flex items-center justify-center hover:border-[#C3AD96] hover:text-accent transition-colors duration-300"
              aria-label="הקודם"
            >
              <ArrowLeft size={18} />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={ref}
        className="flex gap-6 overflow-x-auto px-6 md:px-10 pb-6 snap-x snap-mandatory scroll-pl-6 [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="shrink-0 w-4 md:w-10" />
        {BRIEFS.map((b, i) => (
          <article
            key={i}
            className="snap-start shrink-0 w-[340px] md:w-[400px] bg-card border border-border/50 p-8 md:p-10 flex flex-col group hover:border-[#C3AD96]/40 transition-colors duration-300"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] tracking-[0.3em] uppercase text-accent">
                {b.tag}
              </span>
              <span className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground/60">
                0{i + 1}
              </span>
            </div>
            <div className="mt-3">
              <Stars value={b.rating} size={16} />
            </div>
            <h3 className="font-heading text-2xl md:text-3xl mt-3 leading-snug">
              {b.title}
            </h3>
            <p className="mt-5 text-foreground/70 leading-relaxed flex-1">
              {b.body}
            </p>
            <div className="mt-8 pt-6 border-t border-border/50 flex items-center justify-between">
              <span className="font-heading text-3xl md:text-4xl text-[#C3AD96] leading-none">
                {b.metric}
              </span>
              <span className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                Case 0{i + 1}
              </span>
            </div>
          </article>
        ))}
        <div className="shrink-0 w-4 md:w-10" />
      </div>
    </section>
  );
}