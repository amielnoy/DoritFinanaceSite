import React from "react";

const CARRIERS = [
  { he: "מגדל", en: "Migdal", url: "https://www.migdal.co.il" },
  { he: "כלל", en: "Clal", url: "https://www.clalbit.co.il" },
  { he: "הראל", en: "Harel", url: "https://www.harel.co.il" },
  { he: "מנורה מבטחים", en: "Menora Mivtachim", url: "https://www.menoramivtachim.co.il" },
  { he: "הפניקס", en: "The Phoenix", url: "https://www.phoenix.co.il" },
  { he: "עמיתים", en: "Amitim", url: "https://www.amitim.co.il" },
  { he: "איילון", en: "Ayalon", url: "https://www.ayalon.co.il" },
  { he: "טרם", en: "Tarem", url: "https://www.tarem.co.il" },
  { he: "AIG", en: "AIG", url: "https://www.aig.co.il" },
  { he: "מונפורט", en: "Monfort", url: "https://www.monfort.co.il" },
];

export default function CarrierLogos() {
  return (
    <section className="relative py-20 md:py-24 border-y border-border/60 bg-secondary/40 overflow-hidden">
      {/* subtle architectural accent line */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-l from-transparent via-accent/30 to-transparent" />
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <div className="text-center mb-12 md:mb-14">
          <p className="text-[11px] tracking-[0.35em] uppercase text-accent">
            עובדת מול מיטב חברות הביטוח והפנסיה בישראל
          </p>
          <div className="mt-5 mx-auto w-12 h-px bg-highlight/50" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-x-4 gap-y-10 md:gap-y-12 items-center">
          {CARRIERS.map((c) => (
            <a
              key={c.en}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`אתר ${c.he}`}
              className="group flex flex-col items-center text-center"
            >
              <span className="font-heading text-xl md:text-2xl tracking-tight leading-none text-muted-foreground/65 group-hover:text-foreground transition-colors duration-500">
                {c.he}
              </span>
              {c.en && c.en !== c.he && (
                <span className="mt-2 text-[9px] tracking-[0.3em] uppercase text-muted-foreground/40 group-hover:text-accent/70 transition-colors duration-500">
                  {c.en}
                </span>
              )}
            </a>
          ))}
        </div>

        <p className="mt-14 text-center text-sm text-muted-foreground/60 max-w-xl mx-auto leading-relaxed">
          גישה בלתי-תלויה לכל שוק הביטוח והפנסיה — ההמלצה נגזרת אך ורק מהצורך שלך,
          לא משייכות מסחרית לחברה כלשהי.
        </p>
      </div>
    </section>
  );
}