import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X, Phone, MessageCircle, Calendar, ChevronLeft } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { CONTACT } from "@/config/contact";
import { useAuth } from "@/lib/AuthContext";
import { useSectionNav } from "@/hooks/useSectionNav";
import { ctaClass } from "@/components/dorit/primitives/Cta";

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
 * `שאלות ותשובות` moved to the footer for a while, and came back: the support
 * chat lives at the bottom of /faq, and with the only links to it in the
 * footer, nobody found it — Dorit included, on a phone and on a desktop.
 */
const NAV: NavItem[] = [
  { label: "אודות", href: "#about" },
  { label: "שירותים", href: "#services" },
  { label: "נקודת מבט", href: "/perspective", route: true },
  { label: "כלים", href: "/tools", route: true },
  { label: "תביעות", href: "/claims", route: true },
  { label: "בלוג", href: "/blog", route: true },
  { label: "שאלות ותשובות", href: "/faq", route: true },
];

const NAV_LINK =
  "text-[15px] py-2.5 text-foreground border-b border-transparent hover:text-accent hover:border-highlight transition-colors duration-200";

export default function FloatingHeader() {
  const [open, setOpen] = useState<boolean>(false);
  const navigateToSection = useSectionNav();
  const { isAuthenticated, user, logout } = useAuth();
  // Home rather than this page: on /account or /admin/* the guard would bounce a
  // signed-out visitor straight to the login screen.
  const signOut = () => {
    setOpen(false);
    logout(true, `${window.location.origin}/`);
  };

  /**
   * Anchors here name sections that live only on the home page, and this header
   * is rendered on every route — so a bare `#services` on /blog would set the
   * URL to /blog#services and do nothing at all. Route home first, then scroll.
   *
   * The implementation moved to `useSectionNav` when the footer turned out to
   * have the same links and none of the handling. See the hook.
   */
  const goToSection = (e: React.MouseEvent, hash: string) => {
    setOpen(false);
    navigateToSection(e, hash);
  };

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
    <header className="fixed top-0 inset-x-0 z-50 bg-background border-b border-border">
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-4 flex items-center justify-between gap-6">
        <a
          href="/#top"
          onClick={(e) => goToSection(e, "#top")}
          className="flex items-center gap-3 leading-none"
        >
          <span className="hidden sm:flex w-[38px] h-[38px] shrink-0 items-center justify-center border border-highlight font-heading text-[19px] text-accent">
            ד
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-heading text-xl md:text-[23px] font-medium">
              דורית גוב ארי
            </span>
            <span className="text-[13px] text-muted-foreground mt-1">
              התכנון שלי — השקט שלך
            </span>
          </span>
        </a>

        <div className="flex items-center gap-2.5">
          <a
            href="/#start"
            onClick={(e) => goToSection(e, "#start")}
            className={ctaClass("hidden md:inline-flex min-h-11 px-5 text-[17px]")}
          >
            לשיחה קצרה עם דורית
          </a>
          {/* Desktop only. On a phone the sticky bar at the bottom of every
              screen already offers חיוג עכשיו, at thumb height and always in
              view — so this one only competed with it, and left the first
              screen carrying four buttons for two intentions. The drawer still
              has a call button for anyone who opens it. */}
          <a
            href={`tel:${CONTACT.phoneE164}`}
            aria-label="התקשרות לדורית גוב ארי"
            className="hidden md:inline-flex items-center gap-2 min-h-11 px-4 border border-border rounded-md text-[15px] text-foreground hover:bg-foreground/[0.06] transition-colors duration-200"
          >
            <Phone size={15} className="text-accent" />
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

      {/* Second masthead row: the navigation. Links underline in gold on hover. */}
      <nav className="hidden md:block border-t border-border/60">
        <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] flex flex-wrap items-center gap-x-7 whitespace-nowrap">
          {NAV.map((n) =>
            n.route ? (
              <Link key={n.href} to={n.href} className={NAV_LINK}>
                {n.label}
              </Link>
            ) : (
              <a
                key={n.href}
                href={`/${n.href}`}
                onClick={(e) => goToSection(e, n.href)}
                className={NAV_LINK}
              >
                {n.label}
              </a>
            )
          )}
          {isAuthenticated ? (
            <Link to="/account" className={NAV_LINK}>האזור שלי</Link>
          ) : null}
          {isAuthenticated && user?.role === "admin" ? (
            <>
              <Link to="/admin/leads" className={NAV_LINK}>ניהול פניות</Link>
              <Link to="/admin/blog" className={NAV_LINK}>ניהול בלוג</Link>
            </>
          ) : null}
          {isAuthenticated ? (
            <button type="button" onClick={signOut} className={NAV_LINK}>
              יציאה
            </button>
          ) : null}
        </div>
      </nav>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="md:hidden fixed inset-0 z-[60] bg-primary/40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              className="md:hidden fixed top-0 right-0 bottom-0 z-[70] w-[86%] max-w-sm bg-background border-l border-border flex flex-col"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="flex items-center justify-between px-6 py-5 border-b border-border/60">
                <span className="font-heading text-lg font-medium">תפריט</span>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="סגירת תפריט"
                  className="w-11 h-11 flex items-center justify-center border border-border rounded-md hover:border-highlight hover:text-accent transition-colors duration-200"
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
                      className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200"
                    >
                      <span>{n.label}</span>
                      <ChevronLeft size={18} className="text-muted-foreground" />
                    </Link>
                  ) : (
                    <a
                      key={n.href}
                      href={`/${n.href}`}
                      onClick={(e) => goToSection(e, n.href)}
                      className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200"
                    >
                      <span>{n.label}</span>
                      <ChevronLeft size={18} className="text-muted-foreground" />
                    </a>
                  )
                )}
          {isAuthenticated ? (
            <Link to="/account" className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200" onClick={() => setOpen(false)}><span>האזור שלי</span><ChevronLeft size={18} className="text-muted-foreground" /></Link>
          ) : null}
          {isAuthenticated && user?.role === "admin" ? (
            <>
              <Link to="/admin/leads" className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200" onClick={() => setOpen(false)}><span>ניהול פניות</span><ChevronLeft size={18} className="text-muted-foreground" /></Link>
              <Link to="/admin/blog" className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200" onClick={() => setOpen(false)}><span>ניהול בלוג</span><ChevronLeft size={18} className="text-muted-foreground" /></Link>
            </>
          ) : null}
          {isAuthenticated ? (
            <button type="button" onClick={signOut} className="w-full flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200 text-start">
              <span>יציאה</span>
            </button>
          ) : null}
              </nav>

              <div className="px-6 py-5 border-t border-border/60 space-y-3">
                <a
                  href="/#start"
                  onClick={(e) => goToSection(e, "#start")}
                  className={ctaClass("flex w-full")}
                >
                  <Calendar size={18} />
                  לשיחה קצרה עם דורית
                </a>
                <div className="grid grid-cols-2 gap-3">
                  <a
                    href={`tel:${CONTACT.phoneE164}`}
                    className="flex items-center justify-center gap-2 min-h-12 border border-border rounded-md text-[15px] hover:border-highlight hover:bg-highlight/5 transition-colors duration-200"
                  >
                    <Phone size={16} />
                    חייגו
                  </a>
                  <a
                    href={`https://wa.me/${CONTACT.whatsapp}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 min-h-12 border border-border rounded-md text-[15px] hover:border-highlight hover:bg-highlight/5 transition-colors duration-200"
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