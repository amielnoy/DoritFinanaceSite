import React, { useState } from "react";
import { Calculator, ChevronDown, Heart, Landmark, HeartHandshake, TrendingDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Reveal from "@/components/dorit/primitives/Reveal";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { MD_UP, useMediaQuery } from "@/hooks/useMediaQuery";
import { useT } from "@/i18n/LocaleContext";
import Glossed from "@/components/dorit/primitives/Glossed";

interface Pillar {
  icon: LucideIcon;
  /** The pillar's keys in home.json: `services.<id>.title` and `.desc`. */
  id: "p1" | "p2" | "p3" | "p4" | "p5";
}

// The five pillars, financial work first.
//
// They used to open on legacy planning and then spend three of the five on
// insurance — life, mortgage, and a car-and-home pillar. That ordering described
// an insurance agency, while everything else on the site describes a financial
// practice: five of the interview's seven tracks are financial, the FAQ leads
// with tax and pensions, and `llms.txt` lists her services as gemel/pension,
// tax and rights fixing, management fees, life and health cover, and claims.
// This section was the one place a visitor met the old framing first.
//
// The car-and-home pillar is gone rather than reordered: elementary insurance
// appears in none of her own materials, and a pillar for work she does not list
// is a promise the rest of the site does not keep. Life and health cover
// absorbs the mortgage protection that "בית ונכסים" carried.
//
// Every line stays descriptive. No figure, no "saves you", no comparison
// between institutions — §2 of the compliance block binds the site copy exactly
// as it binds the agents, and "הורדת דמי ניהול" names an activity rather than
// promising an outcome.
const PILLARS: Pillar[] = [
  {
    icon: Landmark,
    id: "p1",
  },
  {
    icon: Calculator,
    id: "p2",
  },
  {
    icon: TrendingDown,
    id: "p3",
  },
  {
    icon: Heart,
    id: "p4",
  },
  {
    icon: HeartHandshake,
    id: "p5",
  },
];

/**
 * From md up, five open rows. Below md, the same five as an accordion — the
 * first open, the others one tap away, each opening on its own without closing
 * another (so nothing above a row moves when it opens). The descriptions stay
 * in the document when closed: the copy is unchanged, only folded.
 */
export default function ServiceMatrix() {
  const isDesktop = useMediaQuery(MD_UP, true);
  const t = useT("home");
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([0]));
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section id="services" className="relative bg-background border-b border-border">
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-[clamp(72px,9vw,120px)] flex flex-col gap-14 max-md:py-10 max-md:gap-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Reveal>
              <Eyebrow>
                {t("services.eyebrow")}
              </Eyebrow>
              <h2 className="font-heading font-bold text-[clamp(32px,3.6vw,44px)] leading-[1.15] tracking-[-0.01em] mt-[18px] max-w-xl">
                {t("services.title")}
              </h2>
            </Reveal>
          </div>
          <p className="max-w-[420px] text-lg leading-[1.75] text-muted-foreground max-md:text-[17px] max-md:leading-[1.7]">
            {t("services.intro")}
          </p>
        </div>

        <div className="flex flex-col gap-3 md:gap-4">
          {PILLARS.map((p, i) => {
            const Icon = p.icon;
            if (!isDesktop) {
              const expanded = open.has(i);
              return (
                <div key={i} className="group card-raised overflow-hidden">
                  <h3 className="m-0 font-heading font-bold">
                    <button
                      type="button"
                      id={`service-${i}-trigger`}
                      aria-expanded={expanded}
                      aria-controls={`service-${i}-panel`}
                      onClick={() => toggle(i)}
                      className="w-full min-h-14 flex items-center gap-3 px-4 py-3.5 text-start hover:bg-highlight/5 transition-colors duration-200"
                    >
                      <span className="font-heading font-bold text-[20px] leading-none text-muted-foreground lining-nums tabular-nums w-7 shrink-0">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className={ICON_TILE + " w-10 h-10"} aria-hidden="true"><Icon size={20} strokeWidth={1.5} /></span>
                      <span className="flex-1 min-w-0 text-[20px] leading-[1.25]">{t(`services.${p.id}.title`)}</span>
                      <ChevronDown
                        size={20}
                        strokeWidth={1.5}
                        aria-hidden="true"
                        className={`shrink-0 text-accent motion-safe:transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  </h3>
                  <div
                    id={`service-${i}-panel`}
                    role="region"
                    aria-labelledby={`service-${i}-trigger`}
                    hidden={!expanded}
                    className="px-4 pb-5 ps-[4.5rem]"
                  >
                    <p className="m-0 text-[17px] leading-[1.7] text-foreground/80"><Glossed text={t(`services.${p.id}.desc`)} /></p>
                  </div>
                </div>
              );
            }
            return (
              <div
                key={i}
                className="group card-raised grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] items-center gap-x-12 gap-y-3 p-6 lg:p-8 transition-shadow duration-300 hover:shadow-md"
              >
                <div className="flex items-center gap-5">
                  <span className="font-heading font-bold text-[32px] leading-none text-muted-foreground group-hover:text-accent transition-colors duration-300 lining-nums tabular-nums w-12 shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className={ICON_TILE + " w-12 h-12"} aria-hidden="true"><Icon size={24} strokeWidth={1.5} /></span>
                  <div className="flex flex-col gap-1">
                    <h3 className="font-heading font-bold text-[clamp(21px,2vw,24px)] leading-[1.25]">
                      {t(`services.${p.id}.title`)}
                    </h3>
                  </div>
                </div>
                {/* Always visible. The ink is `text-foreground/80`, set once and
                    left alone: a fade stacked on a fade measured 3.98:1 here
                    once, and neither class looked wrong on its own. */}
                <p className="max-w-[560px] text-[17px] leading-[1.75] text-foreground/80">
                  <Glossed text={t(`services.${p.id}.desc`)} />
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** The pillar's icon in a tile that fills blue when its card is hovered. */
const ICON_TILE =
  "shrink-0 rounded-xl bg-secondary flex items-center justify-center text-accent transition-colors duration-300 group-hover:bg-primary group-hover:text-primary-foreground";
