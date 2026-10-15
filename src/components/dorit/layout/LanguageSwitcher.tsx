import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Globe } from "lucide-react";
import { useLocale, useT } from "@/i18n/LocaleContext";
import { ENABLED_LOCALES, TRANSLATED_ROUTES, localePath, splitLocale, type Locale } from "@/i18n/locales";
import { cn } from "@/lib/utils";

/**
 * The same page in another language: "עברית · English · Français". Shown only
 * when a build serves more than Hebrew (VITE_LOCALES); each link keeps the
 * page and its query, and a page that exists in Hebrew only leads to the
 * other language's home.
 */
const TRANSLATED: ReadonlySet<string> = new Set(TRANSLATED_ROUTES);

export function switchTarget(pathname: string, search: string, hash: string, to: Locale): string {
  const { rest } = splitLocale(pathname);
  const page = TRANSLATED.has(rest.replace(/\/$/, "") || "/") ? rest : "/";
  return `${localePath(to, page)}${search}${page === rest ? hash : ""}`;
}

export default function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useT("common");
  const { pathname, search, hash } = useLocation();
  if (ENABLED_LOCALES.length < 2) return null;
  return (
    <nav aria-label={t("lang.label")} className={cn("items-center gap-1 text-[14px]", className)}>
      <Globe size={15} aria-hidden="true" className="text-accent" />
      {ENABLED_LOCALES.map((l, i) => (
        <React.Fragment key={l}>
          {i > 0 ? <span aria-hidden="true" className="text-muted-foreground">·</span> : null}
          {l === locale ? (
            <span aria-current="true" className="px-1 font-medium text-accent" lang={l}>
              {t(`lang.${l}`)}
            </span>
          ) : (
            <Link to={switchTarget(pathname, search, hash, l)} lang={l} hrefLang={l} className="px-1 min-h-11 inline-flex items-center hover:text-accent">
              {t(`lang.${l}`)}
            </Link>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
