// Runs in the default node environment on purpose: no jsdom, no `window`.
import { describe, expect, it } from "vitest";
import { cn, isIframe } from "@/lib/utils";

describe("src/lib/utils outside a browser", () => {
  it("has no window in this environment", () => {
    expect(typeof window).toBe("undefined");
  });

  it("loads and cn() merges classes", () => {
    expect(cn("px-2", "px-4", false && "x")).toBe("px-4");
  });

  it("reports isIframe as false when there is no window", () => {
    expect(isIframe).toBe(false);
  });
});
