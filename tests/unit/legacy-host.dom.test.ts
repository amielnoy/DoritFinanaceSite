/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leaveLegacyHost } from "@/lib/legacy-host-boot";
import { SITE_URL, applySeo } from "@/lib/seo";

// What a page booted on the old Base44 host does to its own head and address,
// and that a page anywhere else is left exactly as it was.

declare const jsdom: { reconfigure(options: { url: string }): void };

const OLD = "https://safe-arch-plan.base44.app";
const PROD = "https://govari-fin.co.il";

const head = () => document.head;
const attr = (sel: string, name: string) => head().querySelector(sel)?.getAttribute(name) ?? null;
const canonical = () => attr('link[rel="canonical"]', "href");
const ogUrl = () => attr('meta[property="og:url"]', "content");
const robots = () => attr('meta[name="robots"]', "content");
const googlebot = () => attr('meta[name="googlebot"]', "content");

/** The shipped head, as index.html has it. */
function shellHead() {
  head().innerHTML = `
    <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
    <meta name="googlebot" content="index, follow, max-image-preview:large" />
    <link rel="canonical" href="${PROD}/" />
    <meta property="og:url" content="${PROD}/" />`;
  document.body.innerHTML = `<div id="root"></div>`;
}

/** A window whose address is `url`, with `location.replace` recorded. */
function fakeWindow(url: string, { framed = false } = {}) {
  const u = new URL(url);
  const replace = vi.fn();
  const self = {};
  return {
    win: {
      location: { hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash, replace },
      self,
      top: framed ? {} : self,
      document,
    } as unknown as Window,
    replace,
  };
}

beforeEach(shellHead);
afterEach(() => jsdom.reconfigure({ url: "http://localhost:3000/" }));

describe("the canonical origin", () => {
  it("defaults to the production domain, never the old host", () => {
    // No VITE_SITE_URL in the test env: this is the default a builder without
    // the variable — the Base44 Builder — gets.
    expect(SITE_URL).toBe(PROD);
  });
});

describe("leaveLegacyHost — on the old host", () => {
  it("marks the page noindex, points canonical and og:url at production, and moves the visitor", () => {
    const { win, replace } = fakeWindow(`${OLD}/faq?utm_source=wa#q3`);

    expect(leaveLegacyHost(win, PROD)).toBe(true);

    expect(canonical()).toBe(`${PROD}/faq`);
    expect(ogUrl()).toBe(`${PROD}/faq`);
    expect(robots()).toBe("noindex");
    expect(googlebot()).toBe("noindex");
    expect(replace).toHaveBeenCalledExactlyOnceWith(`${PROD}/faq?utm_source=wa#q3`);
  });

  it("leaves a notice with a working link while the navigation happens", () => {
    const { win } = fakeWindow(`${OLD}/claims`);
    leaveLegacyHost(win, PROD);
    const link = document.querySelector<HTMLAnchorElement>("#root a");
    expect(link?.getAttribute("href")).toBe(`${PROD}/claims`);
    expect(link?.textContent).toBe("govari-fin.co.il");
  });

  it("stays — and still says noindex and canonical elsewhere — when a sign-in is in flight", () => {
    const { win, replace } = fakeWindow(`${OLD}/login?code=abc`);
    expect(leaveLegacyHost(win, PROD)).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(robots()).toBe("noindex");
    expect(canonical()).toBe(`${PROD}/login`);
  });

  it("stays inside a frame", () => {
    const { win, replace } = fakeWindow(`${OLD}/faq`, { framed: true });
    expect(leaveLegacyHost(win, PROD)).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(robots()).toBe("noindex");
  });

  it("does not redirect to itself when the canonical origin is misconfigured as the old host", () => {
    const { win, replace } = fakeWindow(`${OLD}/faq`);
    expect(leaveLegacyHost(win, OLD)).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("leaveLegacyHost — everywhere else", () => {
  for (const url of [`${PROD}/faq`, "https://preview-sandbox--68d1.base44.app/faq", "http://127.0.0.1:4173/"]) {
    it(`changes nothing on ${new URL(url).host}`, () => {
      const before = head().innerHTML;
      const { win, replace } = fakeWindow(url);
      expect(leaveLegacyHost(win, PROD)).toBe(false);
      expect(replace).not.toHaveBeenCalled();
      expect(head().innerHTML).toBe(before);
      expect(document.getElementById("root")?.childElementCount).toBe(0);
    });
  }
});

describe("applySeo keeps the old host out of the index after boot", () => {
  const config = { title: "שאלות", description: "תשובות על פנסיה, גמל והשתלמות. ".repeat(3), path: "/faq" };

  it("says noindex on the old host, with the production canonical", () => {
    jsdom.reconfigure({ url: `${OLD}/faq` });
    applySeo(config);
    expect(robots()).toBe("noindex");
    expect(canonical()).toBe(`${PROD}/faq`);
    expect(ogUrl()).toBe(`${PROD}/faq`);
  });

  it("keeps nofollow on a private route there", () => {
    jsdom.reconfigure({ url: `${OLD}/login?code=abc` });
    applySeo({ ...config, path: "/login", noIndex: true });
    expect(robots()).toBe("noindex, nofollow");
  });

  it("is unchanged on production", () => {
    jsdom.reconfigure({ url: `${PROD}/faq` });
    applySeo(config);
    expect(robots()).toBe("index, follow, max-image-preview:large, max-snippet:-1");
    expect(canonical()).toBe(`${PROD}/faq`);
  });
});
