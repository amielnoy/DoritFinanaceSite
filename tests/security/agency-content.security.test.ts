import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * Review M-2: a visitor must not read who confirmed a reviewer's consent, or
 * when. The fix is column grants on testimonials (20261106100000), and column
 * grants break any reader that asks for `*` — PostgREST answers 42501. So
 * this holds both ends: no later migration hands the whole table back, and no
 * reader asks for all of it.
 */
const MIGRATIONS = join(REPO_ROOT, "supabase/migrations");
const strip = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
/** Every statement of every migration, in the order they apply. */
const statements = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .flatMap((file) =>
    strip(readFileSync(join(MIGRATIONS, file), "utf8"))
      .replace(/\s+/g, " ")
      .split(";")
      .map((s) => ({ file, text: s.trim().toLowerCase() })),
  );

/** A grant that gives anon or authenticated `select` on the whole testimonials table. */
function grantsWholeTable(stmt: string): boolean {
  const m = /^grant (.+?) on (?:table )?(.+?) to (.+)$/.exec(stmt);
  if (!m || !/\b(anon|authenticated)\b/.test(m[3])) return false;
  const reachesTestimonials =
    /\bpublic\.testimonials\b/.test(m[2]) || /^all tables in schema public\b/.test(m[2]);
  if (!reachesTestimonials) return false;
  // Top-level privileges only: `select (a, b)` is a column grant.
  const privileges = m[1].replace(/\s*\([^)]*\)/g, "(columns)").split(",").map((p) => p.trim());
  return privileges.some((p) => p === "select" || p === "all" || p === "all privileges");
}

const SOURCE_DIRS = ["src", "api", "scripts", "supabase/functions", "e2e", "base44/functions"];
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
function walk(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : walk(full);
    return SOURCE_EXT.has(extname(name)) ? [full] : [];
  });
}
const SOURCES = SOURCE_DIRS.flatMap((d) => walk(join(REPO_ROOT, d))).sort();

/**
 * Readers that name testimonials only as one of several tables and ask for `*`
 * with the service-role key, which keeps its table-level grant
 * (20260922000000_service_role_grants.sql). Each must hold that key.
 */
const SERVICE_ROLE_READERS: Record<string, string> = {
  "scripts/reconcile-stores.mjs": "compares Base44 and Supabase row by row, as service_role",
};

const STAR = /select=\*|\.select\(\s*\)|\.select\(\s*["'`]\*["'`]|\bselect["']?\s*:\s*["'`]\*["'`]/;

/** Each way `code` reads testimonials without naming its columns. */
function starReads(name: string, code: string): string[] {
  const bad: string[] = [];
  // A supabase-js chain on the table, up to the end of its statement.
  for (const m of code.matchAll(/\.from\(\s*["'`]testimonials["'`]\s*\)/g)) {
    const rest = code.slice(m.index! + m[0].length);
    const chain = rest.slice(0, rest.search(/;|\n\s*\n|$/));
    if (!/\.select\(/.test(chain) || STAR.test(chain)) bad.push(`${name}: from("testimonials") without a column list`);
  }
  // A REST path on the table.
  if (/testimonials[^\s"'`]*[?&]select=\*/.test(code)) bad.push(`${name}: testimonials?select=*`);
  // A generic reader handed the table's name.
  if (/["'`/]testimonials\b/.test(code) && STAR.test(code)) {
    if (!(name in SERVICE_ROLE_READERS)) bad.push(`${name}: names testimonials and selects *`);
    else if (!code.includes("SUPABASE_SERVICE_ROLE_KEY")) bad.push(`${name}: selects * without the service-role key`);
  }
  return bad;
}

describe("testimonials' consent stamp stays private (review M-2)", () => {
  it("is never re-granted whole to visitors or members after the revoke (SEC-AGC-001)", () => {
    const last = statements.map((s) => s.text).lastIndexOf("revoke select on public.testimonials from anon, authenticated");
    expect(last, "no migration revokes the table-level read").toBeGreaterThanOrEqual(0);
    const regrants = statements.slice(last + 1).filter((s) => grantsWholeTable(s.text));
    expect(regrants).toEqual([]);
    // The probe would catch the grant it guards against.
    expect(grantsWholeTable("grant select on public.testimonials to anon, authenticated")).toBe(true);
    expect(grantsWholeTable("grant select (id) on public.testimonials to anon")).toBe(false);
  });

  it("names consent_confirmed_by in no grant (SEC-AGC-001)", () => {
    const grants = statements.filter((s) => s.text.startsWith("grant ") && s.text.includes("consent_confirmed_by"));
    expect(grants).toEqual([]);
  });

  it("is read by every reader with a column list, never `*` (SEC-AGC-002)", () => {
    expect(SOURCES.length).toBeGreaterThan(100);
    const bad = SOURCES.flatMap((file) => starReads(relative(REPO_ROOT, file), readFileSync(file, "utf8")));
    expect(bad).toEqual([]);
    // The probe would catch each shape it guards against.
    expect(starReads("x.ts", 'client.from("testimonials").select("*");')).toHaveLength(2);
    expect(starReads("x.ts", 'client.from("testimonials").delete().eq("id", id);')).toHaveLength(1);
    expect(starReads("x.ts", "fetch(`${url}/rest/v1/testimonials?select=*`);")).toHaveLength(2);
    expect(starReads("x.ts", 'client.from("testimonials").select(TESTIMONIAL_COLUMNS).limit(5);')).toEqual([]);
  });
});
