import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X, Phone, MessageCircle, Calendar, ChevronLeft } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { CONTACT } from "@/config/contact";

const NAV = [
  { label: "אודות", href: "#about" },
  { label: "נקודת מבט", href: "#perspective" },
  { label: "שירותים", href: "#services" },
  { label: "הצלחות", href: "#proof" },
  { label: "לקוחות מספרים", href: "#testimonials" },
  { label: "בלוג", href: "/blog", route: true },
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

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      const onKey = (e) => e.key === "Escape" && setOpen(false);
      window.addEventListener("keydown", onKey);
      return () => {
        document.body.style.overflow = "";
        window.removeEventListener("keydown", onKey);
      };
    }
  }, [open]);

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
          {NAV.map((n) =>
            n.route ? (
              <Link
                key={n.href}
                to={n.href}
                className="text-sm tracking-wide text-foreground/80 hover:text-accent transition-colors relative group"
              >
                {n.label}
                <span className="absolute -bottom-1 right-0 w-0 h-px bg-accent group-hover:w-full transition-all duration-300" />
              </Link>
            ) : (
              <a
                key={n.href}
                href={n.href}
                className="text-sm tracking-wide text-foreground/80 hover:text-accent transition-colors relative group"
              >
                {n.label}
                <span className="absolute -bottom-1 right-0 w-0 h-px bg-accent group-hover:w-full transition-all duration-300" />
              </a>
            )
          )}
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

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="md:hidden fixed inset-0 z-[60] bg-primary/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              className="md:hidden fixed top-0 right-0 bottom-0 z-[70] w-[86%] max-w-sm bg-background shadow-2xl flex flex-col"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="flex items-center justify-between px-6 py-5 border-b border-border/60">
                <span className="font-heading text-lg font-bold">תפריט</span>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="סגירת תפריט"
                  className="w-10 h-10 flex items-center justify-center border border-border hover:border-accent hover:text-accent transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <nav className="flex-1 overflow-y-auto px-2 py-3">
                {NAV.map((n) =>
                  n.route ? (
                    <Link
                      key={n.href}
                      to={n.href}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/40 hover:bg-secondary/60 hover:text-accent transition-colors"
                    >
                      <span>{n.label}</span>
                      <ChevronLeft size={18} className="text-muted-foreground" />
                    </Link>
                  ) : (
                    <a
                      key={n.href}
                      href={n.href}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/40 hover:bg-secondary/60 hover:text-accent transition-colors"
                    >
                      <span>{n.label}</span>
                      <ChevronLeft size={18} className="text-muted-foreground" />
                    </a>
                  )
                )}
              </nav>

              <div className="px-6 py-5 border-t border-border/60 space-y-3">
                <a
                  href="#consultation"
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center gap-2 w-full py-3.5 bg-[#C4A484] text-primary font-medium"
                >
                  <Calendar size={18} />
                  לקביעת פגישת ייעוץ
                </a>
                <div className="grid grid-cols-2 gap-3">
                  <a
                    href={`tel:${CONTACT.phoneE164}`}
                    className="flex items-center justify-center gap-2 py-3 border border-border text-sm font-medium hover:border-accent hover:text-accent transition-colors"
                  >
                    <Phone size={16} />
                    חייגו
                  </a>
                  <a
                    href={`https://wa.me/${CONTACT.whatsapp}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 py-3 border border-border text-sm font-medium hover:border-accent hover:text-accent transition-colors"
                  >
                    <MessageCircle size={16} />
                    WhatsApp
                  </a>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </header>
  );
}