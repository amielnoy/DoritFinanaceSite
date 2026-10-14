import { describe, expect, it } from "vitest";
import { CONTACT } from "@/config/contact";
import { computePensionFees, formatIls } from "@/lib/pension-fee";
import {
  RESULT_SETTLE_MS,
  assessmentMessage,
  feeCalculatorMessage,
  whatsappHref,
} from "@/lib/calculator-lead";

/**
 * The calculator → lead box on /tools: the WhatsApp message each calculator
 * pre-fills with its own result. The message goes from the visitor's phone to
 * Dorit, never to GA4 — GA4 hears only `calculator_result {tool}`.
 */
const decoded = (href: string) => decodeURIComponent(href.split("?text=")[1] ?? "");

describe("whatsappHref", () => {
  it("opens a chat with the number from config, the text encoded", () => {
    const href = whatsappHref("שלום דורית & כל טוב?");
    expect(href.startsWith(`https://wa.me/${CONTACT.whatsapp}?text=`)).toBe(true);
    expect(decoded(href)).toBe("שלום דורית & כל טוב?");
    expect(href).not.toContain(" ");
  });
});

describe("feeCalculatorMessage", () => {
  const input = { monthlyDeposit: 2000, depositFee: 2, annualFee: 0.5, years: 25, annualReturn: 5 };
  const result = computePensionFees(input);

  it("says what the calculator showed: a year's fees on average, the total, the span and the deposit", () => {
    const text = feeCalculatorMessage(input, result);
    expect(text.startsWith("שלום דורית, מחשבון דמי הניהול באתר הראה שאני משלם/ת כ-")).toBe(true);
    expect(text).toContain(`כ-${formatIls(result.totalFees / 25)} בשנה דמי ניהול בממוצע`);
    expect(text).toContain(`כ-${formatIls(result.totalFees)} לאורך 25 שנות חיסכון`);
    expect(text).toContain(`בהפקדה חודשית של ${formatIls(2000)}`);
    expect(text.endsWith("אשמח לבדיקה של הנתונים האמיתיים שלי.")).toBe(true);
  });

  it("asks for a check without figures when there is nothing to report", () => {
    for (const empty of [
      { ...input, monthlyDeposit: "" },
      { ...input, years: "" },
      { ...input, years: 0 },
    ]) {
      const text = feeCalculatorMessage(empty, computePensionFees(empty));
      expect(text).toBe("שלום דורית, השתמשתי במחשבון דמי הניהול באתר. אשמח לבדיקה של הנתונים האמיתיים שלי.");
    }
  });

  it("never writes NaN, Infinity or undefined", () => {
    for (const odd of [
      { ...input, years: "abc" },
      { ...input, monthlyDeposit: "1e400" },
    ]) {
      const text = feeCalculatorMessage(odd, computePensionFees(odd));
      expect(text).not.toMatch(/NaN|Infinity|undefined|∞/);
    }
  });
});

describe("assessmentMessage", () => {
  it("lists the kinds of insurance the self-check showed, and how many are high priority", () => {
    const text = assessmentMessage([
      { title: "ביטוח חיים", priority: true },
      { title: "ביטוח בריאות משלים", priority: true },
      { title: "ביטוח תאונות אישיות", priority: false },
    ]);
    expect(text).toBe(
      "שלום דורית, מילאתי באתר את הבדיקה העצמית \"איזה ביטוח באמת מתאים לך?\" ויצאו 3 סוגי ביטוח לבחון: " +
        "ביטוח חיים, ביטוח בריאות משלים, ביטוח תאונות אישיות (2 מהם בעדיפות גבוהה). " +
        "אשמח לבדיקה של מה שיש לי היום בפועל."
    );
  });

  it("speaks of one kind in the singular, and leaves out the priority clause when none is", () => {
    expect(assessmentMessage([{ title: "ביטוח חיים", priority: false }])).toBe(
      "שלום דורית, מילאתי באתר את הבדיקה העצמית \"איזה ביטוח באמת מתאים לך?\" ויצא סוג ביטוח אחד לבחון: " +
        "ביטוח חיים. אשמח לבדיקה של מה שיש לי היום בפועל."
    );
  });

  it("still asks for a check when the result is empty", () => {
    expect(assessmentMessage([])).toBe(
      "שלום דורית, מילאתי באתר את הבדיקה העצמית לביטוח. אשמח לבדיקה של מה שיש לי היום בפועל."
    );
  });
});

describe("RESULT_SETTLE_MS", () => {
  it("waits long enough to outlast typing, short enough to catch a reader", () => {
    expect(RESULT_SETTLE_MS).toBe(1500);
  });
});
