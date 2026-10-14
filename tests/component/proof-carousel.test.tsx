/**
 * @vitest-environment jsdom
 *
 * The home page's cases (#proof). From md up, seven open cards in a strip. Below
 * md (stage 3b), the same strip with each case's story folded behind
 * "פרטי המקרה" — hidden, never removed — and the disclaimer still in view.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
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

import ProofCarousel from "@/components/dorit/sections/ProofCarousel";

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

const DISCLAIMER = /תוצאות עבר אינן מבטיחות תוצאות דומות — כל מקרה תלוי בנתונים\s+האישיים\./;
const STORY = /ניהלתי את ההליך מול החברה/;

describe("<ProofCarousel />", () => {
  it("on a phone, folds every story behind its own פרטי המקרה, keeping it in the document", () => {
    viewport(390);
    const { container } = render(<ProofCarousel />);
    const toggles = screen.getAllByRole("button", { name: "פרטי המקרה" });
    expect(toggles).toHaveLength(7);
    for (const t of toggles) expect(t.getAttribute("aria-expanded")).toBe("false");
    const story = screen.getByText(STORY);
    expect(story.hidden).toBe(true);
    expect(toggles[0].getAttribute("aria-controls")).toBe(story.id);
    // Every story is still there, folded.
    expect(container.querySelectorAll("#proof article p[hidden]")).toHaveLength(7);
  });

  it("on a phone, keeps the headline, the figure, its basis and the disclaimer on show", () => {
    viewport(390);
    render(<ProofCarousel />);
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "מ-דחייה לאישור מלא תוך 11 ימים" })).toBeTruthy();
    expect(screen.getByText("₪850K שולמו")).toBeTruthy();
    // The figure never loses the basis it rests on.
    expect(screen.getAllByText("הערכה המבוססת על הנחות של תשואה ודמי ניהול")).toHaveLength(2);
    for (const basis of screen.getAllByText("הערכה המבוססת על הנחות של תשואה ודמי ניהול")) {
      expect(basis.closest("[hidden]")).toBeNull();
    }
  });

  it("on a phone, פרטי המקרה unfolds its own story in place and folds it again", () => {
    viewport(390);
    render(<ProofCarousel />);
    const [first, second] = screen.getAllByRole("button", { name: "פרטי המקרה" });
    fireEvent.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(STORY).hidden).toBe(false);
    // The others stay as they were.
    expect(second.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(first);
    expect(screen.getByText(STORY).hidden).toBe(true);
  });

  it("names the arrows by where they go in RTL: → back to the first case, ← on to the next", () => {
    render(<ProofCarousel />);
    const strip = screen.getByRole("region", { name: "תיקי הצלחה — גלילה אופקית" });
    const scrollBy = vi.fn();
    (strip as unknown as { scrollBy: typeof scrollBy }).scrollBy = scrollBy;
    fireEvent.click(screen.getByRole("button", { name: "הבא" }));
    fireEvent.click(screen.getByRole("button", { name: "הקודם" }));
    // RTL scrolls negative: on is a negative step, back a positive one.
    expect(scrollBy.mock.calls[0][0].left).toBeLessThan(0);
    expect(scrollBy.mock.calls[1][0].left).toBeGreaterThan(0);
  });

  it("from md up, every story is open and there is no פרטי המקרה", () => {
    viewport(1440);
    const { container } = render(<ProofCarousel />);
    expect(screen.queryByRole("button", { name: "פרטי המקרה" })).toBeNull();
    expect(screen.getByText(STORY).hidden).toBe(false);
    expect(container.querySelectorAll("#proof [hidden]")).toHaveLength(0);
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
  });
});
