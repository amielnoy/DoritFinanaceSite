import React from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { useSeo } from "@/lib/seo";
import { useLocale, useLocalePath, useT } from "@/i18n/LocaleContext";
import { splitLocale } from "@/i18n/locales";
import type { KeyOf } from "@/i18n/resources";

/** Where a lost visitor most likely meant to go: the header's pages, in its order. */
const LINKS: Array<{ label: KeyOf<"common">; href: string; hebrewOnly?: boolean }> = [
  { label: "nav.tools", href: "/tools" },
  { label: "nav.claims", href: "/claims" },
  { label: "nav.blog", href: "/blog", hebrewOnly: true },
  { label: "nav.faq", href: "/faq" },
];

/**
 * Any address no route claims, in the site's own frame and language.
 *
 * This replaced Base44's template page, which said "Page Not Found … Go Home"
 * in English on a Hebrew site, outside the header and footer, with a grey
 * "404" heading below the contrast floor and no `<main id="main">` (D-04, D-07 and D-08,
 * manual test 2026-10-14).
 *
 * On Vercel an address no rewrite claims is served `dist/404.html` with a 404
 * status — this page, prerendered (scripts/prerender.mjs) — so a crawler is
 * told the truth and not shown a 200 with the home page's canonical (D-05).
 */
export default function NotFound() {
  const t = useT("common");
  const locale = useLocale();
  const lp = useLocalePath();
  const { pathname } = useLocation();

  // A 404 must never be indexed as a duplicate of the home page.
  useSeo({
    title: t("notFound.seoTitle"),
    description: t("notFound.seoDescription"),
    // Unprefixed: useSeo adds the /en or /fr itself.
    path: splitLocale(pathname).rest,
    locale,
    noIndex: true,
  });

  const links = LINKS.filter((l) => locale === "he" || !l.hebrewOnly);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <FloatingHeader />
      <main id="main" data-testid="not-found" className="flex-1 pt-32 md:pt-40 pb-20 md:pb-28">
        <div className="max-w-3xl mx-auto px-6 md:px-10">
          <Eyebrow>{t("notFound.eyebrow")}</Eyebrow>
          <h1 className="font-heading text-4xl md:text-5xl mt-5 leading-tight text-foreground">
            {t("notFound.title")}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-foreground">{t("notFound.text")}</p>

          <div className="mt-8">
            <Link to={lp("/")} className={ctaClass()}>
              {t("notFound.home")}
            </Link>
          </div>

          <nav aria-label={t("notFound.linksLabel")} className="mt-10">
            <ul className="flex flex-wrap gap-x-8 gap-y-3">
              {links.map((l) => (
                <li key={l.href}>
                  <Link
                    to={lp(l.href)}
                    className="inline-flex items-center gap-1 min-h-11 text-foreground underline underline-offset-4 hover:text-accent transition-colors"
                  >
                    {t(l.label)}
                    <ChevronLeft size={16} aria-hidden="true" className="ltr:rotate-180" />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </main>
      <Footer />
    </div>
  );
}
