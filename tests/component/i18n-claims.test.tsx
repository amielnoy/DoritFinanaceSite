// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* /claims and /atzmaim-31-12 in English and French (slice 4). */

vi.mock("@/i18n/locales", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/locales")>();
  return { ...actual, ENABLED_LOCALES: ["he", "en", "fr"] };
});
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, isLoadingAuth: false, logout: vi.fn() }),
}));
const submitClaim = vi.fn(async () => ({ ok: true }));
vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  return { ...actual, services: { ...actual.services, leads: { ...actual.services.leads, submitClaim } } };
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
const { default: Claims } = await import("@/pages/Claims");
const { default: YearEndSelfEmployed } = await import("@/pages/YearEndSelfEmployed");

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {(["en", "fr"] as const).map((l) => (
            <Route key={l} path={`/${l}`} element={<LocaleLayout locale={l} />}>
              <Route path="claims" element={<Claims />} />
              <Route path="atzmaim-31-12" element={<YearEndSelfEmployed />} />
            </Route>
          ))}
          <Route element={<LocaleLayout locale="he" />}>
            <Route path="/claims" element={<Claims />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The page's text and attributes, leaving out what is marked Hebrew on purpose. */
function textOutsideHebrew(): string {
  const copy = document.body.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[lang="he"]').forEach((el) => el.remove());
  const attrs = [...copy.querySelectorAll("[aria-label],[alt],[placeholder],[title]")]
    .map((el) => ["aria-label", "alt", "placeholder", "title"].map((a) => el.getAttribute(a) ?? "").join(" "));
  return `${copy.textContent} ${attrs.join(" ")}`;
}

beforeEach(() => submitClaim.mockClear());
afterEach(() => {
  document.documentElement.lang = "he";
  document.documentElement.dir = "rtl";
});

describe("/claims and the year-end page in English and French", () => {
  it.each([
    ["/en/claims", "Four steps to cover"],
    ["/fr/claims", "Quatre étapes jusqu'à l'indemnisation"],
    ["/en/atzmaim-31-12", "By 31.12 — so you don't give up the tax benefit"],
    ["/fr/atzmaim-31-12", "Avant le 31.12 — pour ne pas renoncer à l'avantage fiscal"],
  ])("renders %s with no Hebrew but the switcher's עברית", (path, heading) => {
    renderAt(path);
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    expect(textOutsideHebrew()).not.toMatch(/[֐-׿]/);
  });

  it("offers the claim types in English, and sends Dorit the Hebrew type and a note", async () => {
    renderAt("/en/claims");
    await userEvent.type(screen.getByLabelText("Full name *"), "Dana");
    await userEvent.type(screen.getByLabelText("Phone *"), "0501234567");
    await userEvent.selectOptions(screen.getByLabelText("Type of event"), "Loss of working capacity");
    await userEvent.type(screen.getByLabelText("Description of the event"), "Off work since Monday");
    await userEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByRole("heading", { name: "Report received" })).toBeInTheDocument();
    expect(submitClaim).toHaveBeenCalledWith(
      expect.objectContaining({ claimType: "אובדן כושר עבודה", description: "Off work since Monday\n(מולא באנגלית)" }),
    );
  });

  it("sends a Hebrew report exactly as typed", async () => {
    renderAt("/claims");
    await userEvent.type(screen.getByLabelText("שם מלא *"), "דנה");
    await userEvent.type(screen.getByLabelText("טלפון *"), "0501234567");
    await userEvent.type(screen.getByLabelText("תיאור האירוע"), "נעדרת מהעבודה ");
    await userEvent.click(screen.getByRole("button", { name: "שליחת דיווח" }));
    await screen.findByRole("heading", { name: "הדיווח התקבל" });
    expect(submitClaim).toHaveBeenCalledWith(expect.objectContaining({ description: "נעדרת מהעבודה " }));
  });

  it("keeps the year-end figures exact, and marks the Hebrew-only guide", () => {
    renderAt("/en/atzmaim-31-12");
    expect(screen.getByText(/about 16\.5% of qualifying income — up to about ₪38,400 in 2026/)).toBeInTheDocument();
    expect(screen.getByText(/up to ₪13,203 a year; up to ₪20,566 a year/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "The full guide: what to deposit by 31 December (in Hebrew)" })).toHaveAttribute(
      "href",
      "/blog/sof-shana-atzmaim",
    );
    expect(screen.getByText(/pension marketing, not objective pension advice/)).toBeInTheDocument();
  });
});
