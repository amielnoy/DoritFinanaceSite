import React, { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown } from "lucide-react";
import Reveal from "@/components/dorit/primitives/Reveal";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { MD_UP, useMediaQuery } from "@/hooks/useMediaQuery";

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

/**
 * Below md the strip stays a strip, made shorter: each case shows its tag, its
 * headline and its figure (with the figure's basis, which never leaves it), and
 * the story behind it is folded behind "פרטי המקרה" — a real button with
 * aria-expanded that unfolds it in place, one case at a time or several. The
 * folded story is `hidden`, not left out, so the phone's document still carries
 * everything the desktop's does (e2e/seo/mobile-parity.spec.ts). The
 * disclaimer under the heading is unchanged and in view. From md up nothing
 * changes.
 */
export default function ProofCarousel() {
  const ref = useRef<HTMLDivElement>(null);
  const isDesktop = useMediaQuery(MD_UP, true);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const scroll = (dir: number) => {
    if (!ref.current) return;
    // RTL: scrollLeft runs from 0 at the start down to negative values, so a
    // positive step goes back towards the first case and a negative one on.
    // One step is one card and its gap: 400 + 20 from md up, as before, and the
    // narrower card's width on a phone.
    const card = ref.current.querySelector("article");
    const gap = parseFloat(getComputedStyle(ref.current).columnGap) || 0;
    const amount = card?.offsetWidth ? card.offsetWidth + gap : 420;
    ref.current.scrollBy({ left: dir * amount, behavior: "smooth" });
  };

  return (
    <section id="proof" className="relative border-b border-border overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] pt-[clamp(72px,9vw,120px)] pb-10 flex flex-wrap items-end justify-between gap-6 max-md:pt-10 max-md:pb-5 max-md:grid max-md:grid-cols-[1fr_auto] max-md:items-center max-md:gap-x-4 max-md:gap-y-0">
        {/* Below md the header is a grid: the arrows share the kicker's row,
            and the heading and the disclaimer keep the full width under it. */}
        <div className="max-md:contents">
          <Reveal className="max-md:contents">
            <Eyebrow>
              04 · מקרים מהשטח
            </Eyebrow>
            <h2 className="font-heading font-normal text-[clamp(34px,4vw,48px)] leading-[1.12] mt-[18px] max-md:mt-3 max-md:col-span-2">
              תיקי הצלחה
            </h2>
            <p className="mt-[18px] text-[15px] text-muted-foreground max-w-xl max-md:mt-3 max-md:col-span-2">
              תוצאות עבר אינן מבטיחות תוצאות דומות — כל מקרה תלוי בנתונים
              האישיים.
            </p>
          </Reveal>
        </div>
        {/* In RTL the right-hand button (→) goes back towards the first case
            and the left-hand one (←) on to the next — the names say so. */}
        <div className="flex items-center gap-2 max-md:col-start-2 max-md:row-start-1">
          <button
            onClick={() => scroll(1)}
            className={ARROW}
            aria-label="הקודם"
          >
            <ArrowRight size={18} strokeWidth={1.5} />
          </button>
          <button
            onClick={() => scroll(-1)}
            className={ARROW}
            aria-label="הבא"
          >
            <ArrowLeft size={18} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      <div
        ref={ref}
        /* tabIndex + role: a horizontally scrollable region needs keyboard
           access (axe: scrollable-region-focusable). */
        tabIndex={0}
        role="region"
        aria-label="תיקי הצלחה — גלילה אופקית"
        className="flex gap-5 overflow-x-auto px-[clamp(20px,4vw,40px)] pb-[clamp(72px,9vw,120px)] snap-x snap-mandatory [&::-webkit-scrollbar]:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight max-md:gap-4 max-md:pb-10"
        style={{ scrollbarWidth: "none" }}
      >
        {BRIEFS.map((b, i) => {
          const expanded = open.has(i);
          return (
            <article
              key={i}
              className="snap-start shrink-0 w-[min(84vw,400px)] rounded-md border border-border hover:border-highlight p-8 flex flex-col gap-4 transition-colors duration-200 max-md:p-5 max-md:gap-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm px-2.5 py-0.5 rounded-sm bg-[hsl(33_100%_95%)] text-[hsl(37_80%_20%)]">
                  {b.tag}
                </span>
                <span className="font-heading text-xl lining-nums tabular-nums text-muted-foreground">
                  0{i + 1}
                </span>
              </div>
              <h3 className="font-heading font-medium text-[26px] leading-[1.3] max-md:text-[21px]">
                {b.title}
              </h3>
              <p
                id={isDesktop ? undefined : `proof-${i}-story`}
                hidden={isDesktop ? undefined : !expanded}
                className="text-base leading-[1.75] text-foreground/80 flex-1 max-md:text-[15px] max-md:leading-[1.7]"
              >
                {b.body}
              </p>
              <div className="pt-[18px] border-t border-border flex items-center justify-between max-md:pt-3 max-md:flex-wrap max-md:gap-x-3">
                <span className="flex flex-col gap-1.5 max-md:gap-1">
                  <span className="block font-heading text-[32px] text-accent leading-[1.1] max-md:text-[26px]">
                    {b.metric}
                  </span>
                  {b.basis ? (
                    <span className="block text-[13px] text-muted-foreground">{b.basis}</span>
                  ) : null}
                </span>
                {/* Below md the case number is the one at the top; this place
                    takes the button that unfolds the story. */}
                <span className="text-sm text-muted-foreground max-md:hidden">
                  מקרה 0{i + 1}
                </span>
                {isDesktop ? null : (
                  <button
                    type="button"
                    onClick={() => toggle(i)}
                    aria-expanded={expanded}
                    aria-controls={`proof-${i}-story`}
                    className={STORY}
                  >
                    פרטי המקרה
                    <ChevronDown
                      size={16}
                      strokeWidth={1.5}
                      aria-hidden="true"
                      className={`motion-safe:transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

const ARROW =
  "w-12 h-12 rounded-md border border-border flex items-center justify-center text-foreground hover:border-highlight hover:text-accent transition-colors duration-200 max-md:w-11 max-md:h-11";

const STORY =
  "inline-flex items-center gap-1.5 min-h-11 text-[15px] text-accent underline decoration-highlight/50 underline-offset-[6px] hover:decoration-highlight";
