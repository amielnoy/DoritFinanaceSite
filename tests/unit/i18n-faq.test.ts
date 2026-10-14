import { describe, expect, it } from "vitest";
import { FAQ_CATEGORIES, FAQ_ENTRIES, faqCategoryLabel, localizeFaq } from "@/content/faq";
import { RESOURCES } from "@/i18n/resources";

/**
 * The questions and answers in English and French (slice 3). faq.ts keeps the
 * structure; the words are in src/i18n/locales/<lang>/faq.json, Hebrew's
 * included — so FAQ_ENTRIES is read from the Hebrew file, and the other two
 * are held to it key for key by i18n-resources.test.ts.
 */
describe("the FAQ in other languages", () => {
  it("translates every entry and keeps its id, category and tip number", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const e of FAQ_ENTRIES) {
        const t = localizeFaq(e, locale);
        expect([t.id, t.category, t.tip?.n], `${locale}:${e.id}`).toEqual([e.id, e.category, e.tip?.n]);
        expect(t.q, `${locale}:${e.id}`).not.toBe(e.q);
        expect(t.a, `${locale}:${e.id}`).not.toMatch(/[֐-׿]/);
        if (e.tip) expect(t.tip?.title, `${locale}:${e.id}`).not.toMatch(/[֐-׿]/);
      }
    }
  });

  it("returns the Hebrew entry itself for Hebrew", () => {
    for (const e of FAQ_ENTRIES) expect(localizeFaq(e, "he")).toBe(e);
  });

  it("names the categories in each language", () => {
    expect(FAQ_CATEGORIES.map((c) => faqCategoryLabel(c.id, "en"))).toEqual(["Income tax", "Pension & savings", "Insurance", "General"]);
    expect(FAQ_CATEGORIES.map((c) => faqCategoryLabel(c.id, "he"))).toEqual(FAQ_CATEGORIES.map((c) => c.label));
  });

  it("keeps the disclosure in the 'are you independent?' answer, in every language", () => {
    const answer = (l: "en" | "fr") => RESOURCES[l].faq["independent-agent.a"];
    expect(FAQ_ENTRIES.find((e) => e.id === "independent-agent")!.a).toContain("שיווק פנסיוני ולא ייעוץ פנסיוני אובייקטיבי");
    expect(answer("en")).toContain("pension marketing, not objective pension advice");
    expect(answer("fr")).toContain("et non du conseil en retraite objectif");
  });
});
