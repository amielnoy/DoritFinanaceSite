import React from "react";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import PensionCheckForm from "@/components/dorit/forms/PensionCheckForm";
import { PENSION_MARKETING_DISCLOSURE } from "@/config/compliance";
import { PENSION_CHECK } from "@/config/offers";
import { SITE_NAME, breadcrumbLd, useSeo } from "@/lib/seo";

/**
 * /pension-check — the flagship (growth brief, 2026-10-14): Dorit looks at the
 * whole pension portfolio through the clearinghouse, with the request pipeline
 * already built. The hero's main button, the articles on pension topics and
 * the year-end page all lead here.
 */
const STEPS: [string, string][] = [
  ["משאירים פרטים", "שם וטלפון, ומייל אם רוצים לקבל את הקישור האישי מיד."],
  ["מוסרים קוד מהמסלקה", "בקישור האישי יש הסבר צעד אחר צעד: מפיקים באתר המסלקה קוד ייפוי כוח ומוסרים אותו, יחד עם מספר הזהות."],
  ["דורית עוברת על התיק", "כל הקופות, דמי הניהול והכיסויים — ונפגשים לשיחה על מה שכדאי לעשות."],
];

export default function PensionCheck() {
  useSeo({
    title: `${PENSION_CHECK.name} | ${SITE_NAME}`,
    description:
      "בדיקת תיק פנסיוני דרך המסלקה הפנסיונית: כל הקופות שלכם, דמי הניהול שאתם משלמים בפועל והכיסויים הביטוחיים — במקום אחד, עם מתכננת שעוברת עליהם.",
    path: PENSION_CHECK.path,
    jsonLd: [
      breadcrumbLd([
        { name: "דף הבית", path: "/" },
        { name: PENSION_CHECK.name, path: PENSION_CHECK.path },
      ]),
    ],
  });

  return (
    <div className="relative bg-background pb-14 md:pb-0">
      <FloatingHeader />
      <main>
        <section className="pt-40 pb-16 md:pt-48 md:pb-20 border-b border-border/50 max-md:pt-28">
          <div className="max-w-[1000px] mx-auto px-6 md:px-10">
            <Eyebrow>המסלקה הפנסיונית</Eyebrow>
            <h1 className="font-heading text-5xl md:text-7xl mt-5 leading-tight max-md:text-4xl">{PENSION_CHECK.name}</h1>
            <p className="mt-6 text-lg text-foreground/80 max-w-2xl leading-relaxed">
              כל הפנסיה, הגמל וההשתלמות שלכם — מכל החברות, במקום אחד: כמה נצבר, כמה אתם משלמים בפועל בדמי
              ניהול, ואילו כיסויים יש לכם. דורית עוברת על הנתונים ונפגשים לשיחה על מה שכדאי לעשות איתם.
            </p>

            <ol className="mt-10 grid gap-4 md:grid-cols-3 list-none p-0">
              {STEPS.map(([title, text], i) => (
                <li key={title} className="rounded-[4px] border border-border p-5">
                  <span className="font-heading text-2xl text-accent lining-nums">{String(i + 1).padStart(2, "0")}</span>
                  <h2 className="font-heading text-xl mt-2">{title}</h2>
                  <p className="mt-2 text-[16px] leading-relaxed text-foreground/80">{text}</p>
                </li>
              ))}
            </ol>

            <div className="mt-10">
              <PensionCheckForm location="page" context="עמוד בדיקת תיק פנסיוני" />
            </div>

            <p className="mt-10 text-xs text-muted-foreground leading-relaxed">{PENSION_MARKETING_DISCLOSURE}</p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
