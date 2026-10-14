/**
 * @vitest-environment jsdom
 *
 * ?clear_access_token=true must wipe the stored tokens at boot, on every route
 * (SEC-TOK-002). It used to depend on the lazily loaded SDK, so a visit that
 * never called a backend port kept a stale token indefinitely.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAccessTokenIfRequested } from "@/lib/clear-access-token";

// This jsdom build has no localStorage (see analytics.dom.test.ts), so a
// Map-backed stand-in plays it.
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

const at = (url: string) => window.history.replaceState({}, "", url);
const seed = () => {
  localStorage.setItem("base44_access_token", "stale-token");
  localStorage.setItem("token", "stale-token");
};

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  at("/");
});
afterEach(() => vi.restoreAllMocks());

describe("clearAccessTokenIfRequested", () => {
  it("wipes both token keys when the flag is set", () => {
    seed();
    at("/faq?clear_access_token=true");
    expect(clearAccessTokenIfRequested()).toBe(true);
    expect([localStorage.getItem("base44_access_token"), localStorage.getItem("token")]).toEqual([null, null]);
  });

  it("leaves unrelated storage alone", () => {
    seed();
    localStorage.setItem("sb-project-auth-token", "supabase-session");
    at("/?clear_access_token=true");
    clearAccessTokenIfRequested();
    expect(localStorage.getItem("sb-project-auth-token")).toBe("supabase-session");
  });

  it("removes only the flag from the URL, keeping the path, other params and hash", () => {
    at("/blog/x?access_token=new&clear_access_token=true&utm_source=mail#faq");
    clearAccessTokenIfRequested();
    expect(`${location.pathname}${location.search}${location.hash}`).toBe(
      "/blog/x?access_token=new&utm_source=mail#faq",
    );
  });

  it("drops the `?` when the flag was the only parameter", () => {
    at("/tools?clear_access_token=true");
    clearAccessTokenIfRequested();
    expect(`${location.pathname}${location.search}`).toBe("/tools");
  });

  it.each(["", "?clear_access_token=false", "?clear_access_token=1", "?clear_access_token="])(
    "does nothing for %j",
    (search) => {
      seed();
      at(`/${search}`);
      expect(clearAccessTokenIfRequested()).toBe(false);
      expect(localStorage.getItem("token")).toBe("stale-token");
      expect(location.search).toBe(search);
    },
  );

  it("strips the flag from a path that starts with // without leaving the origin", () => {
    // Relative, `//evil.example/x` would be protocol-relative — another origin,
    // which replaceState refuses with a SecurityError. Set it absolute.
    const origin = location.origin;
    seed();
    at(`${origin}//evil.example/x?clear_access_token=true`);
    expect(location.pathname).toBe("//evil.example/x");
    expect(clearAccessTokenIfRequested()).toBe(true);
    expect(location.origin).toBe(origin);
    expect(`${location.pathname}${location.search}`).toBe("//evil.example/x");
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("still wipes, and does not throw, when replaceState throws", () => {
    seed();
    at("/?clear_access_token=true");
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => clearAccessTokenIfRequested()).not.toThrow();
    expect([localStorage.getItem("base44_access_token"), localStorage.getItem("token")]).toEqual([null, null]);
  });

  it("still removes the flag when storage throws", () => {
    vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    at("/?clear_access_token=true");
    expect(clearAccessTokenIfRequested()).toBe(true);
    expect(location.search).toBe("");
  });
});
