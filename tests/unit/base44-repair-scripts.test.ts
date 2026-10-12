import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The two scripts that once copied Base44's leads into Supabase.
 *
 * Since claims and the admin's writes moved to Supabase, Base44's `Lead` copy
 * is stale by design: it lacks every claim, every status Dorit changed and
 * every lead she deleted — including one a visitor asked to have removed.
 * Run "the Base44 way", either script would undo her changes and bring those
 * leads back. Both must refuse to write leads.
 */

const node = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });

describe("reconcile-leads", () => {
  it.each([["--apply"], ["--apply", "--create-missing"]])("refuses %s before reading anything", (...flags) => {
    // No Supabase credentials and no Base44 CLI: the refusal has to come first.
    const r = node(["scripts/reconcile-leads.mjs", ...flags]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Supabase is the record/);
  });
});

describe("backfill-from-base44", () => {
  it("imports no leads from an export, whatever it holds", () => {
    const dir = mkdtempSync(join(tmpdir(), "backfill-"));
    const file = join(dir, "export.json");
    writeFileSync(
      file,
      JSON.stringify({
        Lead: [{ id: "b44-1", name: "x", phone: "050", status: "new", created_date: "2026-10-01T00:00:00Z" }],
        Testimonial: [{ id: "t1", name: "n", quote: "q", created_date: "2026-10-01T00:00:00Z" }],
      }),
    );
    const r = node(["scripts/backfill-from-base44.mjs", file]);
    rmSync(dir, { recursive: true, force: true });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/insert into (public\.)?leads/i);
    expect(r.stdout).toMatch(/testimonials/);
  });
});
