import React from "react";
import { Outlet } from "react-router-dom";
import { LocaleProvider } from "@/i18n/LocaleContext";
import SkipLink from "@/components/dorit/layout/SkipLink";
import type { Locale } from "@/i18n/locales";

/** A route tree in one language: the provider, the skip link, and the pages under it. */
export default function LocaleLayout({ locale }: { locale: Locale }) {
  return (
    <LocaleProvider locale={locale}>
      <SkipLink />
      <Outlet />
    </LocaleProvider>
  );
}
