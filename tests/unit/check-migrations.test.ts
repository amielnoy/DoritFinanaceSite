import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs script
import { migrationDrift } from "../../scripts/check-migrations.mjs";

/* scripts/check-migrations.mjs: production's migration history against the repository (Architecture N-05). */

const LISTING = `
  Local          | Remote         | Time (UTC)
  ---------------|----------------|---------------------
   20261019000000 | 20261019000000 | 2026-10-19 00:00:00
   20261020000000 |                | 2026-10-20 00:00:00
   20261021000000 |                | 2026-10-21 00:00:00
   20261024000000 | 20261024000000 | 2026-10-24 00:00:00
                  | 20260101000000 | 2026-01-01 00:00:00
`;

const run = (listing: string) => {
  const file = join(mkdtempSync(join(tmpdir(), "mig-")), "list.txt");
  writeFileSync(file, listing);
  try {
    return { code: 0, out: execFileSync("node", ["scripts/check-migrations.mjs", file], { encoding: "utf8" }) };
  } catch (e) {
    const err = e as { status: number; stdout: string };
    return { code: err.status, out: err.stdout };
  }
};

describe("the migration history check", () => {
  it("finds what the repository has and production does not, and the reverse", () => {
    expect(migrationDrift(LISTING)).toEqual({
      rows: 5,
      missingInProduction: ["20261020000000", "20261021000000"],
      unknownToRepository: ["20260101000000"],
    });
  });

  it("fails the run on a migration missing from production, naming it and the fix", () => {
    const { code, out } = run(LISTING);
    expect(code).toBe(1);
    expect(out).toMatch(/::error::2 migration\(s\) in the repository are not applied in production: 20261020000000, 20261021000000/);
    expect(out).toMatch(/migration repair --status applied/);
    expect(out).toMatch(/::warning::Production has migration 20260101000000/);
  });

  it("passes when every migration is applied", () => {
    const { code, out } = run("   20261024000000 | 20261024000000 | 2026-10-24 00:00:00\n");
    expect(code).toBe(0);
    expect(out).toMatch(/All 1 migrations in the repository are applied in production/);
  });

  it("warns, not fails, on a listing with no rows", () => {
    const { code, out } = run("Connecting to remote database...\n");
    expect(code).toBe(0);
    expect(out).toMatch(/::warning::The migration listing had no rows/);
  });
});
