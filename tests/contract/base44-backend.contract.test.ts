import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APP_POINTER, base44Backend, readLinkedAppId } from "../../scripts/vite-base44-backend-plugin.mjs";

/**
 * A build that cannot reach a backend must not look like one that can.
 *
 * `import.meta.env.VITE_BASE44_APP_ID` is inlined at build time. Base44's own
 * hosting sets it; nothing sets it for a build run from a clone, so the SDK used
 * to post every form to `/api/apps/undefined/functions/submitLead` — and the only
 * symptom was the generic red line under the send button, identical to the one a
 * rejected lead produces.
 *
 * These tests pin the two halves of the fix and, just as importantly, pin the
 * conditions under which each stays *off*: the CI step that builds "the way the
 * Base44 Builder does" proves the build never requires the variable, and the e2e
 * suite is hermetic only while the preview proxy stays opt-in.
 */

const config = (plugin: ReturnType<typeof base44Backend>, root: string) =>
  // The signature Vite calls the hook with; mode is unused by this plugin.
  (plugin as any).config({ root }, { command: "build", mode: "production" });

const roots: string[] = [];

function linkedClone(id?: string): string {
  const root = mkdtempSync(join(tmpdir(), "base44-backend-"));
  roots.push(root);
  if (id !== undefined) {
    mkdirSync(join(root, "base44"), { recursive: true });
    writeFileSync(
      join(root, APP_POINTER),
      `// Base44 App Configuration\n// Do not commit this file.\n{\n  "id": "${id}"\n}\n`
    );
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("the app id reaches the bundle", () => {
  it("reads the id out of the JSONC pointer the CLI writes", () => {
    expect(readLinkedAppId(linkedClone("6a9e6144d2bee5cdfb4ddf74"))).toBe("6a9e6144d2bee5cdfb4ddf74");
  });

  it("defines the linked id when the environment supplies none", () => {
    const { define } = config(base44Backend({ env: {} }), linkedClone("6a9e6144d2bee5cdfb4ddf74"));
    expect(define["import.meta.env.VITE_BASE44_APP_ID"]).toBe('"6a9e6144d2bee5cdfb4ddf74"');
  });

  it("never overrides an id the environment already supplies", () => {
    // Vite inlines the variable itself in that case. A `define` for the same key
    // would put two values in the bundle for one variable.
    const env = { VITE_BASE44_APP_ID: "e2e-sanity-app" };
    const { define } = config(base44Backend({ env }), linkedClone("6a9e6144d2bee5cdfb4ddf74"));
    expect(define).toEqual({});
  });

  it("stays silent in a checkout with no linked app", () => {
    // This is CI, the Vercel build and the Builder's own build. A plugin that
    // threw or guessed here would break the step that proves the build works
    // without anything the workflow supplies.
    expect(readLinkedAppId(linkedClone())).toBe("");
    expect(config(base44Backend({ env: {} }), linkedClone()).define).toEqual({});
  });
});

describe("the preview proxy is opt-in", () => {
  it("adds no /api proxy until a backend is named", () => {
    // `npm run test:e2e` serves the site from this preview server. Its specs are
    // hermetic only because e2e/fixtures/app.ts stubs every /api call; a proxy
    // that switched itself on would turn a missed stub into a live lead.
    expect(config(base44Backend({ env: {} }), linkedClone("6a9e6144d2bee5cdfb4ddf74")).preview).toEqual({});
  });

  it("proxies /api to the named backend, trailing slash or not", () => {
    const env = { VITE_BASE44_APP_BASE_URL: "https://safe-arch-plan.base44.app/" };
    const { preview } = config(base44Backend({ env }), linkedClone());
    expect(preview.proxy["/api"]).toEqual({
      target: "https://safe-arch-plan.base44.app",
      changeOrigin: true,
    });
  });
});
