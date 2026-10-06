import React, { useRef } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import Reveal from "@/components/dorit/primitives/Reveal";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";

interface Brief {
  tag: string;
  title: string;
  body: string;
  metric: string;
  /** Under the figure, when the figure is a projection rather than a fact. */
  basis?: string;
}

/**
 * Cases, not promises.
 *
 * A licensed agent publishing an outcome is making a regulated claim, so each
 * figure here is either something that happened or labelled as an estimate,
 * with what it rests on. "100% הגנה" is gone: no insurance protects fully, and
 * saying so misleads whatever the case. So are the per-case five stars and the
 * "5.0 · שביעות רצון מלאה" line, which rated the cases on Dorit's own say and
 * named no source.
 */

const BRIEFS: Brief[] = [
  {
    tag: "תביעת חיים",
    title: "מ-דחייה לאישור מלא תוך 11 ימים",
    body: "משפחה שנתקלה בסירוב ראשוני לתביעת חיים. ניהלתי את ההליך מול החברה, השלמתי תיעוד והבאתי את הכיסוי המלא — בלי שהמשפחה נאלצה להרים טלפון.",
    metric: "₪850K שולמו",
  },
  {
    tag: "תכנון פנסיה",
    title: "תכנון שהכפיל את ההכנסה הצפויה בפרישה",
    body: "לקוח עצמאי בן 47 עם תיק מפוזר. איחדתי מוצרים, בניתי מסלול מותאם והתאמתי את החשיפה — לפי התחזית, הכנסה חודשית בפרישה גבוהה פי שניים מזו שבתיק המקורי.",
    metric: "פי 2 בתחזית",
    basis: "הערכה המבוססת על הנחות של תשואה ודמי ניהול",
  },
  {
    tag: "ביטוח משכנתא",
    title: "חיסכון של 38% בפרמיה",
    body: "זוג עם משכנתא חדשה קיבל הצעה סטנדרטית. בדקתי את הכיסויים מול פרופיל הסיכון האמיתי, הסרתי כפילויות והוזלתי את העלות משמעותית.",
    metric: "38% פחות בפרמיה",
  },
  {
    tag: "בריאות",
    title: "כיסוי ניתוח שאושר תוך 48 שעות",
    body: "לקוחה שנזקקה לניתוח דחוף ונדחתה פעמיים. התערבתי ישירות מול מחלקת האישורים, והכיסוי אושר בטרם הניתוח.",
    metric: "48 שעות",
  },
  {
    tag: "עסק",
    title: "כיסוי לשותפים בעסק",
    body: "שותפים בעסק בינוני ללא הסכם שותפים. בניתי מערך כיסויים שנועד לתמוך בהמשכיות העסק ובמשפחות במקרה של אובדן כושר עבודה או פטירה.",
    metric: "המשכיות עסקית",
  },
  {
    tag: "חיסכון פנסיוני",
    title: "חיסכון מוערך של ₪420K בדמי ניהול",
    body: "שכירה בת 39 שהפקידה לארבעה מוצרים שונים עם דמי ניהול גבוהים. איחדתי לשני מסלולים ממוקדים, ניהלתי משא ומתן מול הגופים המוסדיים והורדתי את דמי הניהול — החיסכון המצטבר עד הפרישה מוערך ב-₪420 אלף.",
    metric: "₪420K בהערכה",
    basis: "הערכה המבוססת על הנחות של תשואה ודמי ניהול",
  },
  {
    tag: "תכנון פיננסי",
    title: "יציאה לעצמאות עם כרית ביטחון בת 3 שנים",
    body: "זוג בשנות ה-40 שרצה לעבור לעצמאות אך חשש מאי-הוודאות. בניתי תכנון פיננסי רב-שנתי: קרן חירום, מיפוי סיכונים ומסלול השקעה מדורג. כעבור שלוש שנים יצאו לעצמאות עם כרית ביטחון מלאה.",
    metric: "3 שנים לעצמאות",
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
              <Eyebrow>
                04 · מקרים מהשטח
              </Eyebrow>
              <h2 className="font-heading text-5xl md:text-6xl mt-4">
                תיקי הצלחה
              </h2>
              <p className="mt-5 text-sm text-foreground/70 max-w-xl">
                תוצאות עבר אינן מבטיחות תוצאות דומות — כל מקרה תלוי בנתונים
                האישיים.
              </p>
            </Reveal>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => scroll(1)}
              className="w-11 h-11 border border-border/60 flex items-center justify-center hover:border-highlight-muted hover:text-accent transition-colors duration-300"
              aria-label="הבא"
            >
              <ArrowRight size={18} />
            </button>
            <button
              onClick={() => scroll(-1)}
              className="w-11 h-11 border border-border/60 flex items-center justify-center hover:border-highlight-muted hover:text-accent transition-colors duration-300"
              aria-label="הקודם"
            >
              <ArrowLeft size={18} />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={ref}
        /* tabIndex + role: a horizontally scrollable region needs keyboard
           access (axe: scrollable-region-focusable). */
        tabIndex={0}
        role="region"
        aria-label="תיקי הצלחה — גלילה אופקית"
        className="flex gap-6 overflow-x-auto px-6 md:px-10 pb-6 snap-x snap-mandatory scroll-pl-6 [&::-webkit-scrollbar]:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="shrink-0 w-4 md:w-10" />
        {BRIEFS.map((b, i) => (
          <article
            key={i}
            className="snap-start shrink-0 w-[340px] md:w-[400px] bg-card border border-border/50 p-8 md:p-10 flex flex-col group hover:border-highlight-muted/40 transition-colors duration-300"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm px-2.5 py-0.5 rounded-sm bg-[hsl(33_100%_95%)] text-[hsl(37_80%_20%)]">
                {b.tag}
              </span>
              <span className="font-heading text-xl tabular-nums text-muted-foreground">
                0{i + 1}
              </span>
            </div>
            <h3 className="font-heading text-2xl md:text-3xl mt-4 leading-snug">
              {b.title}
            </h3>
            <p className="mt-5 text-foreground/70 leading-relaxed flex-1">
              {b.body}
            </p>
            <div className="mt-8 pt-6 border-t border-border/50 flex items-center justify-between">
              <span>
                <span className="block font-heading text-3xl md:text-4xl text-highlight-ink leading-none">
                  {b.metric}
                </span>
                {b.basis ? (
                  <span className="block mt-2 text-[12px] text-muted-foreground">{b.basis}</span>
                ) : null}
              </span>
              <span className="text-sm text-muted-foreground">
                מקרה 0{i + 1}
              </span>
            </div>
          </article>
        ))}
        <div className="shrink-0 w-4 md:w-10" />
      </div>
    </section>
  );
}