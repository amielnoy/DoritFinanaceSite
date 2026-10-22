import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { E2E_BUILD_ENV, E2E_SUPABASE_URL } from "../../e2e/build-env";
import { CHAT_FUNCTION_AGENTS } from "@/config/chat-agents";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The e2e bundle is production's configuration, pointed at a Supabase that
 * does not exist (CTR-E2E-001..004).
 *
 * Until 2026-10-18 it was built with no Supabase at all, so every adapter fell
 * back to Base44 and the suite tested a path no visitor takes; the stubs it
 * answered were Base44's. These pin the three things that keep it honest: the
 * build reads one file, that file says what production says, and the fakes
 * answer the fake host only — so against a deployment they can never stand in
 * for the real project's reads.
 */
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
/** Code, not comments. */
const code = (path: string) =>
  read(path)
    .split("\n")
    .filter((l) => !/^\s*(#|\/\/|\*)/.test(l))
    .join("\n");

describe("the e2e build", () => {
  it("points Supabase at a host that can never resolve (CTR-E2E-001)", () => {
    const url = new URL(E2E_SUPABASE_URL);
    expect(url.protocol).toBe("https:");
    // RFC 2606 reserves .invalid: no request the fixture misses can reach a real project.
    expect(url.hostname.endsWith(".invalid")).toBe(true);
    expect(E2E_BUILD_ENV.VITE_SUPABASE_URL).toBe(E2E_SUPABASE_URL);
    expect(E2E_BUILD_ENV.VITE_SUPABASE_PUBLISHABLE_KEY).toBeTruthy();
  });

  it("switches on what production switches on (CTR-E2E-002)", () => {
    // Production's build flags, read from Vercel on 2026-10-17. Masleka is on in
    // production and off here: e2e/ui/masleka.spec.ts asserts the dark build.
    // Agency content is the reverse, off in production and on here, so its read
    // side runs in every spec and e2e/ui/agency-content.spec.ts can hold the
    // seeded render to the bundled one; the production smoke covers it off.
    expect(E2E_BUILD_ENV).toMatchObject({
      VITE_LEAD_FUNCTIONS: "supabase",
      VITE_CONTENT_WRITES: "supabase",
      VITE_UPLOAD_PROVIDER: "supabase",
      VITE_CONTENT_IMAGES: "supabase",
      VITE_MEETINGS_STAFF: "true",
      VITE_MASLEKA_ENABLED: "",
      VITE_MEETINGS_CLIENT: "",
      VITE_AGENCY_CONTENT: "true",
      VITE_BASE44_APP_BASE_URL: "",
    });
    // Every agent the chat function can serve, so no chat in the suite runs on Base44.
    expect(E2E_BUILD_ENV.VITE_CHAT_AGENTS.split(",").sort()).toEqual([...CHAT_FUNCTION_AGENTS].sort());
  });

  it("is built from that one file by every entry point (CTR-E2E-003)", () => {
    expect(read("scripts/build-e2e.mjs")).toMatch(/env: \{ \.\.\.process\.env, \.\.\.E2E_BUILD_ENV \}/);
    const config = code("playwright.config.ts");
    expect(config).toContain('skipBuild ? null : "npm run build:e2e"');
    expect(config).toContain("env: { ...E2E_BUILD_ENV }");
    const sh = code("scripts/run-tests.sh");
    expect(sh).toMatch(/run_suite "build" npm run build:e2e/);
    // A second copy is how the three drifted before.
    expect(sh).not.toMatch(/export VITE_/);
    expect(sh).not.toContain("PRERENDER_ARTICLES_FIXTURE");
  });

  it("answers the fake host only, so a deployment's reads stay live (CTR-E2E-004)", () => {
    // The fixture: everything on the fake host, and only the functions elsewhere
    // (the smoke must file no real lead).
    const fixture = read("e2e/fixtures/app.ts");
    expect(fixture).toContain("const FAKE_ORIGIN = new URL(E2E_SUPABASE_URL).origin;");
    expect(fixture).toContain('(url) => url.origin === FAKE_ORIGIN || url.pathname.startsWith("/functions/v1/")');
    // The prerender: the fake host, and nothing else.
    const prerender = read("scripts/prerender.mjs");
    expect(prerender).toContain("const origin = new URL(E2E_SUPABASE_URL).origin");
    expect(prerender).toContain("(url) => url.origin === origin,");
  });
});
