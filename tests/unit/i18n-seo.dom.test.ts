// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/locales", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/locales")>();
  return { ...actual, ENABLED_LOCALES: ["he", "en", "fr"] };
});
const { applySeo } = await import("@/lib/seo");

const head = (selector: string) => Array.from(document.head.querySelectorAll(selector));

describe("SEO in a language", () => {
  it("gives an English page its own address and locale, and links every language", () => {
    applySeo({ title: "t", description: "d", path: "/pension-check", locale: "en", translated: true });
    expect(head('link[rel="canonical"]')[0].getAttribute("href")).toMatch(/\/en\/pension-check$/);
    expect(head('meta[property="og:locale"]')[0].getAttribute("content")).toBe("en_US");
    const alternates = Object.fromEntries(head('link[rel="alternate"][hreflang]').map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]));
    expect(Object.keys(alternates).sort()).toEqual(["en", "fr", "he", "x-default"]);
    expect(alternates.he).toMatch(/\/pension-check$/);
    expect(alternates.fr).toMatch(/\/fr\/pension-check$/);
    expect(alternates["x-default"]).toBe(alternates.he);
  });

  it("links no languages for a page that is not translated, and clears the last page's", () => {
    applySeo({ title: "t", description: "d", path: "/blog" });
    expect(head('link[rel="alternate"][hreflang]')).toHaveLength(0);
    expect(head('meta[property="og:locale"]')[0].getAttribute("content")).toBe("he_IL");
  });
});
