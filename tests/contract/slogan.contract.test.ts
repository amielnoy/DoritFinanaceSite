import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * One slogan everywhere a visitor reads it.
 *
 * "התכנון שלי — הרווח שלך" implied a promise of profit, and the site moved to
 * "התכנון שלי — השקט שלך" (#110) — but the confirmation mails are built by the
 * backend functions, which that change did not reach, so every visitor kept
 * receiving the old line. This scans everything that ships, not just the site.
 */
const SHIPPED = ["src", "base44", "public", "index.html", "dorit-mailer"];
const TEXT = /\.(tsx?|jsx?|mjs|html|txt|md|json|jsonc|css)$/;

function files(path: string): string[] {
  const abs = join(REPO_ROOT, path);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return [];
  }
  if (st.isFile()) return TEXT.test(abs) ? [abs] : [];
  return readdirSync(abs)
    .filter((n) => n !== "node_modules")
    .flatMap((n) => files(join(path, n)));
}

describe("the slogan", () => {
  it("never promises profit anywhere a visitor reads it", () => {
    const hits = SHIPPED.flatMap(files)
      .filter((f) => readFileSync(f, "utf8").includes("הרווח שלך"))
      .map((f) => relative(REPO_ROOT, f));
    expect(hits).toEqual([]);
  });

  it("says the current one in the mails a visitor receives", () => {
    for (const fn of ["submitLead", "submitClaim"]) {
      const src = readFileSync(join(REPO_ROOT, "base44/functions", fn, "entry.ts"), "utf8");
      expect(src, fn).toContain("התכנון שלי — השקט שלך");
    }
  });
});
