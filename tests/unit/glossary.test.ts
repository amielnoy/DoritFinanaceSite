import { describe, expect, it } from "vitest";
import { GLOSSARY } from "@/content/glossary";
import { glossSegments, newGlossScope } from "@/lib/glossary";
import { LOCALES } from "@/i18n/locales";

const terms = (text: string, locale: "he" | "en" | "fr" = "he") =>
  glossSegments(text, locale).filter((s): s is { id: string; text: string } => typeof s !== "string");

describe("glossary content", () => {
  it("has unique ids and a title, definition and forms in every language", () => {
    const ids = GLOSSARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of GLOSSARY) {
      for (const l of LOCALES) {
        expect(e[l].title.trim(), `${e.id}.${l}.title`).not.toBe("");
        expect(e[l].def.trim(), `${e.id}.${l}.def`).not.toBe("");
        expect(e[l].match.length, `${e.id}.${l}.match`).toBeGreaterThan(0);
      }
    }
  });

  it("never maps one form to two entries in the same language", () => {
    for (const l of LOCALES) {
      const seen = new Map<string, string>();
      for (const e of GLOSSARY) {
        for (const f of e[l].match) {
          const k = f.toLowerCase();
          expect(seen.get(k) ?? e.id, `${l}: "${f}"`).toBe(e.id);
          seen.set(k, e.id);
        }
      }
    }
  });

  it("promises nothing: no percent figures and no 'saves'", () => {
    for (const e of GLOSSARY) {
      for (const l of LOCALES) {
        expect(e[l].def).not.toMatch(/\d+(\.\d+)?\s*%/);
        expect(e[l].def).not.toMatch(/חוסכ(ים|ת) לכם|saves you|vous fait économiser/i);
      }
    }
  });

  it("explains and never advises: no 'worth doing' or 'recommended'", () => {
    for (const e of GLOSSARY) {
      for (const l of LOCALES) {
        expect(e[l].def, `${e.id}.${l}`).not.toMatch(/כדאי|מומלץ|worth|recommend|vaut mieux|à mettre à jour|conseill/i);
      }
    }
  });
});

describe("glossSegments", () => {
  it("keeps the text intact", () => {
    const text = "בדקו את דמי הניהול בקרן ההשתלמות ובקופת הגמל שלכם.";
    const joined = glossSegments(text, "he").map((s) => (typeof s === "string" ? s : s.text)).join("");
    expect(joined).toBe(text);
  });

  it("matches Hebrew prefixes with the term", () => {
    expect(terms("כדאי לבדוק ובקרן השתלמות")).toEqual([{ id: "study-fund", text: "ובקרן השתלמות" }]);
    expect(terms("ההפקדות לפנסיה")).toEqual([
      { id: "deposits", text: "ההפקדות" },
      { id: "pension-fund", text: "לפנסיה" },
    ]);
  });

  it("underlines the whole name when a prefix replaces its ה", () => {
    expect(terms("את אישורכם במסלקה הפנסיונית")).toEqual([{ id: "clearinghouse", text: "במסלקה הפנסיונית" }]);
  });

  it("prefers the longest form", () => {
    expect(terms("קרן פנסיה")).toEqual([{ id: "pension-fund", text: "קרן פנסיה" }]);
    expect(terms("קופת גמל להשקעה")).toEqual([{ id: "gemel-invest", text: "קופת גמל להשקעה" }]);
  });

  it("does not match inside a longer word", () => {
    expect(terms("ייעוץ פנסיוני")).toEqual([]);
    expect(terms("Pensioners")).toEqual([]);
  });

  it("marks each entry once per text", () => {
    expect(terms("פנסיה, ועוד פנסיה, וקרן פנסיה")).toHaveLength(1);
  });

  it("shares the once-only rule across a scope, and returns the same split on a re-render", () => {
    const scope = newGlossScope();
    const a = glossSegments("דמי ניהול", "he", scope);
    const b = glossSegments("שוב דמי ניהול", "he", scope);
    expect(a).toHaveLength(1);
    expect(b.every((s) => typeof s === "string")).toBe(true);
    expect(glossSegments("דמי ניהול", "he", scope)).toBe(a);
  });

  it("matches English and French case-insensitively", () => {
    expect(terms("Your Management Fees and study fund", "en").map((t) => t.id)).toEqual(["management-fees", "study-fund"]);
    expect(terms("Les frais de gestion du fonds de formation", "fr").map((t) => t.id)).toEqual(["management-fees", "study-fund"]);
  });
});
