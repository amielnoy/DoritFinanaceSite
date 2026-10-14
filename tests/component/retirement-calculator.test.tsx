// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import RetirementCalculator, { RETIREMENT_DISCLAIMER } from "@/components/dorit/sections/RetirementCalculator";
import { RESULT_SETTLE_MS } from "@/lib/calculator-lead";
import { formatIls } from "@/lib/pension-fee";
import { projectRetirement, whatIf } from "@/lib/retirement-projection";

type Gtag = ReturnType<typeof vi.fn>;
const w = window as unknown as { gtag?: Gtag };
const sent = (name: string) => w.gtag!.mock.calls.filter((c) => c[1] === name);
/** formatIls puts a no-break space before ₪; the DOM's text is read with whitespace collapsed. */
const ils = (n: number) => formatIls(n).replace(/\s+/g, " ");
const DEFAULTS = { currentAge: 40, retirementAge: 67, currentBalance: 200_000, monthlyDeposit: 2_000, feeOnBalance: 0.3, annualReturn: 4 };

beforeEach(() => {
  w.gtag = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  delete w.gtag;
});

describe("<RetirementCalculator /> — /tools, מחשבון פרישה", () => {
  it("pairs every slider with a number field, in the brief's ranges", () => {
    render(<RetirementCalculator />);
    const ranges: [string, string, string][] = [
      ["גיל היום", "20", "64"],
      ["גיל פרישה", "60", "70"],
      ["חיסכון קיים", "0", "2000000"],
      ["הפקדה חודשית", "0", "10000"],
      ["דמי ניהול מהצבירה", "0", "1.5"],
      ["תשואה שנתית", "1", "7"],
    ];
    for (const [label, min, max] of ranges) {
      const slider = screen.getByRole("slider", { name: label });
      expect(slider).toHaveAttribute("min", min);
      expect(slider).toHaveAttribute("max", max);
      expect(screen.getByRole("spinbutton", { name: `${label} — ערך` })).toBeInTheDocument();
    }
  });

  it("shows the monthly pension highlighted, the final balance and the fees", () => {
    render(<RetirementCalculator />);
    const r = projectRetirement(DEFAULTS);
    expect(screen.getByText("קצבה חודשית צפויה בגיל 67").parentElement).toHaveTextContent(ils(r.monthlyPension));
    expect(screen.getByText("קצבה חודשית צפויה בגיל 67").parentElement).toHaveClass("border-highlight");
    expect(screen.getByText("יתרה בפרישה").parentElement).toHaveTextContent(ils(r.finalBalance));
    expect(screen.getByText("דמי ניהול מצטברים").parentElement).toHaveTextContent(ils(r.cumulativeFees));
    expect(screen.getByRole("img", { name: /יתרה לפי גיל: .* בגיל 40, .* בגיל 67/ })).toBeInTheDocument();
  });

  it("answers 'ומה אם?' with ₪500 more a month and a 0.15% fee", () => {
    render(<RetirementCalculator />);
    const v = whatIf(DEFAULTS);
    const box = within(screen.getByRole("heading", { name: "ומה אם?" }).parentElement!);
    expect(box.getByText(`${ils(v.moreDeposit.monthlyPension)} לחודש`)).toBeInTheDocument();
    expect(box.getByText(`${ils(v.lowerFee.monthlyPension)} לחודש`)).toBeInTheDocument();
  });

  it("lets a two-digit age be typed, clamping only when the field is left", () => {
    render(<RetirementCalculator />);
    const age = screen.getByRole("spinbutton", { name: "גיל היום — ערך" });
    fireEvent.change(age, { target: { value: "4" } });
    expect(age).toHaveValue(4);
    fireEvent.change(age, { target: { value: "45" } });
    expect(screen.getByRole("slider", { name: "גיל היום" })).toHaveValue("45");
    fireEvent.change(age, { target: { value: "90" } });
    fireEvent.blur(age);
    expect(age).toHaveValue(64);
  });

  it("says so when retirement is not after today", () => {
    render(<RetirementCalculator />);
    fireEvent.change(screen.getByRole("slider", { name: "גיל היום" }), { target: { value: "64" } });
    fireEvent.change(screen.getByRole("slider", { name: "גיל פרישה" }), { target: { value: "60" } });
    expect(screen.getByRole("status")).toHaveTextContent("גיל הפרישה צריך להיות אחרי הגיל היום.");
  });

  it("keeps the disclaimer word for word, and sends the CTA to the questionnaire", () => {
    render(<RetirementCalculator />);
    expect(RETIREMENT_DISCLAIMER).toBe(
      "הערכה כללית בלבד ואינה ייעוץ. מניח הפקדות ותשואה קבועות ומקדם המרה 200, ללא מס, עליות שכר ואינפלציה.",
    );
    expect(screen.getByText(RETIREMENT_DISCLAIMER)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "לחשב לפי הנתונים האמיתיים שלי" })).toHaveAttribute("href", "/#start");
  });

  it("sends no calculator_result for the untouched defaults", () => {
    vi.useFakeTimers();
    render(<RetirementCalculator />);
    act(() => vi.advanceTimersByTime(RESULT_SETTLE_MS * 3));
    expect(sent("calculator_result")).toHaveLength(0);
  });

  it("sends calculator_result once the inputs settle, with the tool's name and no figure", () => {
    vi.useFakeTimers();
    render(<RetirementCalculator />);
    fireEvent.change(screen.getByRole("slider", { name: "הפקדה חודשית" }), { target: { value: "3000" } });
    act(() => vi.advanceTimersByTime(RESULT_SETTLE_MS));
    expect(sent("calculator_result")).toEqual([["event", "calculator_result", { tool: "retirement_projection" }]]);
  });
});
