import React from "react";
import { Image } from "@/components/ui/image";
import Reveal from "@/components/dorit/primitives/Reveal";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";

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
 */
export default function About({ variant = "full" }: { variant?: "full" | "brief" }) {
  const brief = variant === "brief";
  return (
    <section id="about" className="relative border-b border-border">
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-[clamp(72px,9vw,120px)] grid grid-cols-1 lg:grid-cols-2 gap-[clamp(40px,6vw,96px)] items-center">
        <div className="grid grid-cols-2 gap-4">
          <div className="plate h-[300px] col-span-2">
            <Image
              src={ATMOS}
              alt="פרט אדריכלי — אור על זכוכית"
              className="w-full h-full object-cover"
              fittingType="fill"
            />
          </div>
          <div className="plate h-[210px]">
            <Image
              src={PEN}
              alt="עט נוצה על משטח אבן"
              className="w-full h-full object-cover"
              fittingType="fill"
            />
          </div>
          <div className="flex flex-col justify-end gap-1.5 border border-highlight p-6 h-[210px]">
            <p className="font-heading text-[64px] leading-[0.9] text-accent tabular-nums">30</p>
            <p className="text-[15px] text-muted-foreground">
              שנות ניסיון
            </p>
          </div>
        </div>

        <div className="flex flex-col justify-center">
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
          <div className="mt-6 space-y-5 text-foreground/80 max-w-[600px] text-justify text-[19px] leading-[1.8] hyphens-none">
            <p>
              שמי דורית גוב ארי, נשואה לניב ואמא לשגיא, עדן וירין. ותיקה בתחומי
              הפיננסים והביטוח, בעלת רישיון סוכן ותואר אקדמאי
              במדעי ההתנהגות, ניהול וכלכלה.
            </p>
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
          {brief ? null : (
            <p className="mt-6 font-heading italic text-2xl text-accent">
              — דורית
            </p>
          )}

          <div className="mt-8 grid grid-cols-3 border-y border-border">
            {STATS.map((s, i) => (
              <div
                key={i}
                className={`px-2 py-6 flex flex-col items-center gap-2 text-center ${i > 0 ? "border-s border-border" : ""}`}
              >
                <p className="font-heading text-[clamp(36px,4vw,52px)] text-accent leading-none tabular-nums">
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