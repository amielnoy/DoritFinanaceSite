import { readdirSync, readFileSync } from "node:fs";
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

  it("tells the same people about a claim as the Base44 function does", () => {
    // The costliest drift AGENTS.md names: a mailbox added to submitLead and
    // submitClaim (which the agents contract forces together) but missing here
    // would leave the live path silently short of a recipient.
    const addresses = (src: string, decl: RegExp) => {
      const m = src.match(decl);
      expect(m, `${decl} not found`).not.toBeNull();
      return [...m![1].matchAll(/["']([^"']+@[^"']+)["']/g)].map((x) => x[1]);
    };
    // submit-claim takes its recipients from the shared module.
    const handler = read(join(REPO_ROOT, "supabase/functions/submit-claim/handler.ts"));
    expect(handler).toMatch(/import \{ NOTIFY_EMAILS, SECONDARY_EMAIL \} from '\.\.\/_shared\/recipients\.ts';/);
    const edge = read(join(REPO_ROOT, "supabase/functions/_shared/recipients.ts"));
    const base44 = read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"));
    const notify = /const (?:DEFAULT_)?NOTIFY_EMAILS = \[([^\]]*)\]/;
    const secondary = /const SECONDARY_EMAIL = ([^;]+);/;
    expect(addresses(edge, notify)).toEqual(addresses(base44, notify));
    expect(addresses(edge, notify).length).toBeGreaterThan(0);
    expect(addresses(edge, secondary)).toEqual(addresses(base44, secondary));
  });

  it("lets the same closed vocabulary of mailer reasons through", () => {
    const pattern = (src: string) => src.match(/\/\^\(http_[^/]+\/\.test/)?.[0];
    const edge = pattern(read(join(REPO_ROOT, "supabase/functions/_shared/mail.ts")));
    expect(edge).toBeDefined();
    expect(edge).toBe(pattern(read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts"))));
  });

  it("uses the same channel vocabulary as the Base44 functions", () => {
    const edge = quoted(read(join(REPO_ROOT, "supabase/functions/_shared/attribution.ts")), "CHANNEL_TAXONOMY = [");
    const base44 = quoted(read(join(REPO_ROOT, "base44/functions/submitClaim/entry.ts")), "const CHANNEL_TAXONOMY = [");
    expect(edge.length).toBeGreaterThan(5);
    expect(edge).toEqual(base44);
  });
});

describe("the lead functions on Edge", () => {
  const dir = join(REPO_ROOT, "supabase/functions");
  const sources = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((p) => /\.(ts|js)$/.test(p))
    .map((p) => [p, readFileSync(join(dir, p), "utf8")] as const);

  it("mention no Docs, no Outlook and no Base44 connector", () => {
    expect(sources.length).toBeGreaterThan(5);
    for (const [path, src] of sources) {
      for (const banned of ["googledocs", "graph.microsoft.com", "connectors.", "createClientFromRequest"]) {
        expect(src.includes(banned), `${path} mentions ${banned}`).toBe(false);
      }
    }
  });

  it("are each registered without JWT verification, as submit-claim is", () => {
    const toml = readFileSync(join(REPO_ROOT, "supabase/config.toml"), "utf8");
    for (const fn of ["submit-claim", "submit-lead", "escalate-to-human", "log-support-chat"]) {
      expect(toml).toMatch(new RegExp(`\\[functions\\.${fn}\\]\\s*\\nverify_jwt = false`));
    }
  });

  it("registers each clearinghouse function without the gateway's JWT check, because each checks its caller itself", () => {
    const toml = readFileSync(join(REPO_ROOT, "supabase/config.toml"), "utf8");
    const masleka = names.filter((n) => n.startsWith("masleka-"));
    expect(masleka.length).toBeGreaterThan(0);
    for (const fn of masleka) {
      expect(toml).toMatch(new RegExp(`\\[functions\\.${fn}\\]\\s*\\nverify_jwt = false`));
    }
  });

  it("ask Google for exactly two scopes", () => {
    const google = readFileSync(join(dir, "_shared/google.ts"), "utf8");
    const scopes = [...google.matchAll(/'(https:\/\/www\.googleapis\.com\/auth\/[^']+)'/g)].map((m) => m[1]);
    expect(scopes).toEqual([
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/spreadsheets",
    ]);
  });
});
