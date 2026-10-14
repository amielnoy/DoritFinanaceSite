import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import MaslekaSteps, { type MaslekaStep, type StepScreens } from "@/components/masleka/MaslekaSteps";
import { CLEARINGHOUSE_ADVISOR_URL } from "@/config/masleka";
import { LICENCE } from "@/config/compliance";

/**
 * A one-time guide for the staff: registering as a licensed advisor at the
 * clearinghouse (free), and the routine the board supports after that.
 * Numbered text with a link; the `screenshots` slot renders nothing until
 * the portal's screens are captured.
 */
export default function MaslekaGuide({ screenshots }: { screenshots?: StepScreens }) {
  const steps: MaslekaStep[] = [
    {
      title: "נכנסים לאתר המסלקה כבעלי רישיון",
      body: (
        <>
          באתר המסלקה הפנסיונית נכנסים לאזור המיועד לבעלי רישיון ויועצים.{" "}
          <a href={CLEARINGHOUSE_ADVISOR_URL} target="_blank" rel="noopener noreferrer" className="underline text-accent">
            לאתר המסלקה
          </a>
        </>
      ),
    },
    {
      title: "נרשמים — ללא עלות",
      body: <>ההרשמה נעשית פעם אחת, על שם בעלת הרישיון — מספר רישיון {LICENCE.number}.</>,
    },
    {
      title: "מגישים בקשה לכל לקוח",
      body: (
        <>
          בלוח המסלקה לוחצים „העתק ת״ז” ו„העתק קוד”, מדביקים בבקשת „מידע מכל הגופים” בפורטל (₪14 לבקשה), ואז
          לוחצים „הגשתי” בלוח — הקוד ומספר הזהות נמחקים מהמערכת.
        </>
      ),
    },
    {
      title: "מורידים את הקבצים",
      body: (
        <>
          כ־3–4 שעות אחרי ההגשה הקבצים מוכנים בפורטל (וגם נשלחים לכתובת הרשומה במסלקה). המסלקה מוחקת אותם אחרי 7
          ימי עסקים; ביום העסקים החמישי תישלח לצוות תזכורת במייל.
        </>
      ),
    },
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-2xl md:text-3xl">הרשמה כיועץ במסלקה — מדריך</h1>
          <Link to="/admin/masleka" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent">
            חזרה ללוח <ArrowRight size={16} />
          </Link>
        </div>
      </header>
      <main className="max-w-[900px] mx-auto px-4 sm:px-6 py-8">
        <MaslekaSteps steps={steps} screenshots={screenshots} />
      </main>
    </div>
  );
}
