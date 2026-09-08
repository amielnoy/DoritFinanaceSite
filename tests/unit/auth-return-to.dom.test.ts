/**
 * @vitest-environment jsdom
 *
 * safeReturnTo() is the app's open-redirect guard for ?returnTo= on the auth
 * pages. It is security-sensitive, so it gets adversarial coverage.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { safeReturnTo } from "@/lib/authReturnTo";

const withSearch = (search: string) => {
  window.history.replaceState({}, "", `/login${search}`);
};

beforeEach(() => withSearch(""));

describe("safeReturnTo — happy path", () => {
  it("defaults to / when no returnTo is present", () => {
    expect(safeReturnTo()).toBe("/");
  });

  it("keeps a plain same-origin path", () => {
    withSearch("?returnTo=%2Fadmin%2Fleads");
    expect(safeReturnTo()).toBe("/admin/leads");
  });

  it("keeps normal app query params on the target path", () => {
    withSearch("?returnTo=%2Fblog%3Fpage%3D2");
    expect(safeReturnTo()).toBe("/blog?page=2");
  });

  it("accepts an absolute same-origin URL and reduces it to a path", () => {
    withSearch(`?returnTo=${encodeURIComponent(`${window.location.origin}/claims`)}`);
    expect(safeReturnTo()).toBe("/claims");
  });
});

describe("safeReturnTo — open-redirect attempts are neutralised", () => {
  const hostile = [
    "https://evil.com/",
    "//evil.com",
    "/\\evil.com",
    "/.//evil.com",
    "\\/evil.com",
    "javascript:alert(1)",
    "http://evil.com/steal",
    "//evil.com/%2f..",
  ];

  for (const raw of hostile) {
    it(`rejects ${JSON.stringify(raw)}`, () => {
      withSearch(`?returnTo=${encodeURIComponent(raw)}`);
      const out = safeReturnTo();
      expect(out).toBe("/");
    });
  }

  it("never returns a value that could become protocol-relative", () => {
    for (const raw of hostile) {
      withSearch(`?returnTo=${encodeURIComponent(raw)}`);
      const out = safeReturnTo();
      expect(out.startsWith("/")).toBe(true);
      expect(out.startsWith("//")).toBe(false);
      expect(out).not.toContain("\\");
      expect(out).not.toMatch(/^[a-z]+:/i);
    }
  });
});

describe("safeReturnTo — bootstrap params are stripped", () => {
  const stripped = [
    "access_token",
    "clear_access_token",
    "app_id",
    "app_base_url",
    "functions_version",
    "from_url",
  ];

  for (const param of stripped) {
    it(`drops ?${param}= so it cannot be re-injected through the redirect`, () => {
      withSearch(`?returnTo=${encodeURIComponent(`/?${param}=pwned`)}`);
      expect(safeReturnTo()).not.toContain(param);
    });
  }

  it("strips the bootstrap params but preserves the rest of the query", () => {
    withSearch(
      `?returnTo=${encodeURIComponent("/oauth/consent?ctx=abc123&access_token=pwned")}`
    );
    const out = safeReturnTo();
    expect(out).toContain("ctx=abc123");
    expect(out).not.toContain("access_token");
  });
});
