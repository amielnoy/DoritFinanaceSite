import React, { useId } from "react";
import { MessageCircle } from "lucide-react";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { whatsappHref } from "@/lib/calculator-lead";

/**
 * The step after a calculator's result: ask Dorit to check the real numbers,
 * on WhatsApp, with the result already written in the message.
 *
 * It offers a check, not a verdict — the line under the heading says the
 * result is a general estimate and not advice, and that the message can be
 * edited before it is sent. The calculator's own disclaimer stays where it was.
 *
 * `data-track-location="calculator"`: the site-wide listener in
 * `src/lib/analytics.ts` reports the button as `click_whatsapp` from here, so
 * it needs no tracking call of its own. `children` are further actions beside
 * the WhatsApp button.
 */
export default function CalculatorLeadBox({
  message,
  className = "",
  children,
}: {
  message: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <aside
      aria-labelledby={headingId}
      data-track-location="calculator"
      className={`border border-highlight/40 bg-highlight-muted/10 p-5 md:p-7 ${className}`}
    >
      <h3 id={headingId} className="font-heading text-2xl md:text-[28px] leading-snug">
        רוצים שדורית תבדוק את הנתונים האמיתיים שלכם?
      </h3>
      <p className="mt-3 text-sm text-foreground/70 leading-relaxed max-w-xl">
        התוצאה כאן היא הערכה כללית בלבד ואינה ייעוץ או המלצה. ההודעה נפתחת בוואטסאפ עם התוצאה,
        ואפשר לערוך אותה לפני השליחה.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a
          href={whatsappHref(message)}
          target="_blank"
          rel="noopener noreferrer"
          className={ctaClass("max-sm:w-full")}
        >
          <MessageCircle size={18} aria-hidden="true" />
          שלחו לדורית את התוצאה בוואטסאפ
        </a>
        {children}
      </div>
    </aside>
  );
}
