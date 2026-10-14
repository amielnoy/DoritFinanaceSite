import { describe, expect, it } from "vitest";
import {
  ARTICLE_CTA_FALLBACK,
  articleCtaHeadline,
  articleWhatsappText,
  articleOffer,
  splitAfterParagraph,
} from "@/lib/articleCta";

const paras = (n: number) => Array.from({ length: n }, (_, i) => `פסקה ${i + 1}.`);

describe("splitAfterParagraph", () => {
  it("splits after the third paragraph, keeping both halves' Markdown intact", () => {
    const body = paras(5).join("\n\n");
    expect(splitAfterParagraph(body, 3)).toEqual(["פסקה 1.\n\nפסקה 2.\n\nפסקה 3.", "פסקה 4.\n\nפסקה 5."]);
  });

  it("does not count headings, lists, quotes or tables as paragraphs", () => {
    const body = ["## כותרת", "פסקה 1.", "- סעיף\n- סעיף", "> ציטוט", "| א | ב |\n|---|---|", "פסקה 2.", "פסקה 3.", "פסקה 4."].join("\n\n");
    const [head, tail] = splitAfterParagraph(body, 3)!;
    expect(head.endsWith("פסקה 3.")).toBe(true);
    expect(tail).toBe("פסקה 4.");
  });

  it("never splits inside a fenced block", () => {
    const body = ["פסקה 1.", "```\nשורה\n\nשורה\n```", "פסקה 2.", "פסקה 3.", "פסקה 4."].join("\n\n");
    const [head] = splitAfterParagraph(body, 3)!;
    expect(head).toContain("```\nשורה\n\nשורה\n```");
  });

  it.each([0, 3])("returns null when nothing follows the third paragraph (%i more blocks)", (extra) => {
    const body = [...paras(3), ...(extra ? ["## כותרת אחרונה"] : [])].join("\n\n");
    // a trailing heading alone is still "something after", so only the bare case is null
    expect(splitAfterParagraph(body, 3) === null).toBe(extra === 0);
  });

  it("returns null for a short or empty body", () => {
    expect(splitAfterParagraph(paras(2).join("\n\n"), 3)).toBeNull();
    expect(splitAfterParagraph("", 3)).toBeNull();
  });
});

describe("articleCtaHeadline", () => {
  it("uses the article's own headline when it has one", () => {
    expect(articleCtaHeadline({ cta_headline: "  כמה אתם משלמים?  " })).toBe("כמה אתם משלמים?");
  });

  it.each([undefined, "", "   "])("falls back to the general line for %j", (v) => {
    expect(articleCtaHeadline({ cta_headline: v })).toBe(ARTICLE_CTA_FALLBACK);
    expect(ARTICLE_CTA_FALLBACK).toBe("יש לך שאלה על הנושא הזה? דורית עונה אישית בוואטסאפ");
  });
});

describe("articleWhatsappText", () => {
  it("names the article the visitor read", () => {
    expect(articleWhatsappText("הורדת דמי ניהול")).toBe('שלום דורית, קראתי את המאמר "הורדת דמי ניהול" ואשמח לשאלה קצרה');
  });
});

describe("articleOffer — one next step per article, by its tags", () => {
  it.each([
    ["מיסוי, עצמאים, פנסיה, גמל והשתלמות, סוף שנה", "/atzmaim-31-12"],
    ["פנסיה, שכירים, גמל והשתלמות", "/pension-check"],
    ["פנסיה, דמי ניהול, ניוד", "/pension-check"],
    ["ביטוח, משכנתא, ביטוח חיים", "/tools"],
    ["מיסוי, החזר מס, שכירים", null],
    [undefined, null],
  ])("tags %j → %s", (tags, href) => {
    expect(articleOffer({ tags })?.href ?? null).toBe(href);
  });

  it("words the clearinghouse check as the brief does", () => {
    expect(articleOffer({ tags: "פנסיה" })?.label).toBe("נבדוק לך במסלקה");
  });
});
