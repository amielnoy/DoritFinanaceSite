import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENCY_CONTENT_TABLES } from "../../src/services/supabase/agency-content-tables";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * R4: the prerender stays on the bundled agency-1 constants. A build that let
 * the agency-content reads through would bake whatever the database said at
 * build time into the HTML a crawler reads, for every domain — so the
 * prerender refuses those three reads, and the page renders its fallback.
 */
const SCRIPT = readFileSync(join(REPO_ROOT, "scripts/prerender.mjs"), "utf8");
const code = SCRIPT.split("\n")
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join("\n");

describe("CTR-AGC-020: the prerender refuses the agency-content reads", () => {
  it("imports the table list from the adapter's erasable module", () => {
    expect(code).toMatch(
      /import\s*\{\s*AGENCY_CONTENT_TABLES\s*\}\s*from\s*['"]\.\.\/src\/services\/supabase\/agency-content-tables\.ts['"]/,
    );
    expect(AGENCY_CONTENT_TABLES).toEqual(["public_agency_sites", "public_agent_cards", "success_cases"]);
  });

  it("aborts every request for those tables", () => {
    expect(code).toMatch(
      /page\.route\(\s*\(url\)\s*=>\s*AGENCY_CONTENT_TABLES\.some\(\(t\)\s*=>\s*url\.pathname\s*===\s*`\/rest\/v1\/\$\{t\}`\)\s*,\s*\(r\)\s*=>\s*r\.abort\(['"]blockedbyclient['"]\)/,
    );
  });

  it("registers the abort after serveFixtureSupabase, so Playwright tries it first", () => {
    const serve = code.lastIndexOf("await serveFixtureSupabase(page");
    const abort = code.indexOf("AGENCY_CONTENT_TABLES.some(");
    expect(serve).toBeGreaterThan(-1);
    expect(abort).toBeGreaterThan(serve);
  });
});
