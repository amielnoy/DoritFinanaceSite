// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConsentBanner from "@/components/dorit/layout/ConsentBanner";
import { CONSENT_KEY, reopenConsent } from "@/lib/consent";

/*
 * The question before Google Analytics (VITE_GA_CONSENT; src/lib/consent.ts):
 * nothing with the flag off, the card until the visitor chooses, equal
 * choices, never on /admin, and back from the footer's link. The privacy
 * policy's line rides on the same flag.
 */

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

type W = Window & { gtag?: unknown } & Record<string, unknown>;
const w = window as unknown as W;
const gaTags = () => document.querySelectorAll('script[src^="https://www.googletagmanager.com/gtag/js"]');

const show = (enabled: boolean, path = "/") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ConsentBanner enabled={enabled} />
    </MemoryRouter>,
  );

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  delete w.gtag;
  document.head.innerHTML = "";
});

afterEach(() => {
  delete w.gtag;
  document.head.innerHTML = "";
});

describe("ConsentBanner", () => {
  it("renders nothing with the flag off, and loads nothing", () => {
    const { container } = show(false);
    expect(container).toBeEmptyDOMElement();
    expect(gaTags()).toHaveLength(0);
  });

  it("asks a visitor who has not chosen, with both choices the same size, and loads nothing yet", () => {
    show(true);
    const dialog = screen.getByRole("dialog", { name: "סטטיסטיקה אנונימית" });
    expect(dialog.textContent).toContain("Google Analytics");
    expect(dialog.textContent).toContain("בלי שם, טלפון או מייל");
    const yes = screen.getByRole("button", { name: "אישור" });
    const no = screen.getByRole("button", { name: "לא, תודה" });
    // ctaClass's size classes, minus the fill: neither choice is smaller or hidden.
    const size = (el: HTMLElement) => el.className.split(" ").filter((c) => /^(min-h-|px-|text-(lg|xl)|flex-1|md:flex-none)/.test(c)).sort();
    expect(size(no)).toEqual(size(yes));
    expect(screen.getByRole("link", { name: "מדיניות הפרטיות" }).getAttribute("href")).toBe("/privacy");
    expect(w.gtag).toBeUndefined();
    expect(gaTags()).toHaveLength(0);
  });

  it("'אישור' remembers it, loads GA4 and closes", () => {
    show(true);
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe("granted");
    expect(typeof w.gtag).toBe("function");
    expect(gaTags()).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("'לא, תודה' remembers it, loads nothing and closes", () => {
    show(true);
    fireEvent.click(screen.getByRole("button", { name: "לא, תודה" }));
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe("denied");
    expect(w.gtag).toBeUndefined();
    expect(gaTags()).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not ask again once chosen, until the footer's link asks for it", () => {
    window.localStorage.setItem(CONSENT_KEY, "denied");
    show(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => reopenConsent());
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("never shows on /admin, which is never measured", () => {
    show(true, "/admin/leads");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the footer's link and the privacy policy's line ride on the flag", () => {
  vi.mock("@/components/dorit/layout/FloatingHeader", () => ({ default: () => null }));
  vi.mock("@/components/dorit/primitives/CredentialsStrip", () => ({ default: () => null }));

  async function withFlag(on: boolean) {
    vi.resetModules();
    vi.doMock("@/lib/consent", async (orig) => ({ ...(await orig<object>()), GA_CONSENT: on }));
    const { default: PrivacyPolicy } = await import("@/pages/PrivacyPolicy");
    render(
      <MemoryRouter>
        <PrivacyPolicy />
      </MemoryRouter>,
    );
  }

  afterEach(() => vi.doUnmock("@/lib/consent"));

  it("off: no line about Google Analytics and no 'הגדרות עוגיות'", async () => {
    await withFlag(false);
    expect(document.body.textContent).not.toContain("Google Analytics");
    expect(screen.queryByRole("button", { name: "הגדרות עוגיות" })).toBeNull();
  });

  it("on: the line says what is measured, what is not sent, the cookies, and how to change it", async () => {
    await withFlag(true);
    const text = document.body.textContent!.replace(/\s+/g, " ");
    expect(text).toContain("רק אם אישרת זאת בהודעה שהאתר מציג");
    expect(text).toContain("לא נשלחים שם, טלפון, מייל או תוכן של טופס");
    expect(text).toContain("עוגיות למדידה");
    expect(text).toContain("בלי אישור הכלי אינו נטען כלל");
    expect(screen.getByRole("button", { name: "הגדרות עוגיות" })).toBeTruthy();
  });
});
