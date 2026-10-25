import React, { useId } from "react";
import { MessageCircle } from "lucide-react";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { whatsappHref } from "@/lib/calculator-lead";
import { useT } from "@/i18n/LocaleContext";

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
  const t = useT("tools");
  return (
    <aside
      aria-labelledby={headingId}
      data-track-location="calculator"
      className={`card-raised p-5 md:p-7 ${className}`}
    >
      <h3 id={headingId} className="font-heading font-bold text-2xl md:text-[26px] leading-snug">
        {t("lead.title")}
      </h3>
      <p className="mt-3 text-sm text-foreground/70 leading-relaxed max-w-xl">
        {t("lead.text")}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <a
          href={whatsappHref(message)}
          target="_blank"
          rel="noopener noreferrer"
          className={ctaClass("max-sm:w-full")}
        >
          <MessageCircle size={18} aria-hidden="true" />
          {t("lead.send")}
        </a>
        {children}
      </div>
    </aside>
  );
}
