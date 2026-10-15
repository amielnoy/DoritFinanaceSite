import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The skip link (src/components/dorit/layout/SkipLink.tsx) is `href="#main"`,
 * so every page's `<main>` must be `id="main"` — or, in the prerendered HTML
 * before the app runs, the link points nowhere (D-08, manual test 2026-10-14).
 * `e2e/ui/navigation.spec.ts` checks the routes it visits; this checks the
 * screens it cannot reach without signing in.
 */
const files = [
  ...readdirSync(join(REPO_ROOT, "src/pages"))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `src/pages/${f}`),
  "src/components/AuthLayout.tsx",
];

describe("every page's <main>", () => {
  it.each(files)("%s names its <main> \"main\"", (file) => {
    const src = readFileSync(join(REPO_ROOT, file), "utf8");
    const mains = [...src.matchAll(/<main\b[^>]*>/g)].map((m) => m[0]);
    for (const tag of mains) expect(tag, `${file}: ${tag}`).toContain('id="main"');
  });
});
