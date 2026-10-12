import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { edgeFunctionFiles, read } from "../helpers/source-scan";

/**
 * The shape every Supabase Edge Function keeps, and the one list that must
 * stay identical to the Base44 copies while both run.
 */

const names = edgeFunctionFiles().map((f) => f.split("/").at(-2)!);
const quoted = (src: string, decl: string) => {
  const start = src.indexOf(decl);
  expect(start, `${decl} not found`).toBeGreaterThan(-1);
  return [...src.slice(start, src.indexOf("];", start)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
};

describe("Edge Functions", () => {
  it("there is at least one, so the cases below are not vacuous", () => {
    expect(names).toContain("submit-claim");
  });

  it.each(names)("%s serves its handler and does nothing else at load", (name) => {
    const index = read(join(REPO_ROOT, "supabase/functions", name, "index.ts")).trim();
    expect(index).toBe("import { handler } from './handler.ts';\n\nDeno.serve(handler);");
  });

  it.each(names)("%s declares its JWT setting in config.toml", (name) => {
    const config = read(join(REPO_ROOT, "supabase/config.toml"));
    expect(config).toMatch(new RegExp(`\\[functions\\.${name}\\]\\s*\\nverify_jwt = (true|false)`));
  });

  it("keeps submit-claim public, like the form that calls it", () => {
    expect(read(join(REPO_ROOT, "supabase/config.toml"))).toMatch(/\[functions\.submit-claim\]\s*\nverify_jwt = false/);
  });

  it("uses the same channel vocabulary as the Base44 functions", () => {
    const edge = quoted(read(join(REPO_ROOT, "supabase/functions/_shared/attribution.ts")), "CHANNEL_TAXONOMY = [");
    const base44 = quoted(read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts")), "const CHANNEL_TAXONOMY = [");
    expect(edge.length).toBeGreaterThan(5);
    expect(edge).toEqual(base44);
  });
});
