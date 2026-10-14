import React from "react";
import { useLocale, useT } from "@/i18n/LocaleContext";

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
  const t = useT("home");
  // English and French read the companies' English names; Hebrew shows both.
  const he = useLocale() === "he";
  return (
    <section className="bg-secondary border-b border-border">
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-14 flex flex-col items-center gap-8 max-md:py-8 max-md:gap-5">
        <p className="text-center font-heading italic text-[15px] normal-case text-accent">
          {t("carriers.title")}
        </p>

        {/* Below md: one strip that scrolls sideways — four rows of a 2-column
            grid was most of a screen. The links stay in the tab order, and a
            focused one off the edge scrolls into the strip. */}
        <div className="w-full grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 border-y border-border max-md:flex max-md:overflow-x-auto max-md:[scrollbar-width:none] max-md:-mx-[clamp(20px,4vw,40px)] max-md:w-auto max-md:self-stretch max-md:px-[clamp(20px,4vw,40px)] max-md:border-x-0">
          {CARRIERS.map((c) => (
            <a
              key={c.en}
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("carriers.site", { name: he ? c.he : c.en })}
              className="group flex flex-col items-center gap-1 px-2 py-[22px] text-center text-foreground/80 hover:text-foreground hover:bg-highlight/5 transition-colors duration-200 max-md:shrink-0 max-md:px-4 max-md:py-3 max-md:min-h-11 max-md:justify-center"
            >
              <span className="font-heading text-[21px] leading-[1.1]">
                {he ? c.he : c.en}
              </span>
              {he && c.en && c.en !== c.he && (
                <span dir="ltr" className="font-heading italic text-[15px] normal-case text-muted-foreground">
                  {c.en}
                </span>
              )}
            </a>
          ))}
        </div>

        <p className="m-0 text-center text-[15px] text-muted-foreground max-w-[480px] leading-[1.85] [text-wrap:pretty]">
          {t("carriers.disclosure")}
        </p>
      </div>
    </section>
  );
}
