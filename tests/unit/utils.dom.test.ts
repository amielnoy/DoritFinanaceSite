/**
 * @vitest-environment jsdom
 *
 * jsdom is required only because src/lib/utils.js touches `window` at module
 * scope (`isIframe`); cn() itself is pure.
 */
import { describe, expect, it } from "vitest";
import { createPageUrl } from "@/utils";
import { cn } from "@/lib/utils";

describe("createPageUrl", () => {
  it("prefixes a leading slash", () => {
    expect(createPageUrl("Home")).toBe("/Home");
  });

  it("turns spaces into hyphens so page names stay URL-safe", () => {
    expect(createPageUrl("Blog Admin")).toBe("/Blog-Admin");
    expect(createPageUrl("a b c")).toBe("/a-b-c");
  });

  it("handles the empty name without producing a double slash", () => {
    expect(createPageUrl("")).toBe("/");
  });
});

describe("cn", () => {
  it("joins conditional class names", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });

  it("lets the later Tailwind class win a conflict", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-foreground", "text-accent")).toBe("text-accent");
  });

  it("returns an empty string for no input", () => {
    expect(cn()).toBe("");
  });
});
