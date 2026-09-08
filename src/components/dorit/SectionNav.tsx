import React, { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";

interface SectionItem {
  id: string;
  label: string;
}

const SECTIONS: SectionItem[] = [
  { id: "top", label: "ראשי" },
  { id: "about", label: "אודות" },
  { id: "perspective", label: "נקודת מבט" },
  { id: "services", label: "שירותים" },
  { id: "proof", label: "תיקי הצלחה" },
  { id: "testimonials", label: "המלצות" },
  { id: "faq", label: "שאלות נפוצות" },
  { id: "consultation", label: "קביעת ייעוץ" },
  { id: "detailed-contact", label: "יצירת קשר" },
];

export default function SectionNav() {
  const [open, setOpen] = useState<boolean>(false);
  const [active, setActive] = useState<string>("top");

  useEffect(() => {
    const handler = () => {
      let current = "top";
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el) {
          const top = el.getBoundingClientRect().top;
          if (top <= 120) current = s.id;
        }
      }
      setActive(current);
    };
    window.addEventListener("scroll", handler, { passive: true });
    handler();
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (id === "top") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
    setOpen(false);
  };

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
      {open && (
        <nav
          aria-label="ניווט מהיר בין מדורים"
          className="flex flex-col bg-card border border-border/70 shadow-lg overflow-hidden animate-fade-up"
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => jump(s.id)}
              className={`text-right px-5 py-3 text-sm border-b border-border/40 last:border-b-0 transition-colors ${
                active === s.id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-background text-foreground/80"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "סגירת ניווט מהיר" : "פתיחת ניווט מהיר"}
        aria-expanded={open}
        className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg hover:scale-105 transition-transform duration-300"
      >
        {open ? <X size={22} /> : <Menu size={22} />}
      </button>
    </div>
  );
}