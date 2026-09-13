import React, { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Menu, X, Phone, MessageCircle, Calendar, ChevronLeft } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { CONTACT } from "@/config/contact";

interface NavItem {
  label: string;
  href: string;
  route?: boolean;
}

/**
 * Four, where there were eight.
 *
 * Eight items is past the number a reader scans and into the number they
 * read — a lot of deliberation to put in front of a page whose job is one
 * booking. Several also named the same promise twice: `הצלחות` and
 * `לקוחות מספרים` are both social proof, `נקודת מבט` and `אודות` are both
 * who she is.
 *
 * Nothing was deleted from the page. Those sections are still there and still
 * reached by scrolling; they simply no longer each claim a slot in the bar.
 * `שאלות ותשובות` moved to the footer, which is where a reader looks for it
 * once they have not found an answer above.
 */
const NAV: NavItem[] = [
  { label: "אודות", href: "#about" },
  { label: "שירותים", href: "#services" },
  { label: "תביעות", href: "/claims", route: true },
  { label: "בלוג", href: "/blog", route: true },
];

export default function FloatingHeader() {
  const [scrolled, setScrolled] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  /**
   * Every section these anchors name lives on the home page, and the header is
   * rendered on every route. A bare `href="#services"` on /blog therefore sets
   * the URL to /blog#services, finds no element of that id, and does nothing
   * whatsoever — which left the entire main menu dead on /blog, /claims, /faq,
   * /privacy and /accessibility, the CTA and the logo included. (A hash-only
   * anchor fires `hashchange`, not `popstate`, so React Router never sees the
   * change either and ScrollToTop cannot rescue it.)
   *
   * Route home first, then scroll — the same thing SectionNav does. The href
   * stays a real `/#section` URL so middle-click, "open in new tab" and a
   * JS-less load all still land in the right place.
   */
  const goToSection = (e: React.MouseEvent, hash: string) => {
    // Leave modified clicks to the browser, or new-tab stops working.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setOpen(false);

    if (pathname !== "/") {
      navigate(`/${hash}`);
      return;
    }

    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
    // Keep the address bar honest without letting the browser jump-scroll.
    window.history.replaceState(null, "", hash);
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
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
        <a
          href="/#top"
          onClick={(e) => goToSection(e, "#top")}
          className="flex items-center gap-3 leading-none"
        >
          <span className="hidden sm:flex w-9 h-9 items-center justify-center border border-accent/40 font-heading text-base text-accent">
            ד
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-heading text-xl md:text-2xl font-bold tracking-tight">
              דורית גוב ארי
            </span>
            <span className="text-[10px] md:text-[11px] tracking-[0.3em] uppercase text-muted-foreground mt-1">
              התכנון שלי — הרווח שלך
            </span>
          </span>
        </a>

        <nav className="hidden md:flex items-center gap-7 lg:gap-9 whitespace-nowrap">
          {NAV.map((n) =>
            n.route ? (
              <Link
                key={n.href}
                to={n.href}
                className="text-[13px] tracking-[0.04em] text-foreground/75 hover:text-accent transition-colors duration-300 relative group py-1"
              >
                {n.label}
                <span className="absolute -bottom-0.5 right-0 w-0 h-px bg-accent group-hover:w-full transition-all duration-300" />
              </Link>
            ) : (
              <a
                key={n.href}
                href={`/${n.href}`}
                onClick={(e) => goToSection(e, n.href)}
                className="text-[13px] tracking-[0.04em] text-foreground/75 hover:text-accent transition-colors duration-300 relative group py-1"
              >
                {n.label}
                <span className="absolute -bottom-0.5 right-0 w-0 h-px bg-accent group-hover:w-full transition-all duration-300" />
              </a>
            )
          )}
        </nav>

        <div className="flex items-center gap-2.5">
          <a
            href="/#consultation"
            onClick={(e) => goToSection(e, "#consultation")}
            className="hidden md:inline-flex items-center px-5 py-2.5 bg-highlight-muted text-primary text-[13px] font-medium tracking-wide hover:bg-highlight-strong transition-colors duration-300"
          >
            לקביעת פגישת ייעוץ
          </a>
          {/* Desktop only. On a phone the sticky bar at the bottom of every
              screen already offers חיוג עכשיו, at thumb height and always in
              view — so this one only competed with it, and left the first
              screen carrying four buttons for two intentions. The drawer still
              has a call button for anyone who opens it. */}
          <a
            href={`tel:${CONTACT.phoneE164}`}
            aria-label="התקשרות לדורית גוב ארי"
            className="hidden md:inline-flex items-center gap-2 px-4 py-2.5 border border-[#9c9c9c] text-[13px] font-medium hover:border-accent hover:text-accent transition-colors duration-300"
          >
            <Phone size={15} className="text-[#9c9c9c]" />
            <span dir="ltr">{CONTACT.phoneDisplay}</span>
          </a>
          <button
            /* p-3 keeps the tap target at 46px — WCAG 2.5.5 / iOS HIG want >= 44. */
            className="md:hidden p-3"
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
                      href={`/${n.href}`}
                      onClick={(e) => goToSection(e, n.href)}
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
                  href="/#consultation"
                  onClick={(e) => goToSection(e, "#consultation")}
                  className="flex items-center justify-center gap-2 w-full py-3.5 bg-highlight text-primary font-medium"
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