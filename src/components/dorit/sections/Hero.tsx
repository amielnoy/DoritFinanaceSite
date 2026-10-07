import React from "react";
import { Image } from "@/components/ui/image";
import { ArrowDown } from "lucide-react";
import ArchStatement from "@/components/dorit/sections/ArchStatement";
import { ctaClass } from "@/components/dorit/primitives/Cta";

const HERO_IMG = "/images/dorit-office-portrait.png";

/**
 * Hebrew, because the reader is.
 *
 * These ran in English under a right-to-left Hebrew hero, which asks someone
 * comparing pension options to switch alphabet and direction for a phrase
 * carrying nothing the Hebrew beside it did not already say.
 *
 * None of them uses the word ייעוץ: the licence here is a סוכן licence, and
 * base44/agents/COMPLIANCE.md §7 already flags the marketing copy that blurs
 * the two. No reason to add more of it in a decorative strip.
 */
const TICKER: string[] = [
  "תכנון לטווח ארוך",
  "העברת עושר בין דורות",
  "ליווי אישי",
  "כיסוי מותאם",
  "ליווי בתביעות",
  "שקיפות מלאה",
];

export default function Hero() {
  return (
    <section id="top" className="relative border-b border-border pt-[80px] md:pt-[127px]">
      <div className="max-w-[1400px] mx-auto w-full px-[clamp(20px,4vw,40px)] py-[clamp(40px,6vw,88px)] grid grid-cols-1 lg:grid-cols-2 gap-[clamp(40px,6vw,96px)] items-center">
        {/* Portrait, in a matted plate. The name sits under it as a caption. */}
        <figure className="order-2 lg:order-1 m-0 flex flex-col gap-3">
          <div className="plate h-[clamp(440px,68vh,720px)]">
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
            <span dir="ltr" className="self-start sm:self-auto whitespace-nowrap tabular-nums">L-00107009</span>
          </figcaption>
        </figure>

        {/* Headline */}
        <div className="order-1 lg:order-2 flex flex-col gap-7">
          <span className="text-sm text-accent animate-fade-up">
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
          <p className="max-w-[520px] text-xl leading-[1.7] text-foreground/80 [text-wrap:pretty] animate-fade-up">
            תכנון פיננסי וביטוחי שמתחיל בתמונה המלאה. פנסיה, גמל והשתלמות, מיסוי
            וקיבוע זכויות, ודמי הניהול שנגבים מהחיסכון לאורך השנים: מה שיש לכם,
            מה הוא עולה, ומה הוא אמור לעשות עבורכם.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-5 animate-fade-up">
            <a
              href="#start"
              className={ctaClass(undefined, { size: "lg" })}
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

      {/* The six phrases, as a list. Each carries its own diamond at the start,
          so wrapping cannot strand a separator at a line end or leave the last
          phrase without one. Two columns on a phone, three on a tablet, one
          justified row on a wide screen; every item starts on the same edge as
          the item above it, at any text size. */}
      <div className="border-t border-border">
        <ul className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-4 m-0 list-none grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 lg:flex lg:flex-wrap lg:justify-between text-[15px] leading-snug text-muted-foreground">
          {TICKER.map((t) => (
            <li key={t} className="flex items-baseline gap-2.5 min-w-0">
              <span aria-hidden="true" className="shrink-0 w-[5px] h-[5px] rotate-45 bg-highlight translate-y-[-2px]" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
