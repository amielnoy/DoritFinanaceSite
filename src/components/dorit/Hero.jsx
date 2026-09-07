import React from "react";
import { Image } from "@/components/ui/image";
import { ArrowDown } from "lucide-react";
import ArchStatement from "@/components/dorit/ArchStatement";

const HERO_IMG =
  "https://media.base44.com/images/public/6a9e6144d2bee5cdfb4ddf74/589e9d0cd_generated_11fed895.jpg";

const TICKER = [
  "Personalized Care",
  "Claims Advocacy",
  "Future Proofing",
  "Legacy Planning",
  "Tailored Coverage",
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

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 max-w-[1400px] mx-auto w-full px-6 md:px-10 pt-28 md:pt-24">
        {/* Portrait */}
        <div className="relative order-2 md:order-1 flex items-end">
          <div className="relative w-full h-[60vh] md:h-[78vh] overflow-hidden lens-hover">
            <Image
              src={HERO_IMG}
              alt="דורית גוב ארי — דיוקן מקצועי"
              className="w-full h-full object-cover"
              fittingType="fill"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background/40 to-transparent" />
          </div>
          <div className="absolute bottom-6 right-6 glass px-4 py-3 border border-border/60">
            <p className="font-heading text-sm">דורית גוב ארי</p>
            <p className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
              Insurance Architect
            </p>
          </div>
        </div>

        {/* Headline */}
        <div className="order-1 md:order-2 flex flex-col justify-center pr-0 md:pr-12 pb-10 md:pb-0">
          <span className="text-[11px] tracking-[0.35em] uppercase text-accent mb-6 animate-fade-up">
            דורית גוב ארי · אדריכלות של ביטחון
          </span>
          <ArchStatement />
          <p className="mt-8 max-w-md text-lg text-foreground/75 leading-relaxed animate-fade-up">
            אני לא מוכרת פוליסות — אני מתכננת עתיד. ליווי אישי, מדויק ושקוף לאורך כל
            חייכם, מהרגע שבו אתם בוחרים ועד הרגע שבו אתם נשענים על הרשת.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-5 animate-fade-up">
            <a
              href="#consultation"
              className="inline-flex items-center px-7 py-4 bg-primary text-primary-foreground font-medium hover:bg-accent transition-colors duration-300"
            >
              קבעי פגישת ייעוץ
            </a>
            <a
              href="#services"
              className="inline-flex items-center gap-2 text-sm tracking-wide text-foreground/70 hover:text-accent transition-colors"
            >
              גלו את השירותים <ArrowDown size={16} />
            </a>
          </div>
        </div>
      </div>

      {/* Live Assurance ticker */}
      <div className="relative border-t border-border/60 overflow-hidden bg-background/60">
        <div className="flex whitespace-nowrap animate-ticker py-4">
          {[...TICKER, ...TICKER, ...TICKER, ...TICKER].map((t, i) => (
            <span
              key={i}
              className="mx-8 text-sm tracking-[0.25em] uppercase text-muted-foreground flex items-center gap-8"
            >
              {t}
              <span className="text-[#C4A484]">✦</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}