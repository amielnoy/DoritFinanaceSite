import { describe, expect, it } from "vitest";
import { RESOURCES } from "@/i18n/resources";
import { LOCALES } from "@/i18n/locales";
import { PENSION_MARKETING_DISCLOSURE } from "@/config/compliance";

/**
 * The resource files (src/i18n/locales/<lang>/<namespace>.json) in step:
 * every key Hebrew has, English and French have; none is empty; and a
 * {placeholder} in one language is in all three — a translation that drops
 * {year} would print the brace.
 */
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("the resource files", () => {
  for (const ns of Object.keys(RESOURCES.he) as (keyof typeof RESOURCES.he)[]) {
    const he = RESOURCES.he[ns] as Record<string, string>;
    for (const lang of LOCALES.filter((l) => l !== "he")) {
      const other = RESOURCES[lang][ns] as Record<string, string>;

      it(`${lang}/${ns} has exactly Hebrew's keys`, () => {
        expect(Object.keys(other).sort()).toEqual(Object.keys(he).sort());
      });

      it(`${lang}/${ns} leaves nothing empty and keeps every placeholder`, () => {
        for (const [key, text] of Object.entries(other)) {
          expect(text.trim(), `${lang}/${ns}:${key}`).not.toBe("");
          expect(placeholders(text), `${lang}/${ns}:${key}`).toEqual(placeholders(he[key]));
        }
      });
    }
  }

  it("keeps the Hebrew disclosure word for word what compliance.ts says", () => {
    expect(RESOURCES.he.common["compliance.pensionMarketing"]).toBe(PENSION_MARKETING_DISCLOSURE);
  });

  it("says 'pension marketing, not advice' and names the licence in English and French", () => {
    for (const lang of ["en", "fr"] as const) {
      const text = RESOURCES[lang].common["compliance.pensionMarketing"];
      expect(text).toContain("L-00107009");
    }
    expect(RESOURCES.en.common["compliance.pensionMarketing"]).toMatch(/pension marketing, not objective pension advice/);
    expect(RESOURCES.fr.common["compliance.pensionMarketing"]).toMatch(/non du conseil en retraite objectif/);
  });
});
