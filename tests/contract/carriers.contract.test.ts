import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { read } from "../helpers/source-scan";

/**
 * The carrier logo strip.
 *
 * Four of the eight links have now been wrong, in two different ways, and both
 * ways are invisible from the code: the domain looks like the company's name,
 * so nobody re-reads it.
 *
 *   phoenix.co.il        → no such host          (fixed in 6d899c3)
 *   menoramivtachim.co.il→ no such host
 *   ayalon.co.il         → no such host
 *   harel.co.il          → 301 to a login portal
 *
 * The last is the nastier kind: it resolves, it returns 200, and a smoke test
 * that only checked for a live response would have passed it. It simply sends a
 * visitor who wanted to read about an insurer to a sign-in form instead.
 *
 * These tests do not make network calls — CI must stay hermetic, and a test
 * that fails when someone else's DNS has a bad afternoon is a test people learn
 * to ignore. They pin the domains that were verified by hand, and fail if an
 * edit reaches for the obvious-looking name again.
 */

const source = read(join(REPO_ROOT, "src/components/dorit/primitives/CarrierLogos.tsx"));

const carriers = [...source.matchAll(/\{\s*he:\s*"([^"]+)",\s*en:\s*"([^"]+)",\s*url:\s*"([^"]+)"\s*\}/g)].map(
  (m) => ({ he: m[1], en: m[2], url: m[3] }),
);

/** Hosts checked by hand and found not to serve the insurer's own site. */
const KNOWN_BAD: Record<string, string> = {
  "www.phoenix.co.il": "does not resolve — the insurer is at fnx.co.il",
  "phoenix.co.il": "does not resolve — the insurer is at fnx.co.il",
  "www.menoramivtachim.co.il": "no A record — the insurer is at menoramivt.co.il",
  "menoramivtachim.co.il": "no A record — the insurer is at menoramivt.co.il",
  "www.ayalon.co.il": "no A record — the insurer is at ayalon-ins.co.il",
  "ayalon.co.il": "no A record — the insurer is at ayalon-ins.co.il",
  "www.harel.co.il": "301s to oneharel.co.il, the customer login portal",
  "harel.co.il": "301s to oneharel.co.il, the customer login portal",
  "www.oneharel.co.il": "the customer login portal, not the insurer's site",
  "oneharel.co.il": "the customer login portal, not the insurer's site",
};

describe("the carrier logo strip", () => {
  it("lists the eight carriers the section is built around", () => {
    expect(carriers).toHaveLength(8);
  });

  it("names every carrier in both Hebrew and English", () => {
    for (const c of carriers) {
      expect(c.he.length, JSON.stringify(c)).toBeGreaterThan(0);
      expect(c.en.length, JSON.stringify(c)).toBeGreaterThan(0);
    }
  });

  it("points every logo at a host that was actually checked", () => {
    for (const c of carriers) {
      const host = new URL(c.url).host;
      expect(KNOWN_BAD[host], `${c.he} → ${host}: ${KNOWN_BAD[host]}`).toBeUndefined();
    }
  });

  it("links over https, never plaintext", () => {
    for (const c of carriers) {
      expect(new URL(c.url).protocol, c.he).toBe("https:");
    }
  });

  it("sends no two carriers to the same place", () => {
    const hosts = carriers.map((c) => new URL(c.url).host);
    expect(new Set(hosts).size, `duplicate host among ${hosts.join(", ")}`).toBe(hosts.length);
  });

  it("opens them safely, since every one leaves the site", () => {
    expect(source).toMatch(/target="_blank"/);
    expect(source).toMatch(/rel="noopener noreferrer"/);
  });
});
