import React from "react";
import { Image } from "@/components/ui/image";
import { ArrowDown } from "lucide-react";
import ArchStatement from "@/components/dorit/ArchStatement";

const HERO_IMG =
  "https://media.base44.com/images/public/6a9e6144d2bee5cdfb4ddf74/589e9d0cd_generated_11fed895.jpg";

const TICKER: string[] = [
  "Future Proofing",
  "Legacy Planning",
  "Personalized Care",
  "Tailored Coverage",
  "Claims Advocacy",
  "Trusted Counsel",
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
          <div className="relative w-full h-[55vh] md:h-[80vh] overflow-hidden lens-hover">
            <Image
              src={HERO_IMG}
              alt="דורית גוב ארי — דיוקן מקצועי"
              className="w-full h-full object-cover"
              fittingType="fill"
              loading="eager"
              fetchpriority="high"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background/30 via-transparent to-transparent" />
          </div>
          <div className="absolute bottom-6 right-6 glass px-5 py-3.5 border border-border/50 shadow-sm">
            <p className="font-heading text-sm leading-tight">דורית גוב ארי</p>
            <p className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground mt-1">
              Senior Financial Planner
            </p>
          </div>
        </div>

        {/* Headline */}
        <div className="order-1 md:order-2 md:col-span-7 flex flex-col justify-center pr-0 md:pr-14 pb-10 md:pb-0">
          <span className="text-[11px] tracking-[0.35em] uppercase text-accent mb-6 animate-fade-up">
            דורית גוב ארי · מתכננת פיננסית בכירה
          </span>
          <ArchStatement />
          <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-foreground/70 animate-fade-up">
            <span className="font-heading text-base text-accent">30 שנות ניסיון</span>
            <span className="w-1 h-1 rounded-full bg-[#C4A484]" />
            <span className="font-heading text-base text-accent">97% תביעות שאושרו</span>
            <span className="w-1 h-1 rounded-full bg-[#C4A484]" />
            <span className="font-heading text-base text-accent">ליווי אישי 1:1</span>
          </div>
          <p className="mt-7 max-w-md text-lg text-foreground/75 leading-relaxed animate-fade-up">
            אני לא מוכרת פוליסות — אני מתכננת עתיד. ליווי אישי, מדויק ושקוף לאורך כל
            חייכם, מהרגע שבו אתם בוחרים ועד הרגע שבו אתם מממשים את החזון.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-5 animate-fade-up">
            <a
              href="#consultation"
              className="inline-flex items-center px-8 py-4 bg-[#C3AD96] text-primary font-medium hover:bg-[#b89a80] transition-colors duration-300 shadow-sm"
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
              className="mx-8 text-xs tracking-[0.3em] uppercase text-muted-foreground/80 flex items-center gap-8"
            >
              {t}
              <span className="text-[#C4A484] text-[8px]">◆</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}