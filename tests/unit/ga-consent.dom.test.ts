// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSENT_KEY,
  analyticsWithheld,
  cookieDomains,
  CONSENT_REOPEN_EVENT,
  declineConsent,
  grantConsent,
  loadAnalytics,
  readConsent,
  reopenConsent,
} from "@/lib/consent";

/*
 * Consent before Google Analytics (src/lib/consent.ts, docs/COMPLIANCE.md §8).
 * The first block runs index.html's own inline script, as the browser would,
 * for each combination of the flag (its meta) and the stored choice: the
 * promise is that with the flag on, nothing exists to send or queue before a
 * "yes".
 */

const ID = "G-LLSYPMGV58";
type W = Window & { gtag?: unknown; dataLayer?: unknown[] } & Record<string, unknown>;
const w = window as unknown as W;

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

// process.cwd(), not REPO_ROOT: under jsdom that resolves to a /@fs/ path. Vitest runs from the repo root.
const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
const inline = (() => {
  const m = html.match(/<script>\s*(window\.dataLayer = window\.dataLayer \|\| \[\];[\s\S]*?)<\/script>/);
  if (!m) throw new Error("index.html: the GA inline script was not found");
  return m[1];
})();
const gaTags = () => document.querySelectorAll('script[src^="https://www.googletagmanager.com/gtag/js"]');

function page(flag: string, stored: string | null) {
  document.head.innerHTML = `<meta name="ga-consent" content="${flag}">`;
  if (stored) window.localStorage.setItem(CONSENT_KEY, stored);
  // Indirect eval: the snippet runs in the global scope, as a classic inline script does.
  (0, eval)(inline);
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  delete w.gtag;
  delete w.dataLayer;
  delete w[`ga-disable-${ID}`];
  document.head.innerHTML = "";
});

afterEach(() => {
  document.head.innerHTML = "";
});

describe("index.html's inline GA4 script", () => {
  it("with the flag off (the meta left unreplaced, or anything but 'true'), loads GA4 as before", () => {
    for (const flag of ["%VITE_GA_CONSENT%", "", "false"]) {
      delete w.gtag;
      page(flag, null);
      expect(typeof w.gtag, flag).toBe("function");
      expect(gaTags(), flag).toHaveLength(1);
      expect(gaTags()[0].getAttribute("src")).toBe(`https://www.googletagmanager.com/gtag/js?id=${ID}`);
    }
  });

  it("with the flag on and no choice, or a 'no', defines no gtag and loads nothing", () => {
    for (const stored of [null, "denied", "something else"]) {
      page("true", stored);
      expect(w.gtag, String(stored)).toBeUndefined();
      expect(gaTags(), String(stored)).toHaveLength(0);
      expect(w.dataLayer, String(stored)).toEqual([]);
    }
  });

  it("with the flag on and a stored 'yes', loads GA4 once", () => {
    page("true", "granted");
    expect(typeof w.gtag).toBe("function");
    expect(gaTags()).toHaveLength(1);
  });

  it("never adds a second tag when one is already there", () => {
    document.head.innerHTML = `<script async src="https://www.googletagmanager.com/gtag/js?id=${ID}"></script>`;
    (0, eval)(inline);
    expect(gaTags()).toHaveLength(1);
  });

  it("matches the storage key src/lib/consent.ts writes", () => {
    expect(inline).toContain(`localStorage.getItem('${CONSENT_KEY}')`);
    expect(inline).toContain(`var id = '${ID}'`);
  });
});

describe("src/lib/consent.ts", () => {
  it("remembers a 'yes' and loads GA4 once, however often it is called", () => {
    grantConsent();
    grantConsent();
    loadAnalytics();
    expect(readConsent()).toBe("granted");
    expect(typeof w.gtag).toBe("function");
    expect(gaTags()).toHaveLength(1);
  });

  it("remembers a 'no', loads nothing, and stops a GA4 that was already running", () => {
    declineConsent();
    expect(readConsent()).toBe("denied");
    expect(w.gtag).toBeUndefined();
    expect(gaTags()).toHaveLength(0);
    expect(w[`ga-disable-${ID}`]).toBe(true);
  });

  it("removes GA's cookies on a 'no'", () => {
    document.cookie = "_ga=GA1.1.123; path=/";
    document.cookie = "_ga_LLSYPMGV58=GS1.1.456; path=/";
    document.cookie = "theme=dark; path=/";
    declineConsent();
    expect(document.cookie).not.toMatch(/_ga/);
    expect(document.cookie).toContain("theme=dark");
  });

  it("forgets the choice and asks again from the footer", () => {
    window.localStorage.setItem(CONSENT_KEY, "granted");
    let asked = 0;
    const listen = () => (asked += 1);
    window.addEventListener(CONSENT_REOPEN_EVENT, listen);
    reopenConsent();
    window.removeEventListener(CONSENT_REOPEN_EVENT, listen);
    expect(readConsent()).toBeNull();
    expect(asked).toBe(1);
  });

  it("reads an unknown or unreadable value as no choice", () => {
    window.localStorage.setItem(CONSENT_KEY, "maybe");
    expect(readConsent()).toBeNull();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    expect(readConsent()).toBeNull();
    expect(() => grantConsent()).not.toThrow();
  });
});

describe("a 'no' stays a 'no' (security review of #311)", () => {
  it("covers the registrable domain of a three-label host, which the last two labels miss", () => {
    expect(cookieDomains("www.govari-fin.co.il")).toEqual(["", ".www.govari-fin.co.il", ".govari-fin.co.il", ".co.il"]);
    expect(cookieDomains("govari-fin.co.il")).toContain(".govari-fin.co.il");
    expect(cookieDomains("localhost")).toEqual([""]);
  });

  it("removes gtag on a 'no', so track() has nothing to send through", () => {
    grantConsent();
    expect(typeof w.gtag).toBe("function");
    declineConsent();
    expect(w.gtag).toBeUndefined();
    expect(w[`ga-disable-${ID}`]).toBe(true);
  });

  it("is withheld with the flag on until a 'yes', and never with it off", () => {
    expect(analyticsWithheld(true)).toBe(true);
    window.localStorage.setItem(CONSENT_KEY, "denied");
    expect(analyticsWithheld(true)).toBe(true);
    window.localStorage.setItem(CONSENT_KEY, "granted");
    expect(analyticsWithheld(true)).toBe(false);
    window.localStorage.removeItem(CONSENT_KEY);
    expect(analyticsWithheld(false)).toBe(false);
  });

  it("with the flag on, a route change after a 'no' or a reopen keeps GA4 off; a 'yes' lifts it", async () => {
    vi.stubEnv("VITE_GA_CONSENT", "true");
    vi.resetModules();
    try {
      const consent = await import("@/lib/consent");
      const { measureRoute } = await import("@/lib/analytics");
      consent.grantConsent();
      measureRoute("/");
      expect(w[`ga-disable-${ID}`]).toBe(false);
      consent.declineConsent();
      measureRoute("/blog");
      expect(w[`ga-disable-${ID}`]).toBe(true);
      consent.grantConsent();
      expect(w[`ga-disable-${ID}`]).toBe(false);
      consent.reopenConsent();
      expect(w[`ga-disable-${ID}`]).toBe(true);
      measureRoute("/");
      expect(w[`ga-disable-${ID}`]).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it("with the flag off, measureRoute is what it was: off on /admin only", async () => {
    const { measureRoute } = await import("@/lib/analytics");
    measureRoute("/");
    expect(w[`ga-disable-${ID}`]).toBe(false);
    measureRoute("/admin/leads");
    expect(w[`ga-disable-${ID}`]).toBe(true);
  });
});
