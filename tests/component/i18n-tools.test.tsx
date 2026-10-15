// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* /tools in English and French (slice 5). */

vi.mock("@/i18n/locales", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/locales")>();
  return { ...actual, ENABLED_LOCALES: ["he", "en", "fr"] };
});
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, isLoadingAuth: false, logout: vi.fn() }),
}));
// The procedures chat, as a marker: it answers in Hebrew, so only the Hebrew page has it.
vi.mock("@/components/dorit/chat/AgentChat", async () => {
  const React = await import("react");
  return { default: () => React.createElement("div", { "data-testid": "agent-chat" }) };
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
const { default: Tools } = await import("@/pages/Tools");

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {(["en", "fr"] as const).map((l) => (
            <Route key={l} path={`/${l}`} element={<LocaleLayout locale={l} />}>
              <Route path="tools" element={<Tools />} />
            </Route>
          ))}
          <Route element={<LocaleLayout locale="he" />}>
            <Route path="/tools" element={<Tools />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function textOutsideHebrew(): string {
  const copy = document.body.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[lang="he"]').forEach((el) => el.remove());
  const attrs = [...copy.querySelectorAll("[aria-label],[alt],[placeholder],[title]")]
    .map((el) => ["aria-label", "alt", "placeholder", "title"].map((a) => el.getAttribute(a) ?? "").join(" "));
  return `${copy.textContent} ${attrs.join(" ")}`;
}

afterEach(() => {
  document.documentElement.lang = "he";
  document.documentElement.dir = "rtl";
});

describe("/tools in English and French", () => {
  it.each([
    ["/en/tools", "Self-check tools"],
    ["/fr/tools", "Outils d'auto-évaluation"],
  ])("renders %s with no Hebrew but the switcher's עברית, and without the Hebrew-only chat", (path, h1) => {
    renderAt(path);
    expect(screen.getByRole("heading", { level: 1, name: h1 })).toBeInTheDocument();
    expect(textOutsideHebrew()).not.toMatch(/[֐-׿]/);
    expect(screen.queryByTestId("agent-chat")).toBeNull();
  });

  it("runs the insurance self-check in English, and offers an English WhatsApp message", async () => {
    renderAt("/en/tools");
    const quiz = within(document.getElementById("assessment")!);
    for (const answer of ["A parent", "Self-employed", "Yes", "Yes"]) await userEvent.click(quiz.getByRole("button", { name: answer }));
    expect(quiz.getByRole("heading", { name: "6 kinds of insurance relevant to you" })).toBeInTheDocument();
    expect(quiz.getByRole("heading", { name: "Loss-of-working-capacity insurance" })).toBeInTheDocument();
    expect(textOutsideHebrew()).not.toMatch(/[֐-׿]/);
    const href = quiz.getByRole("link", { name: /Send Dorit the result on WhatsApp/ }).getAttribute("href")!;
    expect(decodeURIComponent(href.split("?text=")[1])).toMatch(/^Hello Dorit, I did the self-check/);
  });

  it("shows the fee calculator's amounts in shekels the English way", () => {
    renderAt("/en/tools");
    const calc = within(document.getElementById("fee-calculator")!);
    expect(calc.getByText("₪600,000")).toBeInTheDocument();
  });

  it("keeps the Hebrew page's chat, quiz and amounts", async () => {
    renderAt("/tools");
    expect(screen.getByTestId("agent-chat")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "איזה ביטוח באמת מתאים לך?" })).toBeInTheDocument();
    expect(within(document.getElementById("fee-calculator")!).getByText(/600,000/)).toHaveTextContent("‏600,000 ‏₪");
  });
});
