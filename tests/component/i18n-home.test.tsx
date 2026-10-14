// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { base44Mock, resetBase44Mock } from "./base44-mock";

/*
 * The home page in English and French (slice 2): every section through
 * LocaleLayout as App.jsx routes /en and /fr, with the languages switched on.
 * The Hebrew page's text is held unchanged by a rendered-text comparison in
 * the PR; here, that /en and /fr carry no Hebrew but what is meant to stay.
 */

vi.mock("@/api/base44Client", () => ({ base44: base44Mock }));
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));
vi.mock("@/i18n/locales", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/locales")>();
  return { ...actual, ENABLED_LOCALES: ["he", "en", "fr"] };
});
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, isLoadingAuth: false, logout: vi.fn() }),
}));
const submitLead = vi.fn(async () => ({ ok: true }));
vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  return { ...actual, services: { ...actual.services, leads: { ...actual.services.leads, submitLead } } };
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
const { default: Home } = await import("@/pages/Home");

const HEBREW = /[֐-׿]/;

/** The page's text, leaving out what is marked Hebrew on purpose (`lang="he"`). */
function textOutsideHebrew(): string {
  const copy = document.body.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[lang="he"]').forEach((el) => el.remove());
  const attrs = [...copy.querySelectorAll("[aria-label],[alt],[placeholder],[title]")]
    .map((el) => ["aria-label", "alt", "placeholder", "title"].map((a) => el.getAttribute(a) ?? "").join(" "));
  return `${copy.textContent} ${attrs.join(" ")}`;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {(["en", "fr"] as const).map((l) => (
            <Route key={l} path={`/${l}`} element={<LocaleLayout locale={l} />}>
              <Route index element={<Home />} />
            </Route>
          ))}
          <Route element={<LocaleLayout locale="he" />}>
            <Route path="/" element={<Home />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const scrollBy = vi.fn();
beforeEach(() => {
  resetBase44Mock();
  submitLead.mockClear();
  scrollBy.mockClear();
  Element.prototype.scrollBy = scrollBy as unknown as Element["scrollBy"];
  base44Mock.entities.Testimonial.list.mockResolvedValue([
    { id: "t1", name: "רונית", quote: "ליווי מקצועי ואישי", rating: 5, source: "google" },
  ]);
  // A desktop viewport, as far as matchMedia("(min-width: …)") is concerned.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: /min-width/.test(query),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});
afterEach(() => {
  document.documentElement.lang = "he";
  document.documentElement.dir = "rtl";
});

describe("the home page in English and French", () => {
  it.each([
    ["/en", "Pension and insurance planning, without the small print"],
    ["/fr", "La retraite et l'assurance, sans les petits caractères"],
  ])("renders %s with no Hebrew but the testimonials and the switcher's עברית", async (path, h1) => {
    renderAt(path);
    expect(screen.getByRole("heading", { level: 1, name: h1 })).toBeInTheDocument();
    await screen.findByText("ליווי מקצועי ואישי", {}, { timeout: 5000 });
    expect(textOutsideHebrew()).not.toMatch(HEBREW);
  });

  it("leads with the short form: no questionnaire and no chat", async () => {
    const { container } = renderAt("/en");
    expect(screen.getByLabelText("Full name *")).toBeInTheDocument();
    expect(container.querySelector("#interview")).toBeNull();
    expect(screen.getByRole("link", { name: "Pension portfolio check" })).toHaveAttribute("href", "/en/pension-check");
    await screen.findByText("ליווי מקצועי ואישי", {}, { timeout: 5000 });
  });

  it("keeps the questionnaire and the FAQ block on the Hebrew page", async () => {
    const { container } = renderAt("/");
    expect(container.querySelector("#interview")).not.toBeNull();
    expect(container.querySelector("#common-questions")).not.toBeNull();
    expect(screen.queryByText("Testimonials are shown in the original Hebrew.")).toBeNull();
    await screen.findByText("ליווי מקצועי ואישי", {}, { timeout: 5000 });
  });

  it("sends the visitor's message as written, with a Hebrew note for Dorit", async () => {
    renderAt("/en");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please enter your name and phone.");
    await userEvent.type(screen.getByLabelText("Full name *"), "Dana");
    await userEvent.type(screen.getByLabelText("Phone *"), "0501234567");
    await userEvent.type(screen.getByLabelText("Message (optional)"), "About my pension");
    await userEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Message sent. Thank you.")).toBeInTheDocument();
    expect(submitLead).toHaveBeenCalledWith(expect.objectContaining({ message: "About my pension\n(מולא באנגלית)" }));
  });

  it("shows the testimonials in their own Hebrew, marked so", async () => {
    renderAt("/fr");
    const quote = await screen.findByText("ליווי מקצועי ואישי", {}, { timeout: 5000 });
    const card = quote.closest("article")!;
    expect(card).toHaveAttribute("lang", "he");
    expect(card).toHaveAttribute("dir", "rtl");
    expect(screen.getByText("Les témoignages sont présentés dans leur version originale, en hébreu.")).toBeInTheDocument();
  });

  it("turns the cases' arrows with the page: back is to the left in English, to the right in Hebrew", async () => {
    renderAt("/en");
    const proof = within(document.getElementById("proof")!);
    await userEvent.click(proof.getByRole("button", { name: "Previous" }));
    expect((scrollBy.mock.calls.at(-1)![0] as ScrollToOptions).left).toBeLessThan(0);
    await screen.findByText("ליווי מקצועי ואישי", {}, { timeout: 5000 });
  });

  it("keeps the Hebrew page's arrows as they were", async () => {
    renderAt("/");
    const proof = within(document.getElementById("proof")!);
    await userEvent.click(proof.getByRole("button", { name: "הקודם" }));
    expect((scrollBy.mock.calls.at(-1)![0] as ScrollToOptions).left).toBeGreaterThan(0);
    await waitFor(() => expect(base44Mock.entities.Testimonial.list).toHaveBeenCalled());
  });
});
