import React from "react";

interface Carrier {
  he: string;
  en: string;
  url: string;
}

const CARRIERS: Carrier[] = [
  { he: "מגדל", en: "Migdal", url: "https://www.migdal.co.il" },
  { he: "כלל", en: "Clal", url: "https://www.clalbit.co.il" },
  // harel-group.co.il, not harel.co.il — the latter 301s to oneharel.co.il,
  // which is the customer login portal rather than the insurer's own site. A
  // visitor following a carrier logo wants to read about the company, not be
  // asked to sign in to an account they may not have.
  { he: "הראל", en: "Harel", url: "https://www.harel-group.co.il" },
  { he: "מנורה מבטחים", en: "Menora Mivtachim", url: "https://www.menoramivtachim.co.il" },
  // fnx.co.il, not phoenix.co.il — the latter does not resolve at all.
  { he: "הפניקס", en: "The Phoenix", url: "https://www.fnx.co.il" },
  { he: "עמיתים", en: "Amitim", url: "https://www.amitim.com" },
  { he: "איילון", en: "Ayalon", url: "https://www.ayalon.co.il" },
  { he: "AIG", en: "AIG", url: "https://www.aig.co.il" },
];

export default function CarrierLogos() {
  return (
    <section className="relative py-16 md:py-20 border-y border-border/50 bg-secondary/30 overflow-hidden">
      {/* subtle architectural accent line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-accent/25 to-transparent" />
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <div className="text-center mb-10 md:mb-12">
          <p className="text-[11px] tracking-[0.35em] uppercase text-accent">
            עובדת מול מיטב חברות הפנסיה והביטוח בישראל
          </p>
          <div className="mt-4 mx-auto w-10 h-px bg-highlight-muted/60" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-x-2 gap-y-8 md:gap-y-10 items-center">
          {CARRIERS.map((c) => (
            <a
              key={c.en}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`אתר ${c.he}`}
              className="group flex flex-col items-center text-center"
            >
              <span className="font-heading text-lg md:text-xl tracking-tight leading-none text-muted-foreground/55 group-hover:text-foreground transition-colors duration-500">
                {c.he}
              </span>
              {c.en && c.en !== c.he && (
                <span className="mt-1.5 text-[9px] tracking-[0.3em] uppercase text-muted-foreground/35 group-hover:text-accent/70 transition-colors duration-500">
                  {c.en}
                </span>
              )}
            </a>
          ))}
        </div>

        <p className="mt-12 text-center text-sm text-muted-foreground/55 max-w-xl mx-auto leading-relaxed">
          גישה בלתי-תלויה לכל שוק הפנסיה והביטוח — ההמלצה נגזרת אך ורק מהצורך שלך,
          לא משייכות מסחרית לחברה כלשהי.
        </p>
      </div>
    </section>
  );
}