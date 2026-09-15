import React, { useState } from "react";
import { Heart, Landmark, ShieldCheck, Home, HeartHandshake } from "lucide-react";
import Reveal from "@/components/dorit/primitives/Reveal";

interface Pillar {
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  title: string;
  sub: string;
  desc: string;
}

const PILLARS: Pillar[] = [
  {
    icon: Landmark,
    title: "תכנון מורשת",
    sub: "Legacy Planning",
    desc: "פנסיה, קרנות השתלמות ותכנון פיננסי ארוך טווח שבונים יסודות איתנים לדורות הבאים.",
  },
  {
    icon: Heart,
    title: "חיים וחיוניות",
    sub: "Life & Vitality",
    desc: "ביטוח חיים, מצבים קריטיים ובריאות מותאמים אישית — כדי שהאנשים שאתם אוהבים יישארו מוגנים בכל תרחיש.",
  },
  {
    icon: Home,
    title: "בית ונכסים",
    sub: "Estate Cover",
    desc: "הגנה מקיפה למשכנתא ולנכסים שלכם, עם מבט קדימה שמונע הפתעות יקרות.",
  },
  {
    icon: ShieldCheck,
    title: "מגן יומיומי",
    sub: "Everyday Shield",
    desc: "ביטוח רכב, דירה ונכסים — כיסוי מדויק שמלווה את החיים השקטים שלכם בלי רעש מיותר.",
  },
  {
    icon: HeartHandshake,
    title: "סנגור תביעות",
    sub: "Claims Advocacy",
    desc: "ליווי צמוד ברגע האמת — ניהול תביעות מול החברות בשמכם, עד שמגיע הכיסוי המלא שמגיע לכם.",
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
              <span className="text-[11px] tracking-[0.12em] text-accent">
                02 · תחומי הליווי
              </span>
              <h2 className="font-heading text-5xl md:text-6xl mt-4 max-w-xl">
                חמישה עמודי חיים
              </h2>
            </Reveal>
          </div>
          <p className="max-w-sm text-foreground/70">
            מורכבות הביטוח מתורגמת לשפה פשוטה ואלגנטית — כל תחום הוא עמוד תמיכה
            שנבנה סביבכם בלבד.
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