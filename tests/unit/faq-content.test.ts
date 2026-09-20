import { describe, expect, it } from "vitest";
import {
  FAQ_CATEGORIES,
  FAQ_ENTRIES,
  HOME_COMMON_QUESTION_IDS,
  faqByCategory,
  faqByIds,
  faqTips,
} from "@/content/faq";

/**
 * One copy of the Q&A, three surfaces reading it. These pin the shape the
 * surfaces rely on, so an edit to the content cannot silently empty a section
 * or hand /faq's structured data a question the page does not show.
 */
describe("FAQ content", () => {
  it("has unique, stable ids", () => {
    const ids = FAQ_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("puts every entry in a declared category, and no category is empty", () => {
    const known = new Set(FAQ_CATEGORIES.map((c) => c.id));
    for (const e of FAQ_ENTRIES) expect(known, e.id).toContain(e.category);
    for (const c of FAQ_CATEGORIES) expect(faqByCategory(c.id).length, c.id).toBeGreaterThan(0);
  });

  it("has a question and an answer of substance on every entry", () => {
    for (const e of FAQ_ENTRIES) {
      expect(e.q.trim().length, e.id).toBeGreaterThan(10);
      expect(e.a.trim().length, e.id).toBeGreaterThan(40);
    }
  });

  it("numbers the home-page tips 1..n with no gaps or repeats", () => {
    const ns = faqTips().map((t) => t.tip.n);
    expect(ns).toEqual(ns.map((_, i) => i + 1));
    expect(ns.length).toBe(6);
  });

  it("resolves every home-page common question to a real entry, once", () => {
    expect(new Set(HOME_COMMON_QUESTION_IDS).size).toBe(HOME_COMMON_QUESTION_IDS.length);
    expect(faqByIds(HOME_COMMON_QUESTION_IDS)).toHaveLength(HOME_COMMON_QUESTION_IDS.length);
    expect(() => faqByIds(["no-such-entry"])).toThrow(/Unknown FAQ entry/);
  });

  it("does not repeat an answer under two questions", () => {
    // The old copies drifted by being edited in one place and not another;
    // a duplicated answer is the first sign of a second copy creeping back.
    const answers = FAQ_ENTRIES.map((e) => e.a);
    expect(new Set(answers).size).toBe(answers.length);
  });
});
