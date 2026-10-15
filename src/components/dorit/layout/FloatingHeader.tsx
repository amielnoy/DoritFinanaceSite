import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X, Phone, MessageCircle, Calendar, ChevronLeft, User, LifeBuoy } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { CONTACT } from "@/config/contact";
import { useAuth } from "@/lib/AuthContext";
import { useSectionNav } from "@/hooks/useSectionNav";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { useQuery } from "@tanstack/react-query";
import { MASLEKA_ENABLED } from "@/config/masleka";
import { services } from "@/services";
import SupportLink from "./SupportLink";
import LanguageSwitcher from "./LanguageSwitcher";
import { useLocale, useLocalePath, useT } from "@/i18n/LocaleContext";
import type { KeyOf } from "@/i18n/resources";

interface NavItem {
  label: KeyOf<"common">;
  href: string;
  route?: boolean;
  /** A page that exists in Hebrew only — left out of the English and French menus. */
  hebrewOnly?: boolean;
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
  { label: "nav.about", href: "#about" },
  { label: "nav.services", href: "#services" },
  { label: "nav.perspective", href: "/perspective", route: true, hebrewOnly: true },
  { label: "nav.tools", href: "/tools", route: true },
  { label: "nav.claims", href: "/claims", route: true },
  { label: "nav.blog", href: "/blog", route: true, hebrewOnly: true },
  { label: "nav.faq", href: "/faq", route: true },
];

const NAV_LINK =
  "text-[15px] py-2.5 text-foreground border-b border-transparent hover:text-accent hover:border-highlight transition-colors duration-200";

/**
 * Where a signed-out visitor signs in, and comes back to their own area.
 *
 * Until this existed the header offered no way in at all: the account links
 * appeared only once signed in, and the only route to sign-in was typing an
 * admin address and letting the guard bounce you there.
 */
const LOGIN_HREF = "/login?returnTo=/account";

/**
 * The clearinghouse board's link, for the people its gate (StaffRoute) lets
 * in: the platform admin, or a member of the agency — asked of the database
 * (`my_staff_role`), since the token carries no membership. Mounted only while
 * VITE_MASLEKA_ENABLED is on, so a dark build neither shows it nor asks.
 * Only the link depends on this answer; the route and every action on the
 * board check again for themselves.
 */
function MaslekaMenuLink({
  className,
  onClick,
  children,
}: {
  className: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const { user } = useAuth();
  const userId = typeof user?.id === "string" ? user.id : "";
  const isAdmin = user?.role === "admin";
  const role = useQuery({
    queryKey: ["admin", "staff-role-menu", userId],
    queryFn: () => services.masleka.myRole(),
    enabled: !isAdmin && userId !== "",
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!isAdmin && !(typeof role.data === "string" && role.data)) return null;
  return (
    <Link to="/admin/masleka" className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

export default function FloatingHeader() {
  const [open, setOpen] = useState<boolean>(false);
  const navigateToSection = useSectionNav();
  const { isAuthenticated, isLoadingAuth, user, logout } = useAuth();
  // Not while the auth check is still answering: a signed-in visitor would see
  // the sign-in link flash and vanish on every page load.
  const showLogin = !isAuthenticated && !isLoadingAuth;
  const t = useT("common");
  const lp = useLocalePath();
  const locale = useLocale();
  const nav = NAV.filter((n) => locale === "he" || !n.hebrewOnly);
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
          href={lp("/#top")}
          onClick={(e) => goToSection(e, "#top")}
          className="flex items-center gap-3 leading-none"
        >
          <span className="hidden sm:flex w-[38px] h-[38px] shrink-0 items-center justify-center border border-highlight font-heading text-[19px] text-accent">
            {t("brand.monogram")}
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-heading text-xl md:text-[23px] font-medium">
              {t("brand.name")}
            </span>
            <span className="text-[13px] text-muted-foreground mt-1">
              {t("brand.slogan")}
            </span>
          </span>
        </a>

        <div className="flex items-center gap-2.5">
          <LanguageSwitcher className="hidden md:inline-flex" />
          <a
            href={lp("/#start")}
            onClick={(e) => goToSection(e, "#start")}
            className={ctaClass("hidden md:inline-flex min-h-11 px-5 text-[17px]")}
          >
            {t("cta.shortCall")}
          </a>
          {/* Desktop only. On a phone the sticky bar at the bottom of every
              screen already offers חיוג עכשיו, at thumb height and always in
              view — so this one only competed with it, and left the first
              screen carrying four buttons for two intentions. The drawer still
              has a call button for anyone who opens it. */}
          <a
            href={`tel:${CONTACT.phoneE164}`}
            aria-label={t("header.callAria")}
            className="hidden md:inline-flex items-center gap-2 min-h-11 px-4 border border-border rounded-md text-[15px] text-foreground hover:bg-foreground/[0.06] transition-colors duration-200"
          >
            <Phone size={15} className="text-accent" />
            <span dir="ltr">{CONTACT.phoneDisplay}</span>
          </a>
          <button
            /* p-3 keeps the tap target at 46px — WCAG 2.5.5 / iOS HIG want >= 44. */
            className="md:hidden p-3"
            onClick={() => setOpen((v) => !v)}
            aria-label={t("header.menu")}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {/* Second masthead row: the navigation. Links underline in gold on hover. */}
      <nav className="hidden md:block border-t border-border/60">
        <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] flex flex-wrap items-center gap-x-7 whitespace-nowrap">
          {nav.map((n) =>
            n.route ? (
              <Link key={n.href} to={lp(n.href)} className={NAV_LINK}>
                {t(n.label)}
              </Link>
            ) : (
              <a
                key={n.href}
                href={lp(`/${n.href}`)}
                onClick={(e) => goToSection(e, n.href)}
                className={NAV_LINK}
              >
                {t(n.label)}
              </a>
            )
          )}
          {/* The account links, apart from the site's sections at the far end of
              the row. A quiet text link like the others — the gold CTA in the
              top row stays the one thing asking to be pressed. */}
          <div className="ms-auto flex items-center gap-x-7">
            {showLogin ? (
              <Link to={LOGIN_HREF} className={`${NAV_LINK} inline-flex items-center gap-1.5`}>
                <User size={15} aria-hidden="true" className="text-accent" />
                {t("header.login")}
              </Link>
            ) : null}
            {isAuthenticated ? (
              <Link to="/account" className={NAV_LINK}>{t("header.account")}</Link>
            ) : null}
            {isAuthenticated && user?.role === "admin" ? (
              <>
                <Link to="/admin/leads" className={NAV_LINK}>ניהול פניות</Link>
                <Link to="/admin/blog" className={NAV_LINK}>ניהול בלוג</Link>
                <Link to="/admin/users" className={NAV_LINK}>ניהול משתמשים</Link>
              </>
            ) : null}
            {MASLEKA_ENABLED && isAuthenticated ? (
              <MaslekaMenuLink className={NAV_LINK}>בקשות מסלקה</MaslekaMenuLink>
            ) : null}
            {isAuthenticated ? (
              <button type="button" onClick={signOut} className={NAV_LINK}>
                {t("header.logout")}
              </button>
            ) : null}
          </div>
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
                <span className="font-heading text-lg font-medium">{t("header.menu")}</span>
                <button
                  onClick={() => setOpen(false)}
                  aria-label={t("header.closeMenu")}
                  className="w-11 h-11 flex items-center justify-center border border-border rounded-md hover:border-highlight hover:text-accent transition-colors duration-200"
                >
                  <X size={20} />
                </button>
              </div>

              <nav className="flex-1 overflow-y-auto px-2 py-3">
                {nav.map((n) =>
                  n.route ? (
                    <Link
                      key={n.href}
                      to={lp(n.href)}
                      onClick={() => setOpen(false)}
                      className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200"
                    >
                      <span>{t(n.label)}</span>
                      <ChevronLeft size={18} className="text-muted-foreground ltr:rotate-180" />
                    </Link>
                  ) : (
                    <a
                      key={n.href}
                      href={lp(`/${n.href}`)}
                      onClick={(e) => goToSection(e, n.href)}
                      className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200"
                    >
                      <span>{t(n.label)}</span>
                      <ChevronLeft size={18} className="text-muted-foreground ltr:rotate-180" />
                    </a>
                  )
                )}
          {/* The support chat, by name, right under שאלות ותשובות — a second
              way in beside the sticky bar's "תמיכה". The drawer is md:hidden;
              the desktop keeps its round button in the floating dock. */}
          <SupportLink
            onClick={() => setOpen(false)}
            data-track-location="header_menu"
            className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200"
          >
            <span className="inline-flex items-center gap-2"><LifeBuoy size={18} aria-hidden="true" className="text-accent" />{t("header.support")}</span>
            <ChevronLeft size={18} className="text-muted-foreground ltr:rotate-180" />
          </SupportLink>
          {isAuthenticated ? (
            <Link to="/account" className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200" onClick={() => setOpen(false)}><span>{t("header.account")}</span><ChevronLeft size={18} className="text-muted-foreground ltr:rotate-180" /></Link>
          ) : showLogin ? (
            <Link to={LOGIN_HREF} className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200" onClick={() => setOpen(false)}><span className="inline-flex items-center gap-2"><User size={18} aria-hidden="true" className="text-accent" />{t("header.login")}</span><ChevronLeft size={18} className="text-muted-foreground ltr:rotate-180" /></Link>
          ) : null}
          {isAuthenticated && user?.role === "admin" ? (
            <>
              <Link to="/admin/leads" className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200" onClick={() => setOpen(false)}><span>ניהול פניות</span><ChevronLeft size={18} className="text-muted-foreground" /></Link>
              <Link to="/admin/blog" className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200" onClick={() => setOpen(false)}><span>ניהול בלוג</span><ChevronLeft size={18} className="text-muted-foreground" /></Link>
              <Link to="/admin/users" className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200" onClick={() => setOpen(false)}><span>ניהול משתמשים</span><ChevronLeft size={18} className="text-muted-foreground" /></Link>
            </>
          ) : null}
          {MASLEKA_ENABLED && isAuthenticated ? (
            <MaslekaMenuLink className="flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200" onClick={() => setOpen(false)}><span>בקשות מסלקה</span><ChevronLeft size={18} className="text-muted-foreground" /></MaslekaMenuLink>
          ) : null}
          {isAuthenticated ? (
            <button type="button" onClick={signOut} className="w-full flex items-center justify-between px-4 py-4 text-lg border-b border-border/60 hover:bg-highlight/5 hover:text-accent transition-colors duration-200 text-start">
              <span>{t("header.logout")}</span>
            </button>
          ) : null}
              </nav>

              <div className="px-6 py-5 border-t border-border/60 space-y-3">
                <LanguageSwitcher className="flex w-full justify-center" />
                <a
                  href={lp("/#start")}
                  onClick={(e) => goToSection(e, "#start")}
                  className={ctaClass("flex w-full")}
                >
                  <Calendar size={18} />
                  {t("cta.shortCall")}
                </a>
                <div className="grid grid-cols-2 gap-3">
                  <a
                    href={`tel:${CONTACT.phoneE164}`}
                    className="flex items-center justify-center gap-2 min-h-12 border border-border rounded-md text-[15px] hover:border-highlight hover:bg-highlight/5 transition-colors duration-200"
                  >
                    <Phone size={16} />
                    {t("header.call")}
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