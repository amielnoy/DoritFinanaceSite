import React, { useState } from "react";
import { Calculator, Heart, Landmark, HeartHandshake, TrendingDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Reveal from "@/components/dorit/primitives/Reveal";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";

interface Pillar {
  icon: LucideIcon;
  title: string;
  sub: string;
  desc: string;
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
    title: "פנסיה, גמל והשתלמות",
    sub: "Pension & Provident",
    desc: "בחינת המוצרים הקיימים, מסלולי ההשקעה והניוד — והתאמתם לשלב החיים ולטווח שבו הכסף אמור לעבוד.",
  },
  {
    icon: Calculator,
    title: "מיסוי וקיבוע זכויות",
    sub: "Tax & Rights",
    desc: "תכנון מס לקראת פרישה, קיבוע זכויות, תיקון 190 ומיצוי הטבות המס שעל ההפקדות.",
  },
  {
    icon: TrendingDown,
    title: "דמי ניהול ועלויות",
    sub: "Fees & Costs",
    desc: "בדיקת העלויות שנגבות לאורך שנות החיסכון, והתנהלות מול הגופים המוסדיים בשמכם.",
  },
  {
    icon: Heart,
    title: "ביטוחי חיים ובריאות",
    sub: "Life & Health",
    desc: "כיסוי למשפחה, אובדן כושר עבודה, בריאות וכיסוי למשכנתא — מותאמים למי שתלוי בכם בפועל.",
  },
  {
    icon: HeartHandshake,
    title: "סנגור תביעות",
    sub: "Claims Advocacy",
    desc: "ליווי צמוד ברגע האמת — ניהול התביעה מול החברה בשמכם, מהדיווח ועד ההכרעה.",
  },
];

export default function ServiceMatrix() {
  const [active, setActive] = useState<number | null>(null);

  return (
    <section
      id="services"
      className="relative py-24 md:py-32 transition-colors duration-500"
      style={{
        backgroundColor:
          active !== null ? "hsl(30 30% 94%)" : undefined,
      }}
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-16">
          <div>
            <Reveal>
              <Eyebrow>
                02 · תחומי הליווי
              </Eyebrow>
              <h2 className="font-heading text-5xl md:text-6xl mt-4 max-w-xl">
                חמישה עמודי התכנון
              </h2>
            </Reveal>
          </div>
          <p className="max-w-sm text-foreground/70">
            רוב הכסף שלכם כבר מופקד במקום כלשהו — פנסיה, גמל, השתלמות. כאן בודקים
            מה יש, מה הוא עולה, ומה הוא אמור לעשות עבורכם.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border/50 border border-border/50">
          {PILLARS.map((p, i) => {
            const Icon = p.icon;
            const isActive = active === i;
            return (
              <div
                key={i}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                className={`group relative bg-background p-10 md:p-12 transition-all duration-500 cursor-default overflow-hidden ${
                  isActive ? "bg-secondary/50" : ""
                }`}
              >
                {isActive && (
                  <div className="absolute top-0 right-0 w-24 h-24 bg-highlight-muted/5 rounded-bl-full pointer-events-none" />
                )}
                <div className="flex items-start justify-between mb-8">
                  <div className={`w-12 h-12 flex items-center justify-center border transition-all duration-500 ${
                    isActive ? "border-highlight-muted bg-highlight-muted/10" : "border-border/60 bg-secondary/40"
                  }`}>
                    <Icon
                      size={24}
                      className={`transition-colors duration-500 ${
                        isActive ? "text-highlight-strong" : "text-accent"
                      }`}
                      strokeWidth={1.25}
                    />
                  </div>
                  <span className="text-[10px] tracking-[0.12em] text-muted-foreground">
                    0{i + 1}
                  </span>
                </div>
                <h3 className="font-heading text-2xl md:text-3xl mb-2">
                  {p.title}
                </h3>
                <p className="text-[11px] tracking-[0.12em] text-accent mb-5">
                  {p.sub}
                </p>
                <p
                  className={`text-foreground/70 leading-relaxed transition-all duration-500 ${
                    isActive ? "max-h-40 opacity-100" : "max-h-20 opacity-80"
                  } overflow-hidden`}
                >
                  {p.desc}
                </p>
                <div
                  className={`mt-8 h-px bg-highlight-muted transition-all duration-500 ${
                    isActive ? "w-16" : "w-0"
                  }`}
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}