import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
// @ts-expect-error — plain .mjs tooling.
import { fallbackSlug } from "../../scripts/fallback-slug.mjs";

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

  it("gives an imported article a fallback slug, and never overwrites one already set", () => {
    const dir = mkdtempSync(join(tmpdir(), "backfill-"));
    const file = join(dir, "export.json");
    writeFileSync(
      file,
      JSON.stringify({
        BlogPost: [{ id: "64F0a1b2c3d4e5f6a7b8c9d0", title: "t", body: "b", published: true, created_date: "2026-10-01T00:00:00Z" }],
      }),
    );
    const r = node(["scripts/backfill-from-base44.mjs", file]);
    rmSync(dir, { recursive: true, force: true });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/insert into public\.blog_posts \([^)]*\bslug\b/);
    expect(r.stdout).toContain("'post-64f0a1b2c3d4e5f6a7b8c9d0'");
    expect(r.stdout).not.toMatch(/slug = excluded\.slug/);
  });
});

describe("the backfill's fallback slug", () => {
  const UUID = "11111111-2222-3333-4444-555555555555";
  // What blog_posts_fallback_slug(base44_id, id) returns for each input,
  // worked out from its SQL: lower(), runs of [^a-z0-9] -> '-', trim '-',
  // else the uuid.
  const cases: Array<[string, string]> = [
    ["64F0a1b2c3d4e5f6a7b8c9d0", "post-64f0a1b2c3d4e5f6a7b8c9d0"],
    ["ABC", "post-abc"],
    ["b44_new--id", "post-b44-new-id"],
    ["__lead__x__", "post-lead-x"],
    ["a!!!b???c", "post-a-b-c"],
    ["!!!", `post-${UUID}`],
    ["", `post-${UUID}`],
    ["---", `post-${UUID}`],
    ["אבג-7", "post-7"],
  ];

  it.each(cases)("turns %j into what the migration's SQL does", (id, expected) => {
    expect(fallbackSlug(id, UUID)).toBe(expected);
  });

  it("refuses to invent an address from nothing", () => {
    expect(() => fallbackSlug("!!!")).toThrow(/no id/);
  });

  it("is spelled the way the migration spells it", () => {
    const sql = readFileSync(join(REPO_ROOT, "supabase/migrations/20261014000000_blog_slug.sql"), "utf8");
    const fn = sql.slice(sql.indexOf("function public.blog_posts_fallback_slug"), sql.indexOf("blog_posts_fill_slug"));
    expect(fn).toContain("regexp_replace(lower(coalesce(p_base44_id, '')), '[^a-z0-9]+', '-', 'g')");
    expect(fn).toContain("trim(both '-' from");
    expect(fn).toContain("'post-' ||");
    expect(fn).toContain("p_id::text");
  });
});
