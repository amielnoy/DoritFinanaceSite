/**
 * @vitest-environment jsdom
 *
 * The glossary's tooltips (`Glossed` → `Term`): the page's text is the same
 * with or without them, and a definition opens on a tap, on Enter and on
 * hover, and closes on a second tap or Escape.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it } from "vitest";
import Glossed from "@/components/dorit/primitives/Glossed";
import Term from "@/components/dorit/primitives/Term";
import { LocaleProvider } from "@/i18n/LocaleContext";
import type { Locale } from "@/i18n/locales";

// Radix positions the popover with a ResizeObserver, which jsdom lacks.
if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const TEXT ="בדקו את דמי הניהול בקרן ההשתלמות שלכם.";

const renderIn = (ui: React.ReactElement, locale: Locale = "he") =>
  render(
    <LocaleProvider locale={locale}>
      <p data-testid="para">{ui}</p>
    </LocaleProvider>,
  );

describe("Glossed and Term", () => {
  it("keeps the paragraph's text as written, and renders no definition until one is opened", () => {
    renderIn(<Glossed text={TEXT} />);
    expect(screen.getByTestId("para").textContent).toBe(TEXT);
    expect(screen.getByRole("button", { name: "דמי הניהול" })).toHaveAttribute("data-term", "management-fees");
    expect(screen.getByRole("button", { name: "בקרן ההשתלמות" })).toHaveAttribute("data-term", "study-fund");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens on a tap, describes the term, and closes on a second tap", async () => {
    const user = userEvent.setup();
    renderIn(<Glossed text={TEXT} />);
    const term = screen.getByRole("button", { name: "דמי הניהול" });
    await user.click(term);
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("דמי ניהול");
    expect(tip).toHaveAttribute("dir", "rtl");
    expect(term).toHaveAttribute("aria-expanded", "true");
    expect(term.getAttribute("aria-describedby")).toBe(tip.id);
    expect(term).toHaveFocus();
    await user.click(term);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("opens on Enter and closes on Escape", async () => {
    const user = userEvent.setup();
    renderIn(<Glossed text={TEXT} />);
    screen.getByRole("button", { name: "דמי הניהול" }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("opens when a mouse rests on the term, and closes when it leaves", async () => {
    renderIn(<Glossed text={TEXT} />);
    const term = screen.getByRole("button", { name: "דמי הניהול" });
    fireEvent.pointerEnter(term, { pointerType: "mouse" });
    expect(await screen.findByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerLeave(term, { pointerType: "mouse" });
    // The close waits CLOSE_DELAY, so the pointer can cross to the definition.
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("does not open on a touch's pointer-enter, only on its tap", async () => {
    renderIn(<Glossed text={TEXT} />);
    fireEvent.pointerEnter(screen.getByRole("button", { name: "דמי הניהול" }), { pointerType: "touch" });
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("speaks the page's language", async () => {
    const user = userEvent.setup();
    renderIn(<Glossed text="Check the management fees on your study fund." />, "en");
    await user.click(screen.getByRole("button", { name: "management fees" }));
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveAttribute("dir", "ltr");
    expect(tip).toHaveTextContent("Management fees");
  });

  it("renders an unknown id as plain text", () => {
    renderIn(<Term id="no-such-term">מילה</Term>);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("para").textContent).toBe("מילה");
  });
});
