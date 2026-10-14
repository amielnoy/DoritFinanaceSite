import React from "react";
import { Link } from "react-router-dom";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import PensionCheckForm from "@/components/dorit/forms/PensionCheckForm";
import { PENSION_MARKETING_DISCLOSURE } from "@/config/compliance";
import { YEAR_END } from "@/config/offers";
import { SITE_NAME, breadcrumbLd, useSeo } from "@/lib/seo";

/**
 * /atzmaim-31-12 — the year-end campaign for the self-employed (growth brief,
 * 2026-10-14; paid promotion in November and December). Every figure is the
 * published article's (/blog/sof-shana-atzmaim, tax year 2026), with its own
 * caveat; the page adds the offer, not new numbers. Update both together.
 */
const POINTS: { title: string; body: string }[] = [
  {
    title: "ההטבה נספרת לפי היום שבו הכסף הגיע לקופה",
    body: "הפקדה שנקלטה ב־2 בינואר לא תעזור בדוח של השנה שהסתיימה. העברה בימים האחרונים של דצמבר עלולה להיקלט רק בינואר — אמצע דצמבר הוא מרווח ביטחון סביר.",
  },
  {
    title: "קרן פנסיה: זיכוי וגם ניכוי",
    body: "ההפקדה שממצה את ההטבה המלאה היא כ־16.5% מההכנסה המזכה — עד כ־38,400 ₪ בשנת 2026. ההפקדה המחייבת לעצמאים היא רק המינימום.",
  },
  {
    title: "קרן השתלמות: ניכוי ופטור במשיכה",
    body: "ניכוי על הפקדה של 4.5% מההכנסה, עד 13,203 ₪ בשנה; עד 20,566 ₪ בשנה עם פטור ממס רווח הון במשיכה.",
  },
];

export default function YearEndSelfEmployed() {
  useSeo({
    title: `עצמאים: מה להפקיד עד 31.12 | ${SITE_NAME}`,
    description:
      "עצמאים: הטבות המס על הפקדה לפנסיה ולקרן השתלמות נספרות לפי השנה שבה הכסף הגיע לקופה. בודקים עכשיו כמה הופקד השנה וכמה חסר עד התקרה המוטבת.",
    path: YEAR_END.path,
    jsonLd: [
      breadcrumbLd([
        { name: "דף הבית", path: "/" },
        { name: "עצמאים — עד 31.12", path: YEAR_END.path },
      ]),
    ],
  });

  return (
    <div className="relative bg-background pb-14 md:pb-0">
      <FloatingHeader />
      <main>
        <section className="pt-40 pb-16 md:pt-48 md:pb-20 border-b border-border/50 max-md:pt-28">
          <div className="max-w-[1000px] mx-auto px-6 md:px-10">
            <Eyebrow>עצמאים · סוף שנת המס</Eyebrow>
            <h1 className="font-heading text-5xl md:text-7xl mt-5 leading-tight max-md:text-4xl">
              עד 31.12 — כדי לא לוותר על הטבת המס
            </h1>
            <p className="mt-6 text-lg text-foreground/80 max-w-2xl leading-relaxed">
              לעצמאי אין מעסיק שמפקיד בשבילו, ולכן גם אין מי שיזכיר לו. ההטבות על הפקדה לפנסיה ולקרן השתלמות הן
              כסף שהמדינה מוכנה להשאיר אצלכם — בתנאי שתפקידו בזמן.
            </p>

            <ul className="mt-10 grid gap-4 md:grid-cols-3 list-none p-0">
              {POINTS.map((p) => (
                <li key={p.title} className="rounded-[4px] border border-border p-5">
                  <h2 className="font-heading text-xl">{p.title}</h2>
                  <p className="mt-2 text-[16px] leading-relaxed text-foreground/80">{p.body}</p>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted-foreground">
              הנתונים לשנת המס 2026 ומתעדכנים מדי שנה — כדאי לאשר אותם מול רואה החשבון לפני שמעבירים כסף.{" "}
              <Link to={YEAR_END.article} className="underline underline-offset-4">
                המדריך המלא: מה להפקיד עד 31 בדצמבר
              </Link>
            </p>

            <div className="mt-10">
              <PensionCheckForm
                location="year_end"
                context="עצמאים — עד 31.12"
                heading="נבדוק איתכם כמה הופקד השנה וכמה חסר עד התקרה"
              />
            </div>

            <p className="mt-10 text-xs text-muted-foreground leading-relaxed">
              מידע כללי בלבד, אינו ייעוץ מס או ייעוץ פנסיוני ואינו מתחשב במצבכם האישי. {PENSION_MARKETING_DISCLOSURE}
            </p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
