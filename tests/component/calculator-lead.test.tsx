/**
 * @vitest-environment jsdom
 *
 * The calculator → lead box on /tools. After either tool shows a result, a box
 * asks "רוצים שדורית תבדוק את הנתונים האמיתיים שלכם?" and opens WhatsApp with
 * that result already written. GA4 hears `calculator_result` with the tool's
 * name only — once per result the visitor produced, never per keystroke — and
 * the box's button as `click_whatsapp` from location `calculator`.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("framer-motion", async () => {
  const R = await import("react");
  const passthrough = new Proxy(
    {},
    { get: (_t, tag: string) => ({ children, initial, animate, exit, transition, ...props }: any) => R.createElement(tag, props, children) },
  );
  return {
    motion: passthrough,
    AnimatePresence: ({ children }: any) => R.createElement(R.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

import { CONTACT } from "@/config/contact";
import { initClickTracking } from "@/lib/analytics";
import { RESULT_SETTLE_MS } from "@/lib/calculator-lead";
import { QUESTIONS, buildRecommendations } from "@/lib/insurance-assessment";
import { computePensionFees, formatIls } from "@/lib/pension-fee";
import PensionFeeCalculator from "@/components/dorit/sections/PensionFeeCalculator";
import InsuranceAssessment from "@/components/dorit/sections/InsuranceAssessment";

const HEADING = "רוצים שדורית תבדוק את הנתונים האמיתיים שלכם?";
type Gtag = ReturnType<typeof vi.fn>;
const w = window as unknown as { gtag?: Gtag };

const box = () => screen.getByRole("heading", { name: HEADING }).closest("[data-track-location]") as HTMLElement;
const waLink = () => within(box()).getByRole("link", { name: /וואטסאפ/ });
const waText = () => decodeURIComponent(waLink().getAttribute("href")!.split("?text=")[1]);
const sent = (name: string) => w.gtag!.mock.calls.filter((c) => c[1] === name);

beforeAll(() => initClickTracking());
beforeEach(() => {
  w.gtag = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  delete w.gtag;
});

describe("<PensionFeeCalculator /> — the lead box", () => {
  it("shows the box under the result, tagged calculator, with the result in the WhatsApp message", () => {
    render(<PensionFeeCalculator />);
    expect(box()).toHaveAttribute("data-track-location", "calculator");
    const href = waLink().getAttribute("href")!;
    expect(href.startsWith(`https://wa.me/${CONTACT.whatsapp}?text=`)).toBe(true);
    const total = computePensionFees({ monthlyDeposit: 2000, depositFee: 2, annualFee: 0.5, years: 25, annualReturn: 5 }).totalFees;
    expect(waText()).toContain(`כ-${formatIls(total)} לאורך 25 שנות חיסכון`);
    expect(waLink()).toHaveAttribute("target", "_blank");
    expect(waLink().getAttribute("rel")).toContain("noopener");
  });

  it("keeps the calculator's disclaimer, and says the box is not advice", () => {
    render(<PensionFeeCalculator />);
    expect(screen.getByText("הערכה כללית בלבד — אינה מחליפה ייעוץ אישי.")).toBeVisible();
    expect(within(box()).getByText(/הערכה כללית בלבד ואינה ייעוץ או המלצה/)).toBeInTheDocument();
  });

  it("has one WhatsApp button, the box's, and keeps the link to the conversation", () => {
    const { container } = render(<PensionFeeCalculator />);
    expect(container.querySelectorAll('a[href*="wa.me"]')).toHaveLength(1);
    expect(container.querySelector('a[href="/#start"]')).not.toBeNull();
  });

  it("reports the box's button as click_whatsapp from location calculator", () => {
    render(<PensionFeeCalculator />);
    const link = waLink();
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);
    expect(w.gtag).toHaveBeenCalledWith("event", "click_whatsapp", { location: "calculator" });
  });

  it("updates the message as the visitor changes an input", () => {
    render(<PensionFeeCalculator />);
    fireEvent.change(screen.getByLabelText("שנות חיסכון"), { target: { value: "10" } });
    expect(waText()).toContain("לאורך 10 שנות חיסכון");
  });

  it("sends no calculator_result for the defaults nobody touched", () => {
    vi.useFakeTimers();
    render(<PensionFeeCalculator />);
    act(() => vi.advanceTimersByTime(RESULT_SETTLE_MS * 3));
    expect(sent("calculator_result")).toHaveLength(0);
  });

  it("sends calculator_result once the inputs settle — not per keystroke — and with the tool's name only", () => {
    vi.useFakeTimers();
    render(<PensionFeeCalculator />);
    const deposit = screen.getByLabelText("הפקדה חודשית (₪)");
    for (const v of ["3", "30", "300", "3000"]) {
      fireEvent.change(deposit, { target: { value: v } });
      act(() => vi.advanceTimersByTime(200));
    }
    expect(sent("calculator_result")).toHaveLength(0);
    act(() => vi.advanceTimersByTime(RESULT_SETTLE_MS));
    expect(sent("calculator_result")).toEqual([["event", "calculator_result", { tool: "fee_calculator" }]]);
    act(() => vi.advanceTimersByTime(RESULT_SETTLE_MS * 3));
    expect(sent("calculator_result")).toHaveLength(1);
  });

  it("sends again for a new result, but not for one already counted", () => {
    vi.useFakeTimers();
    render(<PensionFeeCalculator />);
    const years = screen.getByLabelText("שנות חיסכון");
    fireEvent.change(years, { target: { value: "10" } });
    act(() => vi.advanceTimersByTime(RESULT_SETTLE_MS));
    fireEvent.change(years, { target: { value: "20" } });
    act(() => vi.advanceTimersByTime(RESULT_SETTLE_MS));
    expect(sent("calculator_result")).toHaveLength(2);
    fireEvent.change(years, { target: { value: "10" } });
    act(() => vi.advanceTimersByTime(RESULT_SETTLE_MS));
    expect(sent("calculator_result")).toHaveLength(2);
  });

  it("sends nothing while there is no result to speak of", () => {
    vi.useFakeTimers();
    render(<PensionFeeCalculator />);
    fireEvent.change(screen.getByLabelText("הפקדה חודשית (₪)"), { target: { value: "" } });
    act(() => vi.advanceTimersByTime(RESULT_SETTLE_MS * 2));
    expect(sent("calculator_result")).toHaveLength(0);
  });

  it("never sends a figure to GA4", () => {
    vi.useFakeTimers();
    render(<PensionFeeCalculator />);
    fireEvent.change(screen.getByLabelText("הפקדה חודשית (₪)"), { target: { value: "4321" } });
    act(() => vi.advanceTimersByTime(RESULT_SETTLE_MS));
    const link = waLink();
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);
    expect(w.gtag!.mock.calls.length).toBeGreaterThan(0);
    for (const [, , params] of w.gtag!.mock.calls) expect(JSON.stringify(params)).not.toMatch(/\d/);
  });
});

describe("<InsuranceAssessment /> — the lead box", () => {
  /** Answers every question with its first option: a single person, employed, a mortgage, a health risk. */
  const answerAll = () => {
    for (const q of QUESTIONS) fireEvent.click(screen.getByRole("button", { name: q.options[0].label }));
  };
  const expected = buildRecommendations(Object.fromEntries(QUESTIONS.map((q) => [q.id, q.options[0].value])));

  it("shows no box before the result", () => {
    render(<InsuranceAssessment />);
    expect(screen.queryByRole("heading", { name: HEADING })).toBeNull();
    expect(sent("calculator_result")).toHaveLength(0);
  });

  it("shows the box with the result in the message once the last answer is in", () => {
    render(<InsuranceAssessment />);
    answerAll();
    expect(box()).toHaveAttribute("data-track-location", "calculator");
    for (const r of expected) expect(waText()).toContain(r.title);
    expect(waText()).toContain(`ויצאו ${expected.length} סוגי ביטוח לבחון`);
  });

  it("keeps both disclaimers in view", () => {
    render(<InsuranceAssessment />);
    answerAll();
    expect(screen.getByText(/ההערכה כאן היא כללית בלבד/)).toBeInTheDocument();
    expect(screen.getByText(/אינו מהווה ייעוץ פיננסי או המלצה לרכישת/)).toBeInTheDocument();
  });

  it("sends calculator_result once per completed assessment", () => {
    render(<InsuranceAssessment />);
    answerAll();
    expect(sent("calculator_result")).toEqual([["event", "calculator_result", { tool: "insurance_assessment" }]]);
    fireEvent.click(screen.getByRole("button", { name: /התחלה מחדש/ }));
    expect(sent("calculator_result")).toHaveLength(1);
    answerAll();
    expect(sent("calculator_result")).toHaveLength(2);
  });

  it("sends its call to the conversation to /#start, which works from /tools", () => {
    render(<InsuranceAssessment />);
    answerAll();
    expect(screen.getByRole("link", { name: /לשיחה קצרה עם דורית/ })).toHaveAttribute("href", "/#start");
  });
});
