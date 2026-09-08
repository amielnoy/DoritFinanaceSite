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
    <section id="about" className="relative py-24 md:py-32 border-y border-border/60">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16">
        <div className="lg:col-span-5 grid grid-cols-2 gap-4 self-start">
          <div className="lens-hover overflow-hidden h-64 md:h-80 col-span-2">
            <Image
              src={ATMOS}
              alt="פרט אדריכלי — אור על זכוכית"
              className="w-full h-full object-cover"
              fittingType="fill"
            />
          </div>
          <div className="lens-hover overflow-hidden h-48 md:h-56">
            <Image
              src={PEN}
              alt="עט נוצה על משטח אבן"
              className="w-full h-full object-cover"
              fittingType="fill"
            />
          </div>
          <div className="flex flex-col justify-end bg-primary text-primary-foreground p-6 h-48 md:h-56">
            <p className="font-heading text-3xl">30</p>
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
              כל לקוח שנכנס אליי הוא עולם שלם — עם חלומות, דאגות וסיפור חיים
              משלו. לכן אני לא מציעה פתרונות מהמדף. אני מקשיבה תחילה, מבינה
              לעומק את הצורך, ורק אז בונה תיק מותאם אישית — ומלווה אותו יחד אתכם
              לאורך כל הדרך, מהרגע שבו אתם בוחרים ועד הרגע שבו אתם מממשים את החזון.
            </p>
            <p>
              במשך 30 שנות ניסיון, דורית גוב ארי בונה עבור מאות לקוחותיה לא רק
              תיק פיננסי — אלא מערכת שלמה של ודאות. כל מוצר פיננסי הוא קורה, כל
              תכנון הוא יסוד, וכל החלטה נעשית תוך מבט קדימה אל העתיד שלכם.
            </p>
            <p>
              הגישה שלי פשוטה ומוחלטת: להקשיב עמוק, לתכנן בדיוק, ולהיות שם ברגע
              שבו העתיד הפיננסי שלכם נבחן. כי תכנון פיננסי אמיתי אינו נמדד בעלות חודשית —
              אלא בשקט הנפשי שמגיע כשיודעים שהכל מתוכנן.
            </p>
          </div>
          <p className="mt-6 font-heading italic text-2xl text-accent">
            — דורית
          </p>

          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-px bg-border/60 border border-border/60">
            {STATS.map((s, i) => (
              <div key={i} className="bg-background p-6 md:p-7 text-center">
                <p className="font-heading text-4xl md:text-5xl text-accent leading-none">
                  {s.num}
                </p>
                <div className="mx-auto mt-3 h-px w-8 bg-[#C4A484]/50" />
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