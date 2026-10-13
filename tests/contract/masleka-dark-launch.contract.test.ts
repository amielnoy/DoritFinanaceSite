import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The clearinghouse pipeline ships dark: nothing may collect a code or an ID
 * number before the compliance review (spec, "Release gates" 1). Two switches,
 * MASLEKA_ENABLED on the Edge and VITE_MASLEKA_ENABLED in the build, both off
 * unless exactly "true", and nothing in this repository turns either on.
 */
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const FUNCTIONS = readdirSync(join(REPO_ROOT, "supabase/functions"))
  .filter((name) => name.startsWith("masleka-"))
  .sort();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the clearinghouse pipeline ships dark", () => {
  it("has the five functions to check", () => {
    expect(FUNCTIONS).toEqual(["masleka-code", "masleka-create", "masleka-remind", "masleka-reveal", "masleka-submitted"]);
  });

  it.each(FUNCTIONS)("%s refuses before it reads or writes anything while the switch is off", (name) => {
    const src = read(`supabase/functions/${name}/handler.ts`);
    const gate = src.indexOf("if (!maslekaEnabled())");
    expect(gate, `${name} has no switch`).toBeGreaterThan(-1);
    for (const later of ["req.json(", "staffCaller(", "selectRows(", "updateWhere(", "insertRow(", "createRequest(", "sendMail("]) {
      const at = src.indexOf(later);
      if (at > -1) expect(at, `${name}: ${later} comes before the switch`).toBeGreaterThan(gate);
    }
  });

  it("turns the Edge switch on only for exactly \"true\"", () => {
    expect(read("supabase/functions/_shared/masleka.ts")).toContain(
      "return (Deno.env.get('MASLEKA_ENABLED') || '').trim() === 'true';",
    );
  });

  it("lets submit-lead create a request only behind the same switch", () => {
    expect(read("supabase/functions/submit-lead/handler.ts")).toMatch(
      /if \(source === 'interview' && maslekaEnabled\(\) && wantsClearinghouse\(safeProfile\)\) \{\s*try \{\s*masleka = await createRequest\(/,
    );
  });

  it("is off in a build that does not set VITE_MASLEKA_ENABLED", async () => {
    vi.stubEnv("VITE_MASLEKA_ENABLED", "");
    expect((await import("@/config/masleka")).MASLEKA_ENABLED).toBe(false);
  });

  it("is turned on by nothing in the repository", () => {
    const files = [
      "vercel.json",
      "playwright.config.ts",
      "vitest.config.ts",
      "supabase/config.toml",
      "package.json",
      ...readdirSync(join(REPO_ROOT, ".github/workflows")).map((f) => `.github/workflows/${f}`),
    ];
    for (const file of files) {
      // A comment may mention the value (vitest.config.ts explains why it pins it off).
      const code = read(file).split("\n").filter((line) => !/^\s*(\/\/|#|\*|\/\*)/.test(line)).join("\n");
      expect(code, file).not.toMatch(/MASLEKA_ENABLED\s*[:=]\s*["']?true/);
    }
  });

  it("registers the staff pages only when switched on, and the client page always (it then says unavailable)", () => {
    expect(read("src/App.jsx")).toMatch(/\{MASLEKA_ENABLED \? \(\s*<Route element=\{<StaffRoute/);
    expect(read("src/App.jsx")).toContain('<Route path="/masleka" element={<Masleka />} />');
    expect(read("src/pages/Masleka.tsx")).toContain("enabled = MASLEKA_ENABLED");
  });
});
