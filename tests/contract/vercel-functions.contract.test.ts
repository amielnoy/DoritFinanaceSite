import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import vercelConfig from "../../vercel.json";

/**
 * A Vercel function nobody can reach.
 *
 * `api/og/blog/[id].ts` built and deployed on every run, and not one request
 * ever got to it. Vercel matches a *dynamic* function path only after the
 * `rewrites` in vercel.json, and two of those catch everything: `/api/:path*`
 * sent `/api/og/blog/x` to Base44, and `/(.*)` handed a crawler's rewritten
 * `/blog/x` the SPA shell. A function with a fixed path is a file on disk, and
 * the filesystem is checked before any rewrite — so that is the only kind this
 * project can have.
 */

const REPO_ROOT = join(__dirname, "../..");

function functionFiles(dir = "api"): string[] {
  return readdirSync(join(REPO_ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return functionFiles(path);
    return /\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe("Vercel functions under api/", () => {
  it("have fixed paths — the catch-all rewrites shadow dynamic ones", () => {
    const dynamic = functionFiles().filter((f) => /\[[^\]]+\]/.test(f));
    expect(dynamic, "a [segment] in a function path is never reached").toEqual([]);
  });

  it("route a crawler's /blog/:id to a function that exists", () => {
    const bot = vercelConfig.rewrites.find((r) => r.source === "/blog/:id");
    expect(bot, "no crawler rewrite for /blog/:id").toBeDefined();

    const [path, query] = bot!.destination.split("?");
    const file = `${path.replace(/^\//, "")}.ts`;
    expect(existsSync(join(REPO_ROOT, file)), `${file} does not exist`).toBe(true);
    // The handler reads the post id from `req.query.id`.
    expect(new URLSearchParams(query).get("id")).toBe(":id");
  });

  it("are type-checked the way @vercel/node builds them", () => {
    // `"type": "module"` makes @vercel/node compile api/ as Node ESM, where an
    // import without its `.js` extension does not resolve at all. The api
    // tsconfig has to say so too, and `npm run typecheck` has to run it, or CI
    // passes code that cannot load.
    const read = (p: string) => JSON.parse(readFileSync(join(REPO_ROOT, p), "utf8"));
    expect(read("api/tsconfig.json").compilerOptions.moduleResolution?.toLowerCase()).toBe("nodenext");
    expect(read("package.json").scripts.typecheck).toContain("api/tsconfig.json");
  });
});

describe("the Content-Security-Policy is enforced, and both policies report", () => {
  // The main policy is enforced; Trusted Types rides alongside as Report-Only
  // until every page — the admin editor included — is known to pass it. A
  // policy with nowhere to report records nothing, so both name the endpoint.
  const headers = (vercelConfig as unknown as { headers: { headers: { key: string; value: string }[] }[] }).headers
    .flatMap((b) => b.headers);
  const enforced = headers.find((h) => h.key === "Content-Security-Policy");
  const reportOnly = headers.find((h) => h.key === "Content-Security-Policy-Report-Only");

  it("enforces the policy, allowing inline scripts only by hash", () => {
    expect(enforced, "no enforced Content-Security-Policy header").toBeDefined();
    const scriptSrc = enforced!.value.match(/script-src ([^;]+)/)?.[1] ?? "";
    expect(scriptSrc).not.toMatch(/'unsafe-inline'|'unsafe-eval'/);
    expect(enforced!.value).toMatch(/object-src 'none'/);
    expect(enforced!.value).toMatch(/base-uri 'self'/);
  });

  it("asks for Trusted Types in report-only mode", () => {
    expect(reportOnly?.value).toMatch(/require-trusted-types-for 'script'/);
  });

  it.each([
    ["enforced", () => enforced],
    ["report-only", () => reportOnly],
  ])("the %s policy names a report endpoint that is a function in api/", (_, policy) => {
    const csp = policy();
    const uri = csp!.value.match(/report-uri (\S+?);?(\s|$)/)?.[1];
    expect(uri, "the policy has no report-uri").toBe("/api/csp-report");
    expect(csp!.value).toMatch(/report-to csp(;|$)/);
    expect(existsSync(join(REPO_ROOT, "api/csp-report.ts"))).toBe(true);
  });

  it("names the same endpoint for the Reporting API", () => {
    expect(headers.find((h) => h.key === "Reporting-Endpoints")?.value).toBe('csp="/api/csp-report"');
  });

  it("checks every inline script against the policy before a Vercel deploy", () => {
    const ci = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toMatch(/node scripts\/check-csp-hashes\.mjs \.vercel\/output\/static/);
  });
});
