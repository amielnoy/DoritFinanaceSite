import React from "react";
import { Outlet } from "react-router-dom";
import { LocaleProvider } from "@/i18n/LocaleContext";
import type { Locale } from "@/i18n/locales";

/** A route tree in one language: the provider, and the pages under it. */
export default function LocaleLayout({ locale }: { locale: Locale }) {
  return (
    <LocaleProvider locale={locale}>
      <Outlet />
    </LocaleProvider>
  );
}
