// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
 * English and French (/en, /fr): the shell and /pension-check rendered in
 * each language through LocaleLayout, as App.jsx routes them, with the
 * languages switched on.
 */

vi.mock("@/i18n/locales", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/locales")>();
  return { ...actual, ENABLED_LOCALES: ["he", "en", "fr"] };
});
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, isLoadingAuth: false, logout: vi.fn() }),
}));
const submitInterview = vi.fn(async () => ({ ok: true, rid: "r1" }));
vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  return { ...actual, services: { ...actual.services, leads: { ...actual.services.leads, submitInterview } } };
});
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = new Proxy({}, { get: (_t, tag: string) => ({ children, ...props }: any) => React.createElement(tag, props, children) });
  return { motion: passthrough, AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children) };
});
vi.mock("@/components/ui/image", async () => {
  const React = await import("react");
  return { Image: ({ src, alt }: { src: string; alt: string }) => React.createElement("img", { src, alt }) };
});

const { default: LocaleLayout } = await import("@/i18n/LocaleLayout");
const { default: PensionCheck } = await import("@/pages/PensionCheck");

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {(["en", "fr"] as const).map((l) => (
            <Route key={l} path={`/${l}`} element={<LocaleLayout locale={l} />}>
              <Route path="pension-check" element={<PensionCheck />} />
            </Route>
          ))}
          <Route element={<LocaleLayout locale="he" />}>
            <Route path="/pension-check" element={<PensionCheck />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => submitInterview.mockClear());
afterEach(() => {
  document.documentElement.lang = "he";
  document.documentElement.dir = "rtl";
});

describe("the public pages in English and French", () => {
  it("renders /en/pension-check in English, left to right", () => {
    renderAt("/en/pension-check");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(screen.getByRole("heading", { level: 1, name: "Pension portfolio check" })).toBeInTheDocument();
    expect(screen.getByText(/pension marketing, not objective pension advice/)).toBeInTheDocument();
  });

  it("renders /fr/pension-check in French", () => {
    renderAt("/fr/pension-check");
    expect(document.documentElement.lang).toBe("fr");
    expect(screen.getByRole("heading", { level: 1, name: "Bilan de votre épargne retraite" })).toBeInTheDocument();
  });

  it("keeps the Hebrew page Hebrew and right to left", () => {
    renderAt("/pension-check");
    expect(document.documentElement.dir).toBe("rtl");
    expect(screen.getByRole("heading", { level: 1, name: "בדיקת תיק פנסיוני" })).toBeInTheDocument();
  });

  it("keeps the visitor in their language: prefixed links, and no Hebrew-only pages in the menu", () => {
    renderAt("/en/pension-check");
    const header = within(screen.getByRole("banner"));
    expect(header.getAllByRole("link", { name: "Tools" })[0]).toHaveAttribute("href", "/en/tools");
    expect(header.getAllByRole("link", { name: "A short call with Dorit" })[0]).toHaveAttribute("href", "/en/#start");
    expect(header.queryByRole("link", { name: "Blog" })).toBeNull();
    expect(header.queryByRole("link", { name: "Perspective" })).toBeNull();
    const footer = within(screen.getByRole("contentinfo"));
    expect(footer.getByRole("link", { name: /Privacy policy \(in Hebrew\)/ })).toHaveAttribute("href", "/privacy");
  });

  it("offers the same page in the other languages", () => {
    renderAt("/en/pension-check");
    const switcher = within(screen.getAllByRole("navigation", { name: "Language" })[0]);
    expect(switcher.getByRole("link", { name: "עברית" })).toHaveAttribute("href", "/pension-check");
    expect(switcher.getByRole("link", { name: "Français" })).toHaveAttribute("href", "/fr/pension-check");
    expect(switcher.getByText("English")).toHaveAttribute("aria-current", "true");
  });

  it("asks in English, but sends Dorit the Hebrew summary, noting the language", async () => {
    renderAt("/en/pension-check");
    await userEvent.click(screen.getByRole("button", { name: "Check my pension portfolio" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please enter your name.");
    await userEvent.type(screen.getByLabelText("Name *"), "Dana");
    await userEvent.type(screen.getByLabelText("Mobile phone *"), "0501234567");
    await userEvent.click(screen.getByRole("button", { name: "Check my pension portfolio" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Dorit will get back to you");
    expect(submitInterview).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingTopic: "בדיקת תיק פנסיוני",
        summary: "בדיקת תיק פנסיוני — בקשה מהאתר (עמוד בדיקת תיק פנסיוני · מולא באנגלית).",
        profile: { clearinghouse: "מעוניין/ת" },
      }),
    );
  });
});
