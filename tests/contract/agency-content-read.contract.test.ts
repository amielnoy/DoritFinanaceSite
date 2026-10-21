import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
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

/**
 * Task 6: the public chrome and pages read contact and licence from the hook.
 * The files below keep the bundled contact on purpose — the error screen must
 * not wait on a query, the flows' mail still goes to _shared/recipients.ts's
 * fixed addresses until Rollout 5, and the rest is not React. Adding a reader
 * is a decision, so it starts here.
 */
const CONTACT_READERS = [
  "src/components/ErrorBoundary.tsx",
  "src/components/dorit/chat/AgentChat.tsx",
  "src/components/dorit/forms/NeedsWizard.tsx",
  "src/components/dorit/forms/QuickContact.tsx",
  "src/components/dorit/booking/OutlookCalendarBooking.tsx",
  "src/components/dorit/account/SnapshotView.tsx",
  "src/hooks/useSubmission.ts",
  "src/lib/calculator-lead.ts",
  "src/lib/agency-content.ts",
  "src/services/fallback-contact.ts",
].sort();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? sourceFiles(p) : /\.(tsx?|jsx?)$/.test(e.name) ? [p] : [];
  });
}

const stripComments = (s: string) =>
  s
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

describe("CTR-AGC-021: only the listed files import the bundled contact", () => {
  it("the importers of @/config/contact are CONTACT_READERS, exactly", () => {
    const importers = sourceFiles(join(REPO_ROOT, "src"))
      .filter((f) => /from\s+["']@\/config\/contact["']/.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => relative(REPO_ROOT, f))
      .sort();
    expect(importers).toEqual(CONTACT_READERS);
  });
});

describe("CTR-AGC-022: no component or page hard-codes the licence number", () => {
  it("L-00107009 appears in no code line under src/components or src/pages", () => {
    const hits = [...sourceFiles(join(REPO_ROOT, "src/components")), ...sourceFiles(join(REPO_ROOT, "src/pages"))]
      .filter((f) => stripComments(readFileSync(f, "utf8")).includes("L-00107009"))
      .map((f) => relative(REPO_ROOT, f));
    expect(hits).toEqual([]);
  });
});
