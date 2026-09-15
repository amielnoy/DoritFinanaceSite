import React from "react";
import { Image } from "@/components/ui/image";
import { ArrowDown } from "lucide-react";
import ArchStatement from "@/components/dorit/sections/ArchStatement";

const HERO_IMG =
  "https://media.base44.com/images/public/6a9e6144d2bee5cdfb4ddf74/9620f0028_119895334_119505229701692_7118383656602926716_n.jpg";

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
  "העברה בין-דורית",
  "ליווי אישי",
  "כיסוי מותאם",
  "ליווי בתביעות",
  "שקיפות מלאה",
];

export default function Hero() {
  return (
    <section id="top" className="relative min-h-screen flex flex-col">
      {/* Quad-axis rules */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <div className="absolute top-0 bottom-0 right-[20%] w-px bg-border/25" />
        <div className="absolute top-0 bottom-0 right-[55%] w-px bg-border/25" />
        <div className="absolute top-0 bottom-0 right-[80%] w-px bg-border/25" />
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 max-w-[1400px] mx-auto w-full px-6 md:px-10 pt-28 md:pt-24">
        {/* Portrait */}
        <div className="relative order-2 md:order-1 md:col-span-5 flex items-end">
          <div className="relative w-full h-[55vh] md:h-[80vh] overflow-hidden lens-hover bg-primary">
            <Image
              src={HERO_IMG}
              alt="דורית גוב ארי — דיוקן מקצועי"
              className="w-full h-full object-cover"
              fittingType="fill"
              loading="eager"
              fetchpriority="high"
              style={{ filter: "saturate(0.78) contrast(1.04) brightness(0.94)" }}
            />
            {/* Parchment duotone — shifts the cool water backdrop into the site's warm palette */}
            <div
              className="absolute inset-0 mix-blend-color pointer-events-none"
              style={{ background: "linear-gradient(170deg, rgba(196,164,132,0.42) 0%, rgba(125,107,93,0.30) 50%, rgba(26,26,27,0.46) 100%)" }}
            />
            {/* Warm light wash to restore natural skin tones over the color blend */}
            <div
              className="absolute inset-0 mix-blend-soft-light pointer-events-none"
              style={{ background: "linear-gradient(170deg, rgba(249,247,242,0.22) 0%, transparent 45%, rgba(26,26,27,0.18) 100%)" }}
            />
            {/* Bottom fade into the page background */}
            <div className="absolute inset-0 bg-gradient-to-t from-background/70 via-background/10 to-transparent" />
            {/* Subtle vignette to focus attention on the subject */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ boxShadow: "inset 0 0 140px 24px rgba(26,26,27,0.38)" }}
            />
          </div>
          <div className="absolute bottom-6 right-6 glass px-5 py-3.5 border border-border/50 shadow-sm">
            <p className="font-heading text-sm leading-tight">דורית גוב ארי</p>
            <p className="text-[11px] text-muted-foreground mt-1">
              מתכננת פיננסית בכירה
            </p>
          </div>
        </div>

        {/* Headline */}
        <div className="order-1 md:order-2 md:col-span-7 flex flex-col justify-center pr-0 md:pr-14 pb-10 md:pb-0">
          <span className="text-[11px] tracking-[0.35em] uppercase text-accent mb-6 animate-fade-up">
            דורית גוב ארי · מתכננת פיננסית בכירה
          </span>
          <ArchStatement />
          {/* Claims of equal weight. Wrapping left the last one alone on its own
              line at 390px, which read as an afterthought rather than as one of
              a set — so on phones they stack, and the dots that separate them
              are only drawn when they are in a row.
              "97% תביעות שאושרו" used to sit in the middle. It is gone: a
              licensed agent quoting a performance figure is a regulated claim,
              and nothing here could substantiate it. */}
          <div className="mt-7 flex flex-col items-start gap-y-1.5 md:flex-row md:flex-wrap md:items-center md:gap-x-4 md:gap-y-2 text-sm text-foreground/70 animate-fade-up">
            <span className="font-heading text-base text-accent">30 שנות ניסיון</span>
            <span className="hidden md:block w-1 h-1 rounded-full bg-highlight" />
            <span className="font-heading text-base text-accent">ליווי אישי 1:1</span>
          </div>
          <p className="mt-7 max-w-md text-lg text-foreground/75 leading-relaxed animate-fade-up">
            אני לא מוכרת פוליסות — אני מתכננת עתיד. ליווי אישי, מדויק ושקוף לאורך כל
            חייכם, מהרגע שבו אתם בוחרים ועד הרגע שבו אתם מממשים את החזון.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-5 animate-fade-up">
            <a
              href="#consultation"
              className="inline-flex items-center px-8 py-4 bg-highlight-muted text-primary font-medium hover:bg-highlight-strong transition-colors duration-300 shadow-sm"
            >
              לקביעת פגישת ייעוץ
            </a>
            <a
              href="#services"
              className="inline-flex items-center gap-2 text-sm tracking-wide text-foreground/70 hover:text-accent transition-colors group"
            >
              לצפייה בשירותים
              <ArrowDown size={16} className="group-hover:translate-y-0.5 transition-transform" />
            </a>
          </div>
        </div>
      </div>

      {/* Live Assurance ticker */}
      <div className="relative border-t border-border/40 overflow-hidden bg-secondary/30">
        <div className="flex whitespace-nowrap animate-ticker py-3.5">
          {[...TICKER, ...TICKER, ...TICKER, ...TICKER].map((t, i) => (
            <span
              key={i}
              className="mx-8 text-xs tracking-[0.08em] text-muted-foreground/80 flex items-center gap-8"
            >
              {t}
              <span className="text-highlight text-[8px]">◆</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}