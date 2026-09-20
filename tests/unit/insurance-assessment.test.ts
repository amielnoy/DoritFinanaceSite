import { describe, expect, it } from "vitest";
import { QUESTIONS, buildRecommendations } from "@/lib/insurance-assessment";
import type { Answers } from "@/lib/insurance-assessment";

const titles = (a: Answers) => buildRecommendations(a).map((r) => r.title);
const priority = (a: Answers) =>
  buildRecommendations(a).filter((r) => r.priority).map((r) => r.title);

describe("insurance self-assessment", () => {
  it("asks four questions, each with a stable id and at least two options", () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual(["stage", "work", "mortgage", "health"]);
    for (const q of QUESTIONS) {
      expect(q.options.length, q.id).toBeGreaterThanOrEqual(2);
      expect(new Set(q.options.map((o) => o.value)).size).toBe(q.options.length);
    }
  });

  it("always suggests supplementary health cover", () => {
    for (const stage of ["single", "couple", "parent", "retiree"]) {
      expect(titles({ stage, work: "employee", mortgage: "no", health: "no" })).toContain("ביטוח בריאות משלים");
    }
  });

  it("makes life cover a priority for parents, couples and anyone with a mortgage", () => {
    expect(priority({ stage: "parent", work: "employee", mortgage: "no", health: "no" })).toContain("ביטוח חיים");
    expect(priority({ stage: "single", work: "employee", mortgage: "yes", health: "no" })).toContain("ביטוח חיים");
    expect(titles({ stage: "single", work: "employee", mortgage: "no", health: "no" })).not.toContain("ביטוח חיים");
  });

  it("treats loss of working capacity as critical for the self-employed", () => {
    const recs = buildRecommendations({ stage: "single", work: "selfemployed", mortgage: "no", health: "no" });
    const disability = recs.find((r) => r.title === "ביטוח אובדן כושר עבודה");
    expect(disability?.priority).toBe(true);
    expect(recs.map((r) => r.title)).toContain("ביטוח תאונות אישיות");
  });

  it("raises critical-illness cover only on a medical or family history", () => {
    expect(titles({ stage: "single", work: "employee", mortgage: "no", health: "yes" })).toContain("ביטוח מחלות קשות");
    expect(titles({ stage: "single", work: "employee", mortgage: "no", health: "no" })).not.toContain("ביטוח מחלות קשות");
  });

  it("puts pension planning first for someone approaching retirement", () => {
    const recs = buildRecommendations({ stage: "retiree", work: "none", mortgage: "no", health: "no" });
    expect(recs.find((r) => r.title === "תכנון פנסיוני / מנהלים")?.priority).toBe(true);
    // A retiree is no longer nudged to review an employer's study fund.
    expect(recs.map((r) => r.title)).not.toContain("בחינת קרן השתלמות / פנסיה");
  });

  it("never returns the same insurance type twice, and gives every result a reason", () => {
    for (const stage of ["single", "couple", "parent", "retiree"])
      for (const work of ["employee", "selfemployed", "none"])
        for (const mortgage of ["yes", "no"])
          for (const health of ["yes", "no"]) {
            const recs = buildRecommendations({ stage, work, mortgage, health });
            const t = recs.map((r) => r.title);
            expect(new Set(t).size, JSON.stringify({ stage, work, mortgage, health })).toBe(t.length);
            for (const r of recs) expect(r.why.length).toBeGreaterThan(20);
            expect(recs.length).toBeGreaterThan(0);
          }
  });

  it("copes with unanswered questions", () => {
    expect(() => buildRecommendations({})).not.toThrow();
    expect(titles({})).toEqual(["ביטוח בריאות משלים"]);
  });
});
