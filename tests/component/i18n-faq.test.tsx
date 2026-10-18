// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resetServicesMock } from "./services-mock";

/* /faq in English and French (slice 3), and the home page's FAQ block back on /en. */

vi.mock("@/services", async (importOriginal) => (await import("./services-mock")).servicesModule(importOriginal));
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
// The support chat, as a marker: it answers in Hebrew, so only the Hebrew page has it.
vi.mock("@/components/dorit/chat/AgentChat", async () => {
  const React = await import("react");
  return { default: () => React.createElement("div", { "data-testid": "agent-chat" }) };
});
vi.mock("@/components/ui/image", async () => {
  const React = await import("react");
  return { Image: ({ src, alt }: { src: string; alt: string }) => React.createElement("img", { src, alt }) };
});

const { default: LocaleLayout } = await import("@/i18n/LocaleLayout");
const { default: FAQPage } = await import("@/pages/FAQPage");
const { default: Home } = await import("@/pages/Home");

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {(["en", "fr"] as const).map((l) => (
            <Route key={l} path={`/${l}`} element={<LocaleLayout locale={l} />}>
              <Route index element={<Home />} />
              <Route path="faq" element={<FAQPage />} />
            </Route>
          ))}
          <Route element={<LocaleLayout locale="he" />}>
            <Route path="/faq" element={<FAQPage />} />
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

const faqLd = () =>
  [...document.head.querySelectorAll('script[type="application/ld+json"]')]
    .map((s) => JSON.parse(s.textContent ?? "{}"))
    .find((d) => d["@type"] === "FAQPage");

beforeEach(() => {
  resetServicesMock();
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

describe("/faq in English and French", () => {
  it.each([
    ["/en/faq", "Income tax", "How does good tax planning save on pension savings?"],
    ["/fr/faq", "Impôt sur le revenu", "Comment une bonne planification fiscale fait-elle économiser sur l'épargne retraite ?"],
  ])("renders %s with no Hebrew but the switcher's עברית", (path, category, question) => {
    renderAt(path);
    expect(screen.getByRole("heading", { level: 2, name: category })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: question })).toBeInTheDocument();
    expect(textOutsideHebrew()).not.toMatch(/[֐-׿]/);
  });

  it("opens an answer, and moves between topics", async () => {
    renderAt("/en/faq");
    const general = screen.getByRole("button", { name: "General" });
    await userEvent.click(general);
    expect(general).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Does the first introductory meeting cost anything?" }));
    expect(screen.getByText(/free of charge and without obligation/)).toBeVisible();
  });

  it("declares its questions in English to search engines, and no Hebrew-only chat", () => {
    renderAt("/en/faq");
    const ld = faqLd();
    expect(ld.mainEntity).toHaveLength(24);
    expect(ld.mainEntity[0].name).toBe("How does good tax planning save on pension savings?");
    expect(JSON.stringify(ld)).not.toMatch(/[֐-׿]/);
    expect(screen.queryByTestId("agent-chat")).toBeNull();
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href")).toMatch(/\/en\/faq$/);
  });

  it("keeps the Hebrew page Hebrew, its English subtitles and its JSON-LD", () => {
    renderAt("/faq");
    expect(screen.getByText("Income Tax · 6 שאלות")).toBeInTheDocument();
    expect(screen.getByTestId("agent-chat")).toBeInTheDocument();
    expect(faqLd().mainEntity[0].name).toBe("כיצד תכנון מס נכון חוסך בחיסכון הפנסיוני?");
  });

  it("brings the common questions back to the English home page, linking to /en/faq", () => {
    const { container } = renderAt("/en");
    const block = within(container.querySelector("#common-questions") as HTMLElement);
    expect(block.getByRole("heading", { name: "Common questions" })).toBeInTheDocument();
    expect(block.getByRole("button", { name: "Does the first introductory meeting cost anything?" })).toBeInTheDocument();
    expect(block.getByRole("link", { name: "All the questions" })).toHaveAttribute("href", "/en/faq");
  });
});
