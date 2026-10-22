import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AGENCY_CONTENT } from "@/config/agency-content";
import { AGENCY1_ID } from "@/config/agency1";
import { useTestimonials } from "@/hooks/useContent";
import { useLocale, useT } from "@/i18n/LocaleContext";
import {
  bundledAgencyContent,
  bundledSuccessCases,
  resolveAgencyContent,
  siteHost,
  type AgencyContent,
  type Translate,
} from "@/lib/agency-content";
import { agentPhotoBase } from "@/lib/portrait";
import { services } from "@/services";
import type { SuccessCase } from "@/services/ports";

/**
 * What the public pages show of the agency the visitor's host belongs to
 * (R1, R8). The database is read only with VITE_AGENCY_CONTENT on, and only on
 * Hebrew pages, whose texts are the ones an agency writes; English and French
 * keep the bundled translations. Until the read answers, and whenever it
 * fails, the page shows the bundled agency-1 constants — the same page it
 * showed before the flag, with no blank and no spinner.
 */

export const agencyContentKeys = {
  site: (host: string) => ["agency-content", "site", host] as const,
  cases: (agencyId: string) => ["agency-content", "cases", agencyId] as const,
};

/** An agency changes its texts rarely; one read per visit is plenty. */
const STALE_TIME = 30 * 60_000;

/**
 * A failed read looks exactly like no read at all — the bundled page — so the
 * console is the one place it shows; the preview check before the flag goes on
 * in production looks for this line. Every component on the page observes the
 * same query and so the same error object; it is told once.
 */
const warned = new WeakSet<object>();

function useWarnOnFailure(error: unknown, read: "site" | "cases"): void {
  useEffect(() => {
    if (!error) return;
    if (typeof error === "object") {
      if (warned.has(error)) return;
      warned.add(error);
    }
    console.warn(`[agency-content] ${read} read failed: ${failureReason(error)}`);
  }, [error, read]);
}

/** An AgencyContentError's code, or the table error's message. */
function failureReason(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return error instanceof Error ? error.message : String(error);
}

function useHomeT(): Translate {
  // The keys read are all home.json's; `Translate` only widens their type.
  return useT("home") as unknown as Translate;
}

function useBundledOnly(): AgencyContent {
  const t = useHomeT();
  return useMemo(() => bundledAgencyContent(t), [t]);
}

function useFromDatabase(): AgencyContent {
  const t = useHomeT();
  const locale = useLocale();
  const bundled = useMemo(() => bundledAgencyContent(t), [t]);
  const host = siteHost(window.location.hostname);
  const { data, error } = useQuery({
    queryKey: agencyContentKeys.site(host),
    queryFn: () => services.agencyContent.siteContent(host),
    enabled: locale === "he",
    staleTime: STALE_TIME,
    retry: false,
  });
  useWarnOnFailure(error, "site");
  return useMemo(
    () =>
      data && locale === "he"
        ? resolveAgencyContent(data, bundled, agentPhotoBase(import.meta.env.VITE_SUPABASE_URL))
        : bundled,
    [data, locale, bundled],
  );
}

/**
 * Chosen once, when the module loads. The flag is a build constant, so a
 * component never switches between the two and the order of its hooks never
 * changes. Off, there is no `useQuery` at all: no request, and no need for a
 * QueryClientProvider, which every existing test rendering a page without one
 * relies on.
 */
export const useAgencyContent: () => AgencyContent = AGENCY_CONTENT ? useFromDatabase : useBundledOnly;

/** One empty list, so a component's memo sees the same value on every render. */
const NO_CASES: SuccessCase[] = [];

function useBundledCasesOnly(): SuccessCase[] {
  const t = useHomeT();
  return useMemo(() => bundledSuccessCases(t), [t]);
}

/**
 * Keyed on the site's agency: agency 1's id while the site itself is still
 * loading. Only agency 1's own site falls back to the bundled cases: they are
 * Dorit's clients' stories, and beside another agency's contact they would be
 * credited to that agency, so its site shows none until its own arrive.
 */
function useCasesFromDatabase(): SuccessCase[] {
  const t = useHomeT();
  const locale = useLocale();
  const { agencyId } = useAgencyContent();
  const bundled = useMemo(() => bundledSuccessCases(t), [t]);
  const { data, error } = useQuery({
    queryKey: agencyContentKeys.cases(agencyId),
    queryFn: () => services.agencyContent.successCases(agencyId),
    enabled: locale === "he",
    staleTime: STALE_TIME,
    retry: false,
  });
  useWarnOnFailure(error, "cases");
  if (data && locale === "he") return data;
  return agencyId === AGENCY1_ID ? bundled : NO_CASES;
}

/** Chosen once, for the same reason as `useAgencyContent`. */
export const useSuccessCases: () => SuccessCase[] = AGENCY_CONTENT ? useCasesFromDatabase : useBundledCasesOnly;

/**
 * The testimonials of the site's agency. With the flag off no agency is named,
 * so the request is exactly the one the site has always sent. Rollout 5 makes
 * the filter unconditional, together with a public read of other agencies'
 * testimonials.
 */
export function useSiteTestimonials(limit = 50) {
  const content = useAgencyContent();
  return useTestimonials(limit, AGENCY_CONTENT ? content.agencyId : undefined);
}
