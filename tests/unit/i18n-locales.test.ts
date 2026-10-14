import { describe, expect, it } from "vitest";
import { dirOf, enabledLocales, filledInNote, localePath, splitLocale } from "@/i18n/locales";
import { submissionErrorMessage } from "@/hooks/useSubmission";
import { interpolate, translate } from "@/i18n/LocaleContext";
import { switchTarget } from "@/components/dorit/layout/LanguageSwitcher";

describe("which languages a build serves", () => {
  it.each([
    [undefined, ["he"]],
    ["", ["he"]],
    ["en", ["he", "en"]],
    [" fr , EN ", ["he", "en", "fr"]],
    ["en,de,he", ["he", "en"]],
  ])("VITE_LOCALES=%j → %j, Hebrew always first", (raw, expected) => {
    expect(enabledLocales(raw)).toEqual(expected);
  });

  it("turns English and French left to right", () => {
    expect([dirOf("he"), dirOf("en"), dirOf("fr")]).toEqual(["rtl", "ltr", "ltr"]);
  });
});

describe("addresses in a language", () => {
  it.each([
    ["he", "/tools", "/tools"],
    ["en", "/tools", "/en/tools"],
    ["fr", "/", "/fr"],
    ["en", "/#start", "/en/#start"],
    ["en", "#start", "#start"],
    ["fr", "https://wa.me/1", "https://wa.me/1"],
    ["en", "tel:+972", "tel:+972"],
  ] as const)("%s %j → %j", (locale, path, expected) => {
    expect(localePath(locale, path)).toBe(expected);
  });

  it.each([
    ["/en/tools", "en", "/tools"],
    ["/fr", "fr", "/"],
    ["/tools", "he", "/tools"],
    ["/english", "he", "/english"],
  ] as const)("%j is %s, %j", (pathname, locale, rest) => {
    expect(splitLocale(pathname)).toEqual({ locale, rest });
  });

  it("switches to the same page in another language, or that language's home when the page is Hebrew-only", () => {
    expect(switchTarget("/tools", "?x=1", "#fee-calculator", "en")).toBe("/en/tools?x=1#fee-calculator");
    expect(switchTarget("/en/pension-check", "", "", "fr")).toBe("/fr/pension-check");
    expect(switchTarget("/fr/faq", "", "", "he")).toBe("/faq");
    expect(switchTarget("/blog/some-article", "", "", "en")).toBe("/en");
  });
});

describe("text in a language", () => {
  it("fills placeholders and leaves an unknown one", () => {
    expect(interpolate("© {year} x {missing}", { year: 2026 })).toBe("© 2026 x {missing}");
  });

  it("reads a key in the page's language", () => {
    expect(translate("en", "common", "nav.tools")).toBe("Tools");
    expect(translate("fr", "common", "nav.tools")).toBe("Outils");
    expect(translate("he", "common", "nav.tools")).toBe("כלים");
  });
});

describe("what Dorit reads, and what the visitor reads when sending fails", () => {
  it("notes in Hebrew that a visitor wrote from the English or French site, and nothing for Hebrew", () => {
    expect([filledInNote("he"), filledInNote("en"), filledInNote("fr")]).toEqual(["", "מולא באנגלית", "מולא בצרפתית"]);
  });

  it("says sending failed in the page's language, naming what and where to write instead", () => {
    expect(submissionErrorMessage("message")).toBe(
      "לא הצלחנו לשלוח את ההודעה כרגע. ניתן לשלוח מייל ישירות ל-dorit@govari-fin.co.il או לנסות שוב.",
    );
    expect(submissionErrorMessage("request", "en")).toBe(
      "We couldn't send your request just now. You can email dorit@govari-fin.co.il directly or try again.",
    );
    expect(submissionErrorMessage("form", "fr")).toMatch(/^Impossible d'envoyer le formulaire .*dorit@govari-fin\.co\.il/);
  });
});
