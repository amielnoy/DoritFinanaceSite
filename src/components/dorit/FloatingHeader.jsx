import React, { useEffect, useState } from "react";
import { Menu, X, Phone } from "lucide-react";
import { CONTACT } from "@/config/contact";

const NAV = [
  { label: "אודות", href: "#about" },
  { label: "נקודת מבט", href: "#perspective" },
  { label: "שירותים", href: "#services" },
  { label: "הצלחות", href: "#proof" },
  { label: "לקוחות מספרים", href: "#testimonials" },
  { label: "ייעוץ", href: "#consultation" },
];

export default function FloatingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
        scrolled ? "glass border-b border-border/60 py-3" : "py-6 bg-transparent"
      }`}
    >
      <div className="max-w-[1400px] mx-auto px-6 md:px-10 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-3 leading-none">
          <span className="hidden sm:flex w-9 h-9 items-center justify-center border border-accent/40 font-heading text-base text-accent">
            ד
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-heading text-xl md:text-2xl font-bold tracking-tight">
              דורית גוב ארי
            </span>
            <span className="text-[10px] md:text-[11px] tracking-[0.3em] uppercase text-muted-foreground mt-1">
              Architecture of Security
            </span>
          </span>
        </a>

        <nav className="hidden md:flex items-center gap-10">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="text-sm tracking-wide text-foreground/80 hover:text-accent transition-colors relative group"
            >
              {n.label}
              <span className="absolute -bottom-1 right-0 w-0 h-px bg-accent group-hover:w-full transition-all duration-300" />
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <a
            href={`tel:${CONTACT.phoneE164}`}
            aria-label="התקשרות לדורית גוב ארי"
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-border text-sm font-medium hover:border-accent hover:text-accent transition-colors duration-300"
          >
            <Phone size={16} />
            <span className="hidden sm:inline" dir="ltr">{CONTACT.phoneDisplay}</span>
            <span className="sm:hidden">חייגו</span>
          </a>
          <a
            href="#consultation"
            className="hidden md:inline-flex items-center px-5 py-2.5 bg-[#C4A484] text-primary text-sm font-medium hover:bg-[#b8916f] transition-colors duration-300"
          >
            לקביעת פגישת ייעוץ
          </a>
          <button
            className="md:hidden p-2"
            onClick={() => setOpen((v) => !v)}
            aria-label="תפריט"
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden glass border-t border-border/60 mt-3">
          <nav className="flex flex-col px-6 py-4">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className="py-3 text-base border-b border-border/40 last:border-0"
              >
                {n.label}
              </a>
            ))}
            <a
              href="#consultation"
              onClick={() => setOpen(false)}
              className="mt-4 inline-flex justify-center px-5 py-3 bg-[#C4A484] text-primary text-sm font-medium"
            >
              לקביעת פגישת ייעוץ
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}