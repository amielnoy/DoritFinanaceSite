// @vitest-environment jsdom
/*
 * useAgencyContent and friends (task 4 of the agency-content step): with
 * VITE_AGENCY_CONTENT off they are the bundled agency-1 constants and ask
 * nothing; on, they read the database and fall back to the constants while
 * loading, on any error and in any locale but Hebrew (R1).
 *
 * The flag is a build constant the hook module reads once, so each case loads
 * a fresh copy of the module graph with the flag mocked its own way. Locale and
 * React Query come from that same fresh graph, or the hook would read a
 * different context than the provider sets.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import he from "../../src/i18n/locales/he/home.json";
import en from "../../src/i18n/locales/en/home.json";
import { AGENCY1_ID } from "@/config/agency1";
import { bundledAgencyContent, bundledSuccessCases } from "@/lib/agency-content";
import type { AgencySiteRecord, SuccessCase } from "@/services/ports";
import { resetServicesMock, servicesMock, servicesModule } from "./services-mock";

const heT = (k: string): string => (he as Record<string, string>)[k];
const never = <T,>() => new Promise<T>(() => {});

const RECORD: AgencySiteRecord = {
  agencyId: AGENCY1_ID,
  contact: {
    phoneE164: "+972500000000",
    phoneDisplay: "050-000-0000",
    whatsapp: "972500000000",
    email: "dorit@example.test",
    defaultWhatsappMessage: "שלום",
  },
  agent: {
    fullName: "דורית גוב ארי",
    professionalTitle: "מתכננת פיננסית וסוכנת ביטוח",
    photoPath: null,
    photoAlt: null,
    licenceNumber: "L-00107009",
    bio: { headline: "כותרת מהמאגר" },
    stats: [],
    bookingUrl: null,
    reviewLinks: {},
  },
};

async function load(flag: boolean) {
  vi.resetModules();
  vi.doMock("@/config/agency-content", () => ({ AGENCY_CONTENT: flag, isAgencyContentOn: () => flag }));
  vi.doMock("@/services", (importOriginal) => servicesModule(importOriginal));
  const hooks = await import("@/hooks/useAgencyContent");
  const { LocaleProvider } = await import("@/i18n/LocaleContext");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const wrapper =
    ({ locale = "he", query = true }: { locale?: "he" | "en"; query?: boolean } = {}) =>
    ({ children }: { children: ReactNode }) => {
      const inner = <LocaleProvider locale={locale}>{children}</LocaleProvider>;
      if (!query) return inner;
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      return <QueryClientProvider client={client}>{inner}</QueryClientProvider>;
    };
  return { ...hooks, wrapper };
}

/** Let a rejected or resolved query settle into the hook's next render. */
const settle = () => act(async () => {});

beforeEach(() => resetServicesMock());
afterEach(() => {
  vi.doUnmock("@/config/agency-content");
  vi.doUnmock("@/services");
});

describe("useAgencyContent", () => {
  it("CMP-AGC-001: flag off — the bundled constants, no request, and no QueryClientProvider needed", async () => {
    const { useAgencyContent, wrapper } = await load(false);
    const { result } = renderHook(() => useAgencyContent(), { wrapper: wrapper({ query: false }) });
    await settle();
    expect(result.current).toEqual(bundledAgencyContent(heT));
    expect(servicesMock.agencyContent.siteContent).not.toHaveBeenCalled();
  });

  it("CMP-AGC-002: flag on, still loading — the bundled constants", async () => {
    servicesMock.agencyContent.siteContent.mockReturnValue(never());
    const { useAgencyContent, wrapper } = await load(true);
    const { result } = renderHook(() => useAgencyContent(), { wrapper: wrapper() });
    await waitFor(() => expect(servicesMock.agencyContent.siteContent).toHaveBeenCalled());
    expect(result.current).toEqual(bundledAgencyContent(heT));
  });

  it("CMP-AGC-003: flag on, the read fails — the bundled constants", async () => {
    const { useAgencyContent, wrapper } = await load(true);
    const { result } = renderHook(() => useAgencyContent(), { wrapper: wrapper() });
    await waitFor(() => expect(servicesMock.agencyContent.siteContent).toHaveBeenCalledTimes(1));
    await settle();
    expect(result.current.source).toBe("bundled");
    expect(result.current).toEqual(bundledAgencyContent(heT));
    expect(servicesMock.agencyContent.siteContent).toHaveBeenCalledTimes(1);
  });

  it("CMP-AGC-004: flag on, the read answers — the database's content", async () => {
    servicesMock.agencyContent.siteContent.mockResolvedValue(RECORD);
    const { useAgencyContent, wrapper } = await load(true);
    const { result } = renderHook(() => useAgencyContent(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.source).toBe("database"));
    expect(result.current.contact.phoneDisplay).toBe("050-000-0000");
    expect(result.current.agent.bio.headline).toBe("כותרת מהמאגר");
  });

  it("CMP-AGC-005: flag on, on localhost — asks for the host as the browser has it", async () => {
    servicesMock.agencyContent.siteContent.mockReturnValue(never());
    const { useAgencyContent, wrapper } = await load(true);
    renderHook(() => useAgencyContent(), { wrapper: wrapper() });
    await waitFor(() => expect(servicesMock.agencyContent.siteContent).toHaveBeenCalledWith("localhost"));
  });

  it("CMP-AGC-006: flag on, an English page — bundled English, and nothing is asked", async () => {
    servicesMock.agencyContent.siteContent.mockResolvedValue(RECORD);
    const { useAgencyContent, wrapper } = await load(true);
    const { result } = renderHook(() => useAgencyContent(), { wrapper: wrapper({ locale: "en" }) });
    await settle();
    expect(result.current.source).toBe("bundled");
    expect(result.current.agent.byline).toBe(en["hero.byline"]);
    expect(servicesMock.agencyContent.siteContent).not.toHaveBeenCalled();
  });

  // The page looks the same whether the read failed or never ran, so the
  // console is the one place a failure shows — the preview check before the
  // flag goes on in production looks for it.
  it("CMP-AGC-009: flag on, the read fails — one console warning naming the code; a read that answers, none", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const failed = await load(true);
      const { rerender } = renderHook(() => [failed.useAgencyContent(), failed.useAgencyContent()], {
        wrapper: failed.wrapper(),
      });
      await waitFor(() => expect(servicesMock.agencyContent.siteContent).toHaveBeenCalled());
      await settle();
      rerender();
      await settle();
      expect(warn.mock.calls).toEqual([["[agency-content] site read failed: no_site"]]);

      warn.mockClear();
      servicesMock.agencyContent.siteContent.mockResolvedValue(RECORD);
      const answered = await load(true);
      const { result } = renderHook(() => answered.useAgencyContent(), { wrapper: answered.wrapper() });
      await waitFor(() => expect(result.current.source).toBe("database"));
      await settle();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("useSuccessCases", () => {
  const CASES: SuccessCase[] = [{ tag: null, title: "מקרה", body: "גוף", metric: null, estimate: false }];

  it("CMP-AGC-007a: flag off — the bundled cases, nothing asked", async () => {
    const { useSuccessCases, wrapper } = await load(false);
    const { result } = renderHook(() => useSuccessCases(), { wrapper: wrapper({ query: false }) });
    await settle();
    expect(result.current).toEqual(bundledSuccessCases(heT));
    expect(servicesMock.agencyContent.successCases).not.toHaveBeenCalled();
  });

  it("CMP-AGC-007b: flag on — agency 1's cases asked while the site loads, then the database's", async () => {
    servicesMock.agencyContent.siteContent.mockReturnValue(never());
    servicesMock.agencyContent.successCases.mockResolvedValue(CASES);
    const { useSuccessCases, wrapper } = await load(true);
    const { result } = renderHook(() => useSuccessCases(), { wrapper: wrapper() });
    expect(result.current).toEqual(bundledSuccessCases(heT));
    await waitFor(() => expect(result.current).toEqual(CASES));
    expect(servicesMock.agencyContent.successCases).toHaveBeenCalledWith(AGENCY1_ID);
  });

  // Dorit's client stories beside another agency's contact would be credited
  // to that agency, so only agency 1's site falls back to them.
  const AGENCY_F = "ffffffff-0000-0000-0000-00000000000f";

  it("CMP-AGC-007c: flag on, another agency whose cases are still loading — none, not Dorit's", async () => {
    servicesMock.agencyContent.siteContent.mockResolvedValue({ ...RECORD, agencyId: AGENCY_F });
    servicesMock.agencyContent.successCases.mockReturnValue(never());
    const { useSuccessCases, wrapper } = await load(true);
    const { result } = renderHook(() => useSuccessCases(), { wrapper: wrapper() });
    await waitFor(() => expect(servicesMock.agencyContent.successCases).toHaveBeenCalledWith(AGENCY_F));
    await settle();
    expect(result.current).toEqual([]);
  });

  it("CMP-AGC-007d: flag on, another agency whose cases fail — none, not Dorit's", async () => {
    servicesMock.agencyContent.siteContent.mockResolvedValue({ ...RECORD, agencyId: AGENCY_F });
    const { useSuccessCases, wrapper } = await load(true);
    const { result } = renderHook(() => useSuccessCases(), { wrapper: wrapper() });
    await waitFor(() => expect(servicesMock.agencyContent.successCases).toHaveBeenCalledWith(AGENCY_F));
    await settle();
    expect(result.current).toEqual([]);
  });

  it("CMP-AGC-007e: flag on, agency 1 whose cases fail — the bundled cases", async () => {
    servicesMock.agencyContent.siteContent.mockResolvedValue(RECORD);
    const { useAgencyContent, useSuccessCases, wrapper } = await load(true);
    const { result } = renderHook(() => ({ site: useAgencyContent(), cases: useSuccessCases() }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.site.source).toBe("database"));
    await waitFor(() => expect(servicesMock.agencyContent.successCases).toHaveBeenCalledWith(AGENCY1_ID));
    await settle();
    expect(result.current.cases).toEqual(bundledSuccessCases(heT));
  });

  it("CMP-AGC-009b: flag on, the cases read fails — one console warning naming the error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      servicesMock.agencyContent.siteContent.mockResolvedValue(RECORD);
      servicesMock.agencyContent.successCases.mockRejectedValue(new Error("success_cases read failed: boom"));
      const { useAgencyContent, useSuccessCases, wrapper } = await load(true);
      const { result } = renderHook(() => ({ site: useAgencyContent(), cases: useSuccessCases() }), {
        wrapper: wrapper(),
      });
      await waitFor(() => expect(result.current.site.source).toBe("database"));
      await waitFor(() => expect(servicesMock.agencyContent.successCases).toHaveBeenCalledWith(AGENCY1_ID));
      await settle();
      expect(warn.mock.calls).toEqual([["[agency-content] cases read failed: success_cases read failed: boom"]]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("useSiteTestimonials", () => {
  it("CMP-AGC-008: flag off asks exactly today's question; on, it names the agency", async () => {
    const off = await load(false);
    renderHook(() => off.useSiteTestimonials(), { wrapper: off.wrapper() });
    await waitFor(() => expect(servicesMock.content.listTestimonials).toHaveBeenCalled());
    expect(servicesMock.content.listTestimonials.mock.calls[0]).toEqual([50]);

    servicesMock.content.listTestimonials.mockClear();
    servicesMock.agencyContent.siteContent.mockReturnValue(never());
    const on = await load(true);
    renderHook(() => on.useSiteTestimonials(), { wrapper: on.wrapper() });
    await waitFor(() => expect(servicesMock.content.listTestimonials).toHaveBeenCalled());
    expect(servicesMock.content.listTestimonials.mock.calls[0]).toEqual([50, AGENCY1_ID]);
  });
});
