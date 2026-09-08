import React from "react";
import { Image } from "@/components/ui/image";
import Reveal from "@/components/dorit/Reveal";

const ATMOS =
  "https://media.base44.com/images/public/6a9e6144d2bee5cdfb4ddf74/5b05202dd_generated_7c8e0421.jpg";
const PEN =
  "https://media.base44.com/images/public/6a9e6144d2bee5cdfb4ddf74/199524e64_generated_35057100.jpg";

interface Stat {
  num: string;
  label: string;
}

const STATS: Stat[] = [
  { num: "30", label: "שנות ניסיון" },
  { num: "מאות", label: "לקוחות מרוצים" },
  { num: "97%", label: "שיעור תביעות שאושרו" },
  { num: "1:1", label: "ליווי אישי" },
];

export default function About() {
  return (
    <section id="about" className="relative py-24 md:py-32 border-y border-border/50">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-5 grid grid-cols-2 gap-3 self-start">
          <div className="lens-hover overflow-hidden h-64 md:h-80 col-span-2 border border-border/40">
            <Image
              src={ATMOS}
              alt="פרט אדריכלי — אור על זכוכית"
              className="w-full h-full object-cover"
              fittingType="fill"
            />
          </div>
          <div className="lens-hover overflow-hidden h-48 md:h-56 border border-border/40">
            <Image
              src={PEN}
              alt="עט נוצה על משטח אבן"
              className="w-full h-full object-cover"
              fittingType="fill"
            />
          </div>
          <div className="flex flex-col justify-end bg-primary text-primary-foreground p-6 h-48 md:h-56 border border-primary">
            <p className="font-heading text-3xl leading-none">30</p>
            <p className="text-xs tracking-[0.2em] uppercase opacity-80 mt-2">
              שנות ניסיון
            </p>
          </div>
        </div>

        <div className="lg:col-span-7 flex flex-col justify-center">
          <Reveal>
            <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
              01 · Senior Financial Planner
            </span>
            <h2 className="font-heading text-4xl md:text-6xl mt-5 leading-tight">
              אני לא סוכנת.
              <br />
              אני המתכננת שלכם.
            </h2>
          </Reveal>
          <div className="mt-8 space-y-5 text-foreground/75 max-w-2xl leading-relaxed">
            <p>
              שמי דורית גוב ארי, נשואה לניב ואמא לשגיא, עדן וירין. עם ניסיון של
              30 שנה בתחומי הפיננסים והביטוח, בעלת רישיון פנסיוני ותואר אקדמאי
              במדעי ההתנהגות, ניהול וכלכלה.
            </p>
            <p>
              עבדתי שנים ארוכות כמתכננת פיננסית וביטוח עצמאית, 12 שנים בבנק
              מזרחי טפחות כיועצת פנסיונית, ותקופה ארוכה כמתכננת פנסיה ומיסוי
              במרכז לתכנון כלכלי מתקדם בחברת הראל. בשנים האחרונות אני עובדת
              כמתכננת פיננסית בכירה עם התמחות בהיבטי המיסוי השונים, בשיתוף עם
              חברת ארבע עונות — בין חברות התכנון הפיננסי הגדולות בארץ.
            </p>
            <p>
              במהלך השנים הבנתי כמה דברים בתחום הפנסיוני: הבלבול, תחושת חוסר
              האונים מול קופות הגמל, ההשתלמות והמוצרים הפנסיוניים השונים, וחוסר
              הידע של האנשים מביא לטעויות משמעותיות דווקא בקשר לכספים הגדולים
              והמשמעותיים ביותר שלהם. הלקוחות זקוקים לפתרונות מותאמים לצרכים
              האישיים שלהם ושל בן/בת הזוג.
            </p>
            <p>
              מה שמייחד אותי כאשת מקצוע: שילוב בין מקצועיות וניסיון רבים מאד,
              אכפתיות ויושר אמיתיים כלפי הלקוחות, הסברים בגובה העיניים המובנים
              לכולם בתחום המורכב הזה — ובעיקר אנושיות, יחס חם וחיוך תמיד.
            </p>
          </div>
          <p className="mt-6 font-heading italic text-2xl text-accent">
            — דורית
          </p>

          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-px bg-border/50 border border-border/50">
            {STATS.map((s, i) => (
              <div key={i} className="bg-background p-6 md:p-8 text-center group transition-colors duration-300 hover:bg-secondary/40">
                <p className="font-heading text-4xl md:text-5xl text-accent leading-none transition-transform duration-300 group-hover:scale-105">
                  {s.num}
                </p>
                <div className="mx-auto mt-4 h-px w-8 bg-[#C3AD96]/60 transition-all duration-300 group-hover:w-12" />
                <p className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground mt-3">
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