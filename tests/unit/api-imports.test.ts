import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Vercel functions under api/ are bundled without the "@/" alias, so a
 * runtime "@/…" import anywhere in their import graph crashes them on load
 * (FUNCTION_INVOCATION_FAILED). That happened to api/og/blog.ts when
 * src/lib/seo.ts imported "@/i18n/locales" (#212). Type-only imports are
 * erased and are fine.
 */
const ROOT = join(__dirname, "..", "..");

function entries(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return entries(rel);
    return /\.(ts|js|mjs)$/.test(name) && !/\.test\./.test(name) ? [rel] : [];
  });
}

function resolve(from: string, spec: string): string | null {
  const base = normalize(join(dirname(from), spec));
  for (const candidate of [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, `${base}.js`, join(base, "index.ts")]) {
    if (existsSync(join(ROOT, candidate)) && statSync(join(ROOT, candidate)).isFile()) return candidate;
  }
  return null;
}

/** Runtime imports only: `import type …` and `export type …` are left out. */
function runtimeImports(source: string): string[] {
  const specs: string[] = [];
  for (const m of source.matchAll(/^\s*(import|export)\s+(?!type\b)[^;]*?\sfrom\s+["']([^"']+)["']/gm)) specs.push(m[2]);
  for (const m of source.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) specs.push(m[1]);
  for (const m of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);
  return specs;
}

describe("the Vercel functions' import graphs", () => {
  const functions = entries("api");

  it("finds the functions", () => {
    expect(functions).toContain(join("api", "og", "blog.ts"));
  });

  it.each(functions)("%s imports nothing through the \"@/\" alias at run time", (entry) => {
    const seen = new Set<string>();
    const aliased: string[] = [];
    const stack = [entry];
    while (stack.length) {
      const file = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const spec of runtimeImports(readFileSync(join(ROOT, file), "utf8"))) {
        if (spec.startsWith("@/")) aliased.push(`${file} → ${spec}`);
        else if (spec.startsWith(".")) {
          const next = resolve(file, spec);
          if (next) stack.push(next);
        }
      }
    }
    expect(aliased).toEqual([]);
  });
});
