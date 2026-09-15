import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { read } from "../helpers/source-scan";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * What an AI assistant reads, and whether it is true.
 *
 * This app is client-rendered: `useSeo` writes the title, description and
 * JSON-LD at runtime, so a crawler that does not execute JavaScript receives
 * the home page's `<head>` on every route. Google renders JS and recovers.
 * GPTBot, ClaudeBot, PerplexityBot and CCBot largely do not — which makes
 * `public/llms.txt` the only surface on this site that an AI assistant can
 * reliably read, and therefore the one most worth keeping honest.
 *
 * It was not honest. It published `052-707-7776` and `doritg@fsfp-fin.co.il`
 * while every other surface — the footer, the JSON-LD, the escalation fallback,
 * `src/config/contact.js` — had moved to `050-831-1776` and
 * `dorit@govari-fin.co.il`. Nothing failed, because nothing read it: a static
 * file in `public/` is invisible to the type-checker and to every other suite.
 * The one visible symptom would have been an assistant handing a prospect a
 * phone number that does not reach her.
 */

const LLMS = read(join(REPO_ROOT, "public/llms.txt"));
const ROBOTS = read(join(REPO_ROOT, "public/robots.txt"));
const SITEMAP = read(join(REPO_ROOT, "public/sitemap.xml"));
const CONTACT = read(join(REPO_ROOT, "src/config/contact.js"));

/** The values `src/config/contact.js` actually exports. */
function contactValue(key: string): string {
  const m = CONTACT.match(new RegExp(`${key}:\\s*'([^']+)'`));
  expect(m, `contact.js exports no ${key}`).not.toBeNull();
  return m![1];
}

describe("llms.txt — the surface an AI assistant can actually read", () => {
  it("publishes the phone number the rest of the site publishes", () => {
    expect(LLMS, "llms.txt disagrees with src/config/contact.js").toContain(
      contactValue("phoneDisplay"),
    );
  });

  it("publishes the email the rest of the site publishes", () => {
    expect(LLMS).toContain(contactValue("email"));
  });

  it("publishes the WhatsApp number the rest of the site publishes", () => {
    expect(LLMS).toContain(contactValue("whatsapp"));
  });

  it("carries no address the site has stopped using", () => {
    // The specific pair that was stale. A future rename should trip this too,
    // so the check is "every address in the file is the canonical one".
    const addresses = [...LLMS.matchAll(/[a-z0-9._%-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)].map((m) =>
      m[0].toLowerCase(),
    );
    for (const address of new Set(addresses)) {
      expect(address, `unexpected address in llms.txt: ${address}`).toBe(contactValue("email"));
    }
  });

  it("carries no phone number the site has stopped using", () => {
    const numbers = [...LLMS.matchAll(/0\d{2}-\d{3}-\d{4}/g)].map((m) => m[0]);
    for (const number of new Set(numbers)) {
      expect(number, `unexpected number in llms.txt: ${number}`).toBe(contactValue("phoneDisplay"));
    }
  });

  it("states the licence number, because that is what makes the rest checkable", () => {
    expect(LLMS).toMatch(/L-00107009/);
  });

  it("discloses the affiliation rather than claiming objective advice", () => {
    // The same disclosure the agents are required to make. An assistant
    // summarising this file must not be able to call the service "ייעוץ
    // פנסיוני אובייקטיבי", because it is not.
    expect(LLMS).toMatch(/שיווק פנסיוני ולא ייעוץ פנסיוני/);
    expect(LLMS).toMatch(/זיקה לגופים מוסדיים/);
  });

  it("says what the automated helpers will not do", () => {
    // An assistant asked "can her bot tell me which pension fund to pick?"
    // should be able to answer from this file, correctly.
    expect(LLMS).toMatch(/אוספים מידע ואינם מייעצים/);
  });

  it("promises no return, saving or approved claim", () => {
    expect(LLMS).not.toMatch(/מבטיח|תשואה מובטחת|חיסכון מובטח/);
  });

  it("lists every public route the sitemap advertises", () => {
    // The two drift in opposite directions: a new page reaches the sitemap
    // because SEO tests ask for it, and is forgotten here because nothing does.
    const paths = [...SITEMAP.matchAll(/<loc>[^<]*?(\/[^<]*)?<\/loc>/g)]
      .map((m) => (m[1] ?? "/").replace(/^https?:\/\/[^/]+/, ""))
      .map((p) => (p === "" ? "/" : p));
    for (const path of new Set(paths)) {
      if (path === "/") continue;
      expect(LLMS, `llms.txt does not link ${path}`).toContain(path);
    }
  });
});

describe("robots.txt — who is allowed to read it", () => {
  const AI_AGENTS = [
    "GPTBot",
    "OAI-SearchBot",
    "ChatGPT-User",
    "ClaudeBot",
    "Claude-User",
    "Claude-SearchBot",
    "PerplexityBot",
    "Google-Extended",
    "CCBot",
  ];

  it("names each AI crawler explicitly rather than leaving it to the wildcard", () => {
    // Stated, not inferred: the wildcard's meaning for AI training is contested,
    // and an explicit rule is what an auditor needs to see.
    for (const agent of AI_AGENTS) {
      expect(ROBOTS, `robots.txt does not mention ${agent}`).toMatch(
        new RegExp(`User-agent:\\s*${agent}`, "i"),
      );
    }
  });

  it("allows them, and disallows none of them by accident", () => {
    for (const agent of AI_AGENTS) {
      const block = ROBOTS.slice(ROBOTS.indexOf(`User-agent: ${agent}`));
      const rule = block.split(/\n\s*\n/)[0];
      expect(rule, `${agent} is disallowed`).not.toMatch(/Disallow:\s*\//);
      expect(rule, `${agent} has no Allow rule`).toMatch(/Allow:\s*\//);
    }
  });

  it("keeps the private routes out for everyone", () => {
    for (const path of ["/admin/", "/login", "/register"]) {
      expect(ROBOTS).toContain(`Disallow: ${path}`);
    }
  });

  it("still points at the sitemap", () => {
    expect(ROBOTS).toMatch(/^Sitemap: https?:\/\/\S+\/sitemap\.xml$/m);
  });
});
