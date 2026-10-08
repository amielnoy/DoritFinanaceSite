import React from "react";
import { Image } from "@/components/ui/image";
import { ArrowDown } from "lucide-react";
import ArchStatement from "@/components/dorit/sections/ArchStatement";
import { ctaClass } from "@/components/dorit/primitives/Cta";

const HERO_IMG = "/images/dorit-office-portrait.png";

export default function Hero() {
  return (
    <section id="top" className="relative border-b border-border pt-[80px] md:pt-[127px]">
      <div className="max-w-[1200px] mx-auto w-full px-[clamp(20px,4vw,40px)] py-[clamp(32px,5vw,64px)] grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-[clamp(32px,4vw,56px)] items-center">
        {/* Portrait, in a matted plate. The name sits under it as a caption. */}
        <figure className="order-2 lg:order-1 m-0 flex flex-col gap-3">
          <div className="plate h-[clamp(320px,46vh,440px)]">
            <Image
              src={HERO_IMG}
              alt="דורית גוב ארי — דיוקן מקצועי"
              className="w-full h-full object-cover object-[center_20%]"
              fittingType="fill"
              loading="eager"
              fetchPriority="high"
            />
          </div>
          {/* Stacked on a phone, side by side from sm. Side by side at 390px
              squeezed the title onto two ragged lines and broke the licence
              number at its hyphen ("L-" / "00107009"). The number never wraps. */}
          <figcaption className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3 text-sm leading-relaxed text-muted-foreground">
            <span>דורית גוב ארי · מתכננת פיננסית וסוכנת ביטוח</span>
            <bdi dir="ltr" className="self-start sm:self-auto whitespace-nowrap lining-nums tabular-nums">L-00107009</bdi>
          </figcaption>
        </figure>

        {/* Headline */}
        <div className="order-1 lg:order-2 flex flex-col gap-5">
          {/* The figcaption below the portrait repeats this exact line, so on a
              phone — where the two sit one above the other instead of side by
              side — it is a double-read of the same name before the fold.
              Hidden under `sm`, still shown wherever there is room to spare. */}
          <span className="hidden text-sm text-accent animate-fade-up sm:block">
            דורית גוב ארי · מתכננת פיננסית וסוכנת ביטוח
          </span>
          <ArchStatement />
          {/* Claims of equal weight, a gold diamond between them.
              "97% תביעות שאושרו" used to sit in the middle. It is gone: a
              licensed agent quoting a performance figure is a regulated claim,
              and nothing here could substantiate it. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-heading text-xl text-accent animate-fade-up">
            <span>בעלת רישיון סוכן</span>
            <span aria-hidden="true" className="w-1.5 h-1.5 rotate-45 border border-highlight" />
            <span>ליווי אישי 1:1</span>
          </div>
          {/* The financial work, named. "מתכננת עתיד" is true and says nothing
              a visitor can act on; most people arrive holding a pension, a
              gemel fund and a study fund they have never looked at, and that is
              the conversation. Still no figure and no promise — §2 binds this
              copy as it binds the agents. */}
          <p className="max-w-[480px] text-lg leading-[1.6] text-foreground/80 [text-wrap:pretty] animate-fade-up">
            תכנון פיננסי וביטוחי שמתחיל בתמונה המלאה — פנסיה, גמל והשתלמות,
            מיסוי וקיבוע זכויות, ודמי הניהול שנגבים מהחיסכון לאורך השנים.
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-5 animate-fade-up">
            {/* `ctaClass`'s own comment is explicit: "an outline, never a
                fill" — a deliberate system rule, not an oversight, so this
                does not go solid. A heavier border and a translucent tint
                (no opaque fill) is the compromise: more weight than every
                other outline CTA on the site without breaking the rule. */}
            <a
              href="#start"
              className={ctaClass("border-2 bg-highlight/[0.08] hover:bg-highlight/[0.18]", { size: "lg" })}
            >
              לשיחה קצרה עם דורית
            </a>
            <a
              href="#services"
              className="inline-flex items-center gap-2 min-h-11 text-[17px] text-accent underline decoration-highlight/50 underline-offset-[6px] hover:decoration-highlight transition-colors duration-200 group"
            >
              לצפייה בשירותים
              <ArrowDown size={16} strokeWidth={1.5} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
