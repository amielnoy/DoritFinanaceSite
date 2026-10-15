import { describe, expect, it } from "vitest";
import { QUESTIONS, REC_REASONS, REC_TITLES, buildRecommendations, type Answers } from "@/lib/insurance-assessment";
import { assessmentMessage, feeCalculatorMessage } from "@/lib/calculator-lead";
import { assessmentMessageFromTemplates, assessmentMessageIn, feeCalculatorMessageIn, feeMessageFromTemplates, formatIlsIn } from "@/i18n/tools";
import { formatIls } from "@/lib/pension-fee";
import { RESOURCES } from "@/i18n/resources";

/** Every combination of answers, unanswered included. */
const ALL_ANSWERS: Answers[] = (() => {
  const opts = (id: string) => [undefined, ...QUESTIONS.find((q) => q.id === id)!.options.map((o) => o.value)];
  const out: Answers[] = [];
  for (const stage of opts("stage")) for (const work of opts("work")) for (const mortgage of opts("mortgage")) for (const health of opts("health"))
    out.push({ stage, work, mortgage, health } as Answers);
  return out;
})();

const FEE_CASES: [Parameters<typeof feeCalculatorMessage>[0], Parameters<typeof feeCalculatorMessage>[1]][] = [
  [{ monthlyDeposit: 2000, years: 25 }, { totalFees: 98765 }],
  [{ monthlyDeposit: "3500", years: "30" }, { totalFees: 150000.4 }],
  [{ monthlyDeposit: 0, years: 25 }, { totalFees: 1 }],
  [{ monthlyDeposit: 2000, years: 0 }, { totalFees: 1 }],
  [{ monthlyDeposit: 2000, years: 10 }, { totalFees: Infinity }],
];

describe("/tools in English and French", () => {
  it("holds tools.json's Hebrew to the quiz's own wording, key for key", () => {
    const he = RESOURCES.he.tools as Record<string, string>;
    for (const q of QUESTIONS) {
      expect(he[`assess.q.${q.id}.label`]).toBe(q.label);
      expect(he[`assess.q.${q.id}.hint`]).toBe(q.hint);
      for (const o of q.options) expect(he[`assess.q.${q.id}.${o.value}`]).toBe(o.label);
    }
    for (const [id, title] of Object.entries(REC_TITLES)) expect(he[`assess.rec.${id}`]).toBe(title);
    for (const [reason, why] of Object.entries(REC_REASONS)) expect(he[`assess.why.${reason}`]).toBe(why);
  });

  it("writes the Hebrew messages from the templates exactly as calculator-lead.ts does", () => {
    for (const [input, result] of FEE_CASES) expect(feeMessageFromTemplates("he", input, result)).toBe(feeCalculatorMessage(input, result));
    for (const a of ALL_ANSWERS) {
      const recs = buildRecommendations(a);
      expect(assessmentMessageFromTemplates("he", recs)).toBe(assessmentMessage(recs));
    }
    expect(assessmentMessageFromTemplates("he", [])).toBe(assessmentMessage([]));
  });

  it("sends Hebrew through the existing functions, untouched", () => {
    const recs = buildRecommendations({ stage: "parent", work: "selfemployed", mortgage: "yes", health: "yes" });
    expect(assessmentMessageIn("he", recs)).toBe(assessmentMessage(recs));
    expect(feeCalculatorMessageIn("he", ...FEE_CASES[0])).toBe(feeCalculatorMessage(...FEE_CASES[0]));
  });

  it("offers an English message with English names and English-formatted shekels", () => {
    const recs = buildRecommendations({ stage: "parent", work: "selfemployed", mortgage: "yes", health: "yes" });
    const msg = assessmentMessageIn("en", recs);
    expect(msg).toMatch(/^Hello Dorit, I did the self-check "Which insurance really suits you\?" on the website and it listed 6 kinds/);
    expect(msg).toContain("Life insurance, Supplementary health insurance");
    expect(msg).toContain("(3 of them high priority).");
    expect(msg).not.toMatch(/[֐-׿]/);
    expect(feeCalculatorMessageIn("en", ...FEE_CASES[0])).toBe(
      "Hello Dorit, the management-fee calculator on the website showed that I pay about ₪3,951 a year in management fees on average — about ₪98,765 over 25 years of saving, with a monthly deposit of ₪2,000. I'd like a check of my real figures.",
    );
  });

  it("formats shekels for the page: Hebrew as before, English and French without direction marks", () => {
    for (const n of [0, 1234, 98765.4]) expect(formatIlsIn("he", n)).toBe(formatIls(n));
    expect(formatIlsIn("en", 123456)).toBe("₪123,456");
    expect(formatIlsIn("fr", 123456)).toMatch(/^123\s456\s₪$/u);
    expect(formatIlsIn("en", 123456) + formatIlsIn("fr", 123456)).not.toMatch(/[‎‏]/);
  });
});
