/**
 * @vitest-environment jsdom
 *
 * Stage 3c of the phone home page: the common questions and the footer lose
 * what repeats something always in view. Below md the intro is one sentence,
 * the closing "לשיחה קצרה עם דורית" is hidden (the sticky bar's first cell is
 * the same link), and the footer drops its quote band and the name and slogan
 * the header already shows. All of it hidden, never removed; the licence line,
 * contact and legal links stay in view. From md up nothing changes.
 *
 * jsdom applies no Tailwind, so "hidden below md" is read off the `max-md:hidden`
 * class; the e2e cases (E2E-MOB-033/034) check what a phone actually shows.
 */
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

// framer-motion's whileInView needs APIs jsdom does not implement.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = new Proxy(
    {},
    { get: (_t, tag: string) => ({ children, ...props }: any) => React.createElement(tag, props, children) }
  );
  return { motion: passthrough, AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children) };
});

// The footer's Image measures itself with ResizeObserver, which jsdom lacks.
vi.mock("@/components/ui/image", async () => {
  const React = await import("react");
  return { Image: ({ src, alt }: { src: string; alt: string }) => React.createElement("img", { src, alt }) };
});

import DetailedFAQ from "@/components/dorit/sections/DetailedFAQ";
import Footer from "@/components/dorit/layout/Footer";

/** A viewport `width` px wide, as far as `matchMedia("(min-width: …)")` is concerned. */
function viewport(width: number) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      return {
        matches: min ? width >= Number(min[1]) : false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      };
    },
  });
}

afterEach(() => {
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

/** Whether `el` or an ancestor is hidden below md by class, or hidden outright. */
const hiddenOnPhone = (el: Element) => Boolean(el.closest(".max-md\\:hidden, .hidden, [hidden]"));

const FIRST = "התשובות לשאלות שלקוחות שואלים אותי לעיתים קרובות — לפני פגישת הראשונה.";
const SECOND = "אם לא מצאתם את התשובה שחיפשתם, נשמח לענות אישית.";

describe("<DetailedFAQ /> — the home page's common questions", () => {
  it("on a phone, the intro is its first sentence; the second is hidden, not dropped", () => {
    viewport(390);
    const { container } = render(<MemoryRouter><DetailedFAQ /></MemoryRouter>);
    const intro = container.querySelector("#common-questions h2 + p")!;
    expect(intro.textContent).toBe(`${FIRST} ${SECOND}`);
    const more = screen.getByText(SECOND);
    expect(more.tagName).toBe("SPAN");
    expect(more.classList.contains("hidden")).toBe(true);
    expect(hiddenOnPhone(screen.getByText(FIRST, { exact: false }))).toBe(false);
  });

  it("on a phone, the closing לשיחה קצרה עם דורית is hidden by CSS but still in the document, still a link to #start", () => {
    viewport(390);
    render(<MemoryRouter><DetailedFAQ /></MemoryRouter>);
    const cta = screen.getByRole("link", { name: "לשיחה קצרה עם דורית" });
    expect(cta.getAttribute("href")).toBe("#start");
    expect(cta.classList.contains("max-md:hidden")).toBe(true);
    // לכל השאלות stays the section's way on.
    expect(hiddenOnPhone(screen.getByRole("link", { name: "לכל השאלות" }))).toBe(false);
  });

  it("from md up, the intro is one text node and the closing link is there", () => {
    viewport(1440);
    const { container } = render(<MemoryRouter><DetailedFAQ /></MemoryRouter>);
    const intro = container.querySelector("#common-questions h2 + p")!;
    // One run: a span boundary re-shapes the glyphs after it, and the desktop must not move.
    expect(intro.childNodes).toHaveLength(1);
    expect(intro.textContent).toBe(`${FIRST} ${SECOND}`);
    expect(screen.getByRole("link", { name: "לשיחה קצרה עם דורית" }).getAttribute("href")).toBe("#start");
  });
});

describe("<Footer /> — below md", () => {
  it("hides the quote band and the name and slogan the header repeats, keeping them in the document", () => {
    viewport(390);
    const { container } = render(<MemoryRouter><Footer /></MemoryRouter>);
    const footer = container.querySelector("footer")!;
    const quote = screen.getByText(/ביטחון אמיתי מתחיל/);
    expect(hiddenOnPhone(quote)).toBe(true);
    expect(hiddenOnPhone(screen.getByText("— דורית גוב ארי"))).toBe(true);
    expect(hiddenOnPhone(screen.getByText("התכנון שלי — השקט שלך"))).toBe(true);
    const name = Array.from(footer.querySelectorAll("p")).find((p) => p.textContent === "דורית גוב ארי")!;
    expect(hiddenOnPhone(name)).toBe(true);
  });

  it("keeps the licence line, the line saying what she does, contact and the legal links in view", () => {
    viewport(390);
    render(<MemoryRouter><Footer /></MemoryRouter>);
    for (const el of [
      screen.getByText(/רישיון סוכן מרשות שוק ההון מספר/),
      screen.getByText("L-00107009"),
      screen.getByText(/שיווק פנסיוני ותכנון פיננסי/),
      screen.getByRole("link", { name: "050-831-1776" }),
      screen.getByRole("link", { name: "WhatsApp" }),
      screen.getByRole("link", { name: "dorit@govari-fin.co.il" }),
      screen.getByRole("link", { name: "מדיניות פרטיות" }),
      screen.getByRole("link", { name: "הצהרת נגישות" }),
      screen.getByText(/כל הזכויות שמורות/),
    ]) {
      expect(hiddenOnPhone(el), el.textContent ?? "").toBe(false);
    }
  });
});
