import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { Image } from "@/components/ui/image";
import Reveal from "@/components/dorit/primitives/Reveal";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { MD_UP, useMediaQuery } from "@/hooks/useMediaQuery";

const ATMOS =
  "https://media.base44.com/images/public/6a9e6144d2bee5cdfb4ddf74/5b05202dd_generated_7c8e0421.jpg";
const PEN =
  "https://media.base44.com/images/public/6a9e6144d2bee5cdfb4ddf74/199524e64_generated_35057100.jpg";

interface Stat {
  num: string;
  label: string;
}

// Three, not four. "97% שיעור תביעות שאושרו" was here and is gone: a licensed
// agent quoting a performance figure is a regulated claim, and nothing in this
// repo could substantiate it. The grid below is sized to this list — keep the
// two in step, or the bordered strip renders with an empty cell.
const STATS: Stat[] = [
  { num: "30", label: "שנות ניסיון" },
  { num: "מאות", label: "לקוחות מרוצים" },
  { num: "1:1", label: "ליווי אישי" },
];

/**
 * `brief` keeps the first paragraph and the numbers, and drops the career
 * history and the closing note.
 *
 * On the home page this section sits between the hero and the services, where
 * its job is to establish who she is in one breath before the reader moves on.
 * Four paragraphs of biography is the right depth on a page someone chose to
 * open about her — `/perspective` — and the wrong depth here, where it pushes
 * the actual conversation below a second screenful.
 *
 * Below md, `brief` goes one step further: one sentence and the three figures,
 * with the rest folded behind "עוד עליי" — a disclosure that puts the personal
 * first sentence back and offers the full story on /perspective. The pictures
 * and the folded sentence are hidden with CSS rather than left out, so the
 * phone's document still carries everything the desktop's does
 * (e2e/seo/mobile-parity.spec.ts).
 */
export default function About({ variant = "full" }: { variant?: "full" | "brief" }) {
  const brief = variant === "brief";
  const isDesktop = useMediaQuery(MD_UP, true);
  const oneSentence = brief && !isDesktop;
  const [more, setMore] = useState<boolean>(false);
  return (
    <section id="about" className="relative border-b border-border">
      <div className={`max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-[clamp(72px,9vw,120px)] grid grid-cols-1 lg:grid-cols-2 gap-[clamp(40px,6vw,96px)] items-center${brief ? " max-md:py-10" : ""}`}>
        <div className={`order-2 lg:order-1 grid grid-cols-[3fr_2fr] gap-4${brief ? " max-md:hidden" : ""}`}>
          <div className="plate h-[clamp(220px,28vw,360px)]">
            <Image
              src={ATMOS}
              alt="פרט אדריכלי — אור על זכוכית"
              className="w-full h-full object-cover"
              fittingType="fill"
            />
          </div>
          <div className="plate h-[clamp(220px,28vw,360px)]">
            <Image
              src={PEN}
              alt="עט נוצה על משטח אבן"
              className="w-full h-full object-cover"
              fittingType="fill"
            />
          </div>
        </div>

        <div className="order-1 lg:order-2 flex flex-col justify-center">
          <Reveal>
            <Eyebrow>
              01 · מתכננת פיננסית וסוכנת ביטוח
            </Eyebrow>
            <h2 className="font-heading font-normal text-[clamp(34px,4vw,48px)] mt-5 leading-[1.12]">
              מתכננת פיננסית
              <br />
              וסוכנת ביטוח.
            </h2>
          </Reveal>
          <div className={`mt-6 space-y-5 text-foreground/80 max-w-[600px] text-justify text-[19px] leading-[1.8] hyphens-none${brief ? " max-md:mt-4 max-md:text-start max-md:text-[17px] max-md:leading-[1.7]" : ""}`}>
            {oneSentence ? (
              // The same paragraph, its personal first sentence hidden. Split
              // into two runs only here: from md up the paragraph stays one
              // text node, because a run boundary moves the justified line by
              // a pixel.
              <p id="about-more">
                <span className={more ? undefined : "hidden"}>שמי דורית גוב ארי, נשואה לניב ואמא לשגיא, עדן וירין. </span>
                ותיקה בתחומי הפיננסים והביטוח, בעלת רישיון סוכן ותואר אקדמאי במדעי ההתנהגות, ניהול וכלכלה.
              </p>
            ) : (
              <p>
                שמי דורית גוב ארי, נשואה לניב ואמא לשגיא, עדן וירין. ותיקה בתחומי
                הפיננסים והביטוח, בעלת רישיון סוכן ותואר אקדמאי
                במדעי ההתנהגות, ניהול וכלכלה.
              </p>
            )}
            {brief ? null : <p>
              עבדתי שנים ארוכות כמתכננת פיננסית וביטוח עצמאית, 12 שנים בבנק
              מזרחי טפחות כיועצת פנסיונית, ותקופה ארוכה כמתכננת פנסיה ומיסוי
              במרכז לתכנון כלכלי מתקדם בחברת הראל. בשנים האחרונות אני עובדת
              כמתכננת פיננסית בכירה עם התמחות בהיבטי המיסוי השונים, בשיתוף עם
              חברת ארבע עונות — בין חברות התכנון הפיננסי הגדולות בארץ.
            </p>}
            {brief ? null : <p>
              במהלך השנים הבנתי כמה דברים בתחום הפנסיוני: הבלבול, תחושת חוסר
              האונים מול קופות הגמל, ההשתלמות והמוצרים הפנסיוניים השונים, וחוסר
              הידע של האנשים מביא לטעויות משמעותיות דווקא בקשר לכספים הגדולים
              והמשמעותיים ביותר שלהם. הלקוחות זקוקים לפתרונות מותאמים לצרכים
              האישיים שלהם ושל בן/בת הזוג.
            </p>}
            {brief ? null : <p>
              מה שמייחד אותי כאשת מקצוע: שילוב בין מקצועיות וניסיון רבים מאד,
              אכפתיות ויושר אמיתיים כלפי הלקוחות, הסברים בגובה העיניים המובנים
              לכולם בתחום המורכב הזה — ובעיקר אנושיות, יחס חם וחיוך תמיד.
            </p>}
          </div>
          {oneSentence ? (
            // The remainder, folded: "עוד עליי" puts the personal sentence back
            // in the paragraph it follows and offers the whole story, a page away.
            <div className="mt-2 flex flex-wrap items-center gap-x-6">
              <button
                type="button"
                onClick={() => setMore((v) => !v)}
                aria-expanded={more}
                aria-controls="about-more"
                className={ABOUT_LINK}
              >
                עוד עליי
                <ChevronDown
                  size={16}
                  strokeWidth={1.5}
                  aria-hidden="true"
                  className={`motion-safe:transition-transform duration-200 ${more ? "rotate-180" : ""}`}
                />
              </button>
              {more ? (
                <Link to="/perspective" className={ABOUT_LINK}>
                  הסיפור המלא
                  <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          ) : null}
          {brief ? null : (
            <p className="mt-6 font-heading italic text-2xl text-accent">
              — דורית
            </p>
          )}

          <div className={`mt-8 grid grid-cols-3 border-y border-border${brief ? " max-md:mt-6" : ""}`}>
            {STATS.map((s, i) => (
              <div
                key={i}
                className={`px-2 py-6 flex flex-col items-center gap-2 text-center ${i > 0 ? "border-s border-border" : ""}${brief ? " max-md:py-4" : ""}`}
              >
                <p className="font-heading text-[clamp(36px,4vw,52px)] text-accent leading-none lining-nums tabular-nums">
                  {s.num}
                </p>
                <p className="text-[15px] text-muted-foreground">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const ABOUT_LINK =
  "inline-flex items-center gap-1.5 min-h-11 text-[17px] text-accent underline decoration-highlight/50 underline-offset-[6px] hover:decoration-highlight";
