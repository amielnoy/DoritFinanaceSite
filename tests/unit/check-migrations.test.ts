import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs script
import { localVersions, migrationDrift, remoteVersions } from "../../scripts/check-migrations.mjs";

/* scripts/check-migrations.mjs: production's migration history against the repository (Architecture N-05). */

const FILES = [
  "20261019000000_masleka_wipe_notice.sql",
  "20261020000000_blog_cta_og.sql",
  "20261021000000_clearinghouse_analysis.sql",
  "20261024000000_clearinghouse_publish.sql",
  "README.md",
];
const REMOTE = [
  { version: "20261019000000", name: "masleka_wipe_notice" },
  { version: "20261024000000", name: "clearinghouse_publish" },
  { version: "20260101000000", name: "from_elsewhere" },
];

const run = (remoteBody: string, files = FILES) => {
  const root = mkdtempSync(join(tmpdir(), "mig-"));
  const dir = join(root, "migrations");
  mkdirSync(dir);
  for (const f of files) writeFileSync(join(dir, f), "");
  const file = join(root, "remote.json");
  writeFileSync(file, remoteBody);
  try {
    return { code: 0, out: execFileSync("node", ["scripts/check-migrations.mjs", file, dir], { encoding: "utf8" }) };
  } catch (e) {
    const err = e as { status: number; stdout: string };
    return { code: err.status, out: err.stdout };
  }
};

describe("the migration history check", () => {
  it("finds what the repository has and production does not, and the reverse", () => {
    expect(migrationDrift(localVersions(FILES), remoteVersions(REMOTE))).toEqual({
      rows: 5,
      missingInProduction: ["20261020000000", "20261021000000"],
      unknownToRepository: ["20260101000000"],
    });
  });

  it("fails the run on a migration missing from production, naming it and the fix", () => {
    const { code, out } = run(JSON.stringify(REMOTE));
    expect(code).toBe(1);
    expect(out).toMatch(/::error::2 migration\(s\) in the repository are not applied in production: 20261020000000, 20261021000000/);
    expect(out).toMatch(/migration repair --status applied/);
    expect(out).toMatch(/::warning::Production has migration 20260101000000/);
  });

  it("passes when every migration is applied", () => {
    const { code, out } = run(JSON.stringify([{ version: "20261024000000" }]), ["20261024000000_clearinghouse_publish.sql"]);
    expect(code).toBe(0);
    expect(out).toMatch(/All 1 migrations in the repository are applied in production/);
  });

  it("warns, not fails, on an empty history", () => {
    const { code, out } = run("[]");
    expect(code).toBe(0);
    expect(out).toMatch(/::warning::Production's migration history had no rows/);
  });

  it("warns, not fails, on an answer that is not a list", () => {
    const { code, out } = run(JSON.stringify({ message: "Missing required permission(s): database_migrations_read" }));
    expect(code).toBe(0);
    expect(out).toMatch(/::warning::Production's migration history was not a list/);
  });
});
