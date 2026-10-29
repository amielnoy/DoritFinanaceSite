import { describe, expect, it } from "vitest";
import { normalizeHost } from "@/lib/host";

// Moved from legacy-host.test.ts (SEO-OLD-001, SEO-OLD-002): the normalisation
// those cases leaned on, now asserted directly.
describe("normalizeHost", () => {
  it("lower-cases and drops a trailing dot", () => {
    expect(normalizeHost("B.Example.")).toBe("b.example");
    expect(normalizeHost("  GOVARI-FIN.co.il.. ")).toBe("govari-fin.co.il");
  });

  it("reads the hostname out of a URL", () => {
    expect(normalizeHost("https://a.example/")).toBe("a.example");
    expect(normalizeHost("https://A.Example:8080/x?y#z")).toBe("a.example");
  });

  it("returns an empty string for an unparseable URL or an empty value", () => {
    expect(normalizeHost("http://")).toBe("");
    expect(normalizeHost("")).toBe("");
  });
});
