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
  // menoramivt.co.il, not menoramivtachim.co.il — the long spelling has no
  // A record at all. menora.co.il redirects here too.
  { he: "מנורה מבטחים", en: "Menora Mivtachim", url: "https://www.menoramivt.co.il" },
  // fnx.co.il, not phoenix.co.il — the latter does not resolve at all.
  { he: "הפניקס", en: "The Phoenix", url: "https://www.fnx.co.il" },
  { he: "עמיתים", en: "Amitim", url: "https://www.amitim.com" },
  // ayalon-ins.co.il, not ayalon.co.il — the short form does not resolve.
  { he: "איילון", en: "Ayalon", url: "https://www.ayalon-ins.co.il" },
  { he: "AIG", en: "AIG", url: "https://www.aig.co.il" },
];

export default function CarrierLogos() {
  return (
    <section className="bg-secondary border-b border-border">
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-14 flex flex-col items-center gap-8">
        <p className="text-center font-heading italic text-[15px] normal-case text-accent">
          עובדת מול מיטב חברות הפנסיה והביטוח בישראל
        </p>

        <div className="w-full grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 border-y border-border">
          {CARRIERS.map((c) => (
            <a
              key={c.en}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`אתר ${c.he}`}
              className="group flex flex-col items-center gap-1 px-2 py-[22px] text-center text-foreground/80 hover:text-foreground hover:bg-highlight/5 transition-colors duration-200"
            >
              <span className="font-heading text-[21px] leading-[1.1]">
                {c.he}
              </span>
              {c.en && c.en !== c.he && (
                <span dir="ltr" className="font-heading italic text-[15px] normal-case text-muted-foreground">
                  {c.en}
                </span>
              )}
            </a>
          ))}
        </div>

        <p className="m-0 text-center text-[15px] text-muted-foreground max-w-[480px] leading-[1.85] [text-wrap:pretty]">
          עובדת מול מגוון חברות ביטוח ופנסיה כדי להתאים פתרון לצורך שלך. כסוכנת
          ביטוח, יש לי זיקה לגופים מוסדיים — כמפורט בגילוי הנאות.
        </p>
      </div>
    </section>
  );
}
