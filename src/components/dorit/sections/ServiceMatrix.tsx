import React from "react";
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
  return (
    <section id="services" className="relative border-b border-border">
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-[clamp(72px,9vw,120px)] flex flex-col gap-14">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Reveal>
              <Eyebrow>
                02 · תחומי הליווי
              </Eyebrow>
              <h2 className="font-heading font-normal text-[clamp(34px,4vw,48px)] leading-[1.12] mt-[18px] max-w-xl">
                חמישה עמודי התכנון
              </h2>
            </Reveal>
          </div>
          <p className="max-w-[420px] text-lg leading-[1.75] text-muted-foreground">
            רוב הכסף שלכם כבר מופקד במקום כלשהו — פנסיה, גמל, השתלמות. כאן בודקים
            מה יש, מה הוא עולה, ומה הוא אמור לעשות עבורכם.
          </p>
        </div>

        <div className="border-t border-foreground">
          {PILLARS.map((p, i) => {
            const Icon = p.icon;
            return (
              <div
                key={i}
                className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-x-12 gap-y-3 py-8 border-b border-border transition-colors duration-200 hover:bg-highlight/5"
              >
                <div className="flex items-start gap-6">
                  <span className="font-heading text-[32px] leading-none text-accent lining-nums tabular-nums w-10 shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Icon size={26} strokeWidth={1.25} className="text-highlight shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex flex-col gap-1">
                    <h3 className="font-heading font-medium text-[clamp(24px,2.4vw,30px)] leading-[1.2]">
                      {p.title}
                    </h3>
                    <p dir="ltr" className="self-start font-heading italic text-lg text-muted-foreground">
                      {p.sub}
                    </p>
                  </div>
                </div>
                {/* Always visible. The ink is `text-foreground/80`, set once and
                    left alone: a fade stacked on a fade measured 3.98:1 here
                    once, and neither class looked wrong on its own. */}
                <p className="max-w-[560px] text-lg leading-[1.75] text-foreground/80">
                  {p.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
