// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { base44Mock } from "./base44-mock";

/*
 * The not-found page and the skip link, through LocaleLayout as App.jsx routes
 * them. Both from the manual test of 2026-10-14: the 404 was Base44's English
 * template with no `<main>` and a grey heading under the contrast floor
 * (D-04, D-07, D-08), and no page had a skip link (D-08).
 */

if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock("@/api/base44Client", () => ({ base44: base44Mock }));
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));
vi.mock("@/i18n/locales", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/locales")>();
  return { ...actual, ENABLED_LOCALES: ["he", "en", "fr"] };
});
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, isLoadingAuth: false, logout: vi.fn() }),
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = new Proxy({}, { get: (_t, tag: string) => ({ children, ...props }: any) => React.createElement(tag, props, children) });
  return { motion: passthrough, AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children) };
});

const { default: LocaleLayout } = await import("@/i18n/LocaleLayout");
const { default: NotFound } = await import("@/pages/NotFound");

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {(["en", "fr"] as const).map((l) => (
            <Route key={l} path={`/${l}`} element={<LocaleLayout locale={l} />}>
              <Route path="*" element={<NotFound />} />
            </Route>
          ))}
          <Route element={<LocaleLayout locale="he" />}>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("the not-found page", () => {
  it("is in Hebrew, inside one <main>, with the h1 inside it", () => {
    renderAt("/nope-xyz");
    const mains = document.querySelectorAll("main");
    expect(mains.length).toBe(1);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("הדף שחיפשתם לא נמצא");
    expect(mains[0].contains(h1)).toBe(true);
    expect(document.body.textContent).not.toMatch(/Page Not Found|Go Home/);
  });

  it("keeps the site's header and footer, so the way back is the usual one", () => {
    renderAt("/nope-xyz");
    expect(document.querySelector("header")).toBeTruthy();
    expect(document.querySelector("footer")).toBeTruthy();
  });

  it("links home and to the main pages", () => {
    renderAt("/nope-xyz");
    expect(screen.getByRole("link", { name: "לעמוד הראשי" }).getAttribute("href")).toBe("/");
    const nav = screen.getByRole("navigation", { name: "דפים באתר" });
    const hrefs = within(nav).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/tools", "/claims", "/blog", "/faq"]);
  });

  it("uses no grey that fails contrast: the heading and text are ink", () => {
    renderAt("/nope-xyz");
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.className).toContain("text-foreground");
    expect(document.querySelector("main")!.innerHTML).not.toMatch(/text-slate-/);
  });

  it("is noindex, and its canonical is the address asked for", () => {
    renderAt("/nope-xyz");
    expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toMatch(/noindex/);
    expect(document.title).toBe("הדף לא נמצא | דורית גוב ארי");
    expect(new URL(document.querySelector('link[rel="canonical"]')!.getAttribute("href")!).pathname).toBe("/nope-xyz");
  });

  it("speaks English under /en, links stay in English, and the Hebrew-only blog is left out", () => {
    renderAt("/en/nope");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("We couldn't find that page");
    expect(screen.getByRole("link", { name: "To the home page" }).getAttribute("href")).toBe("/en");
    const nav = screen.getByRole("navigation", { name: "Pages on the site" });
    expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/en/tools", "/en/claims", "/en/faq"]);
    expect(new URL(document.querySelector('link[rel="canonical"]')!.getAttribute("href")!).pathname).toBe("/en/nope");
  });
});

describe("the skip link", () => {
  it("is the first focusable thing on the page", () => {
    renderAt("/nope-xyz");
    const first = document.querySelector<HTMLElement>("a[href], button, input, select, textarea, [tabindex]");
    expect(first?.textContent).toBe("דילוג לתוכן הראשי");
  });

  it("moves focus to the page's <main>", () => {
    renderAt("/nope-xyz");
    fireEvent.click(screen.getByRole("link", { name: "דילוג לתוכן הראשי" }));
    const main = document.querySelector("main")!;
    expect(document.activeElement).toBe(main);
    expect(main.getAttribute("tabindex")).toBe("-1");
  });

  it("names a target that exists, so it works before the app runs", () => {
    renderAt("/nope-xyz");
    expect(screen.getByRole("link", { name: "דילוג לתוכן הראשי" }).getAttribute("href")).toBe("#main");
    expect(document.getElementById("main")?.tagName).toBe("MAIN");
  });

  it("is in the page's language", () => {
    renderAt("/fr/nope");
    expect(screen.getByRole("link", { name: "Aller au contenu principal" })).toBeTruthy();
  });
});
