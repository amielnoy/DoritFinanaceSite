import React from "react";

const CARRIERS = [
  { he: "מגדל", en: "Migdal" },
  { he: "כלל", en: "Clal" },
  { he: "הראל", en: "Harel" },
  { he: "מנורה מבטחים", en: "Menora Mivtachim" },
  { he: "הפניקס", en: "The Phoenix" },
  { he: "עמיתים", en: "Amitim" },
  { he: "איילון", en: "Ayalon" },
  { he: "טרם", en: "Tarem" },
  { he: "AIG", en: "AIG" },
  { he: "מונפורט", en: "Monfort" },
];

export default function CarrierLogos() {
  return (
    <section className="relative py-16 md:py-20 border-y border-border/60 bg-secondary/30">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <p className="text-center text-[11px] tracking-[0.35em] uppercase text-accent mb-10">
          עובדת מול מיטב חברות הביטוח והפנסיה בישראל
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-x-6 gap-y-8 md:gap-y-10 items-center">
          {CARRIERS.map((c) => (
            <div
              key={c.en}
              className="flex flex-col items-center text-center text-muted-foreground/70 hover:text-foreground transition-colors duration-300"
            >
              <span className="font-heading text-xl md:text-2xl tracking-tight leading-none">
                {c.he}
              </span>
              {c.en && c.en !== c.he && (
                <span className="mt-1.5 text-[10px] tracking-[0.25em] uppercase opacity-70">
                  {c.en}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}