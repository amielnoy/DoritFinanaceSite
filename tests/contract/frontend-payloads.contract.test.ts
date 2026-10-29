import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { REPO_ROOT } from "../helpers/entity-schema";
import { findObjectLiteralCalls, read, rel, sourceFiles } from "../helpers/source-scan";

/**
 * Lead capture crosses two boundaries, and this file pins both:
 *
 *   browser  --invoke("submit-lead")-->  Edge function  --insert-->  leads
 *
 * The tests read the real call sites out of src/ and supabase/functions/ and the
 * real schema out of supabase/migrations/, so a field renamed on either side — or
 * a `source` value outside the leads table's check — fails here rather than in production.
 */

/** Fields a backend function destructures off its request body. */
function destructuredBody(src: string): string[] {
  const m = src.match(/const\s*\{([^}]*)\}\s*=\s*body\s*\|\|\s*\{\}/);
  if (!m) throw new Error("function no longer destructures its request body");
  return m[1].split(",").map((s) => s.trim()).filter(Boolean).sort();
}

describe("adapter → submitLead", () => {
  // The bodies live in `lead-bodies.ts` (shared with the Supabase
  // adapters), so the contract reads the returned literals from there.
  const calls = findObjectLiteralCalls(
    /export function (?:leadBody|interviewBody)\([^)]*\)[^{]*\{\s*return\s*/,
    [join(REPO_ROOT, "src/services/lead-bodies.ts")]
  );
  // submitLead is a forwarder now; the Edge handler is the source of truth for
  // what the body may carry.
  const accepted = destructuredBody(
    readFileSync(join(REPO_ROOT, "supabase/functions/submit-lead/handler.ts"), "utf8"),
  );

  // Fields the agent passes as a tool call and that no browser form has. The
  // booking agent composes `summary` from the conversation; a contact form has
  // no conversation to summarise. Listing them here keeps the check strict for
  // everything else — a field the backend starts accepting that is neither sent
  // by the adapter nor named here still fails.
  // Fields only a conversational agent sends. `summary` is the free-text recap;
  // `track` and `profile` are the interview's fixed schema, which no form on the
  // site collects. The test below keeps this list honest by requiring the
  // function to actually destructure every name in it.
  //
  // `consent_version` and `consent_at` are agent-only for a reason worth
  // stating: the chat shows a consent gate before a word is exchanged, so it
  // knows which notice the visitor accepted and when. The browser forms show no
  // such gate. A form sending these would be recording a consent nobody was
  // asked for, which is worse than recording none — the field is evidence under
  // תיקון 13, and false evidence is the one failure mode not worth trading for
  // a fuller-looking record.
  // `conversationRef` ties an interview's saves together (review 2026-10-15); a form is one save.
  const AGENT_ONLY = ["summary", "track", "profile", "stage", "meetingTopic", "consent_version", "consent_at", "conversationRef"];

  /**
   * Two call sites now, and both are the adapter's.
   *
   * The browser builds this payload twice because the interview's close is no
   * longer the agent's to send: its tool calls are not executed in an anonymous
   * conversation, and every visitor is anonymous (A-59). So the form sends the
   * form's fields, and `submitInterview` sends the conversation's — the same
   * function, the same validation, reached by the caller that is actually
   * allowed to reach it.
   */
  it("every payload is built in the adapter and nowhere else", () => {
    // Previously three components each built this by hand. However many call
    // sites there are, they belong in one file — that is the point of it.
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.file, "a component is building this payload again").toBe(
        "src/services/lead-bodies.ts",
      );
    }
  });

  it("sends nothing the function does not read", () => {
    for (const c of calls) {
      expect(
        c.keys.filter((k) => !accepted.includes(k)),
        "a field the backend never destructures",
      ).toEqual([]);
    }
  });

  it("the form's payload is exactly the form's fields", () => {
    const form = calls.find((c) => !c.keys.includes("stage"));
    expect(form, "no browser-form payload found").toBeDefined();
    expect([...form!.keys].sort()).toEqual(accepted.filter((k) => !AGENT_ONLY.includes(k)));
  });

  it("the interview's payload carries what the summary mail is built from", () => {
    const interview = calls.find((c) => c.keys.includes("stage"));
    expect(interview, "no interview payload found").toBeDefined();
    // Without these the enquiry reaches Dorit as a name and a phone number and
    // nothing of the conversation that produced them.
    for (const field of ["name", "phone", "source", "stage", "track", "profile", "summary"]) {
      expect(interview!.keys, `the interview omits ${field}`).toContain(field);
    }
  });

  it("keeps every agent-only field genuinely accepted by the function", () => {
    // Guards the escape hatch above: a name listed there that the backend does
    // not actually destructure would silently excuse a real mismatch.
    for (const field of AGENT_ONLY) expect(accepted).toContain(field);
  });

  it("sends the two fields the function requires", () => {
    for (const required of ["name", "phone"]) {
      expect(calls[0].keys).toContain(required);
    }
  });
});

describe("adapter → submit-claim (Supabase)", () => {
  const ADAPTER = [join(REPO_ROOT, "src/services/supabase/SupabaseLeadService.ts")];
  const calls = existsSync(ADAPTER[0])
    ? findObjectLiteralCalls(/functions\.invoke\(\s*["']submit-claim["']\s*,\s*\{\s*body:\s*/, ADAPTER)
    : [];
  const accepted = destructuredBody(readFileSync(join(REPO_ROOT, "supabase/functions/submit-claim/handler.ts"), "utf8"));

  it("exactly one adapter owns the call", () => {
    expect(calls).toHaveLength(1);
  });

  it("sends only fields the function reads, including name and phone", () => {
    expect(calls[0].keys.filter((k) => !accepted.includes(k))).toEqual([]);
    for (const required of ["name", "phone"]) expect(calls[0].keys).toContain(required);
  });
});

describe("Base44 is out of the build", () => {
  it("nothing imports a Base44 package", () => {
    const tracked = execFileSync("git", ["ls-files", "src", "api", "scripts", "e2e"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .filter((f) => f && existsSync(join(REPO_ROOT, f)));
    const offenders = tracked.filter((f) => /from ["']@base44\//.test(readFileSync(join(REPO_ROOT, f), "utf8")));
    expect(offenders, "these still import @base44/*").toEqual([]);
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
    expect(Object.keys(deps).filter((d) => d.startsWith("@base44/"))).toEqual([]);
  });
});

describe("dependency inversion holds", () => {
  const uiFiles = sourceFiles().filter(
    (f) => rel(f).startsWith("src/components/") || rel(f).startsWith("src/pages/")
  );

  /**
   * And no `.jsx` may shadow a `.tsx` of the same name.
   *
   * This is the mechanism behind A-46, and it is invisible in a diff: Vite resolves
   * `.jsx` before `.tsx`, so `src/pages/Login.jsx` became the login page and the real
   * `src/pages/Login.tsx` — TypeScript, routed through `@/services` — stopped being
   * imported by anything while still sitting there looking authoritative. Nothing
   * failed. The file that shipped simply changed.
   *
   * Caught here only because the shadowing copy also imported the SDK. A boilerplate
   * page that happened not to would have replaced a real one in silence.
   */
  it("resolves TypeScript ahead of JavaScript, so a collision cannot swap a page", () => {
    /**
     * Vite's default order puts `.jsx` before `.tsx`. The case below fails when
     * a collision exists, but it runs in CI and the swap is silent until then —
     * and the Base44 Builder re-adds those boilerplate `.jsx` templates on its
     * own schedule, three times in one day (A-46, A-50). Reordering makes the
     * collision harmless rather than merely detectable: this repo is
     * TypeScript, and the TypeScript file is always the one that means
     * something.
     */
    const config = read(join(REPO_ROOT, "vite.config.js"));
    const order = config.match(/extensions:\s*\[([^\]]*)\]/)?.[1];
    expect(order, "vite.config.js no longer pins the resolution order").toBeTruthy();
    const exts = [...order!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    for (const [ts, js] of [[".ts", ".js"], [".tsx", ".jsx"]] as const) {
      expect(
        exts.indexOf(ts),
        `${ts} must resolve before ${js}`
      ).toBeLessThan(exts.indexOf(js));
    }
  });

  it("no .jsx shadows a .tsx of the same name", () => {
    const byStem = new Map<string, string[]>();
    for (const f of sourceFiles()) {
      const r = rel(f);
      const m = r.match(/^(.*)\.(jsx|tsx)$/);
      if (!m) continue;
      byStem.set(m[1], [...(byStem.get(m[1]) ?? []), r]);
    }
    const shadowed = [...byStem.values()]
      .filter((v) => v.length > 1)
      .flat()
      .sort();
    expect(shadowed, "Vite resolves .jsx first, so the .tsx here is dead code").toEqual(
      []
    );
  });

  it("only the composition root names a concrete implementation", () => {
    const wiring = sourceFiles().filter((f) => {
      const r = rel(f);
      if (r.startsWith("src/services/")) return false;
      return /new Supabase\w+Service\(/.test(read(f));
    });
    expect(wiring.map(rel)).toEqual([]);
  });

  it("the lead source union matches the leads table's source check", () => {
    const ports = read(join(REPO_ROOT, "src/services/ports.ts"));
    const union = ports.match(/export type LeadSource =([^;]+);/)![1];
    const dir = join(REPO_ROOT, "supabase/migrations");
    // The latest migration that (re)defines the check wins; the first schema declares it inline.
    const defs = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .flatMap((f) => {
        const sql = readFileSync(join(dir, f), "utf8").replace(/\s+/g, " ");
        const m = /leads_source_check check \(source in \(([^)]*)\)\)/.exec(sql) ?? (f.startsWith("20260921000000") ? /source text check \(source in \(('consultation'[^)]*)\)\)/.exec(sql) : null);
        return m ? [m[1]] : [];
      });
    const declared = [...defs.at(-1)!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
    const inCode = [...union.matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort();
    expect(inCode).toEqual(declared);
  });
});

describe("email is sent from the backend, never the browser", () => {
  it("no component calls Core.SendEmail", () => {
    const fromBrowser = findObjectLiteralCalls(
      /base44\.integrations\.Core\.SendEmail\(\s*/
    );
    expect(fromBrowser.map((c) => c.file)).toEqual([]);
  });
});

describe("blog and testimonial writes", () => {
  it("the admin payload carries title, body and slug", () => {
    const adminPayload = findObjectLiteralCalls(/const payload\s*=\s*/).find(
      (c) => c.file === "src/pages/BlogAdmin.tsx"
    );
    expect(adminPayload, "BlogAdmin payload literal").toBeDefined();
    for (const key of ["title", "body", "slug"]) expect(adminPayload!.keys).toContain(key);
  });

  it("publish toggles are authored at the port call", () => {
    const updates = findObjectLiteralCalls(/services\.contentAdmin\.updateArticle\([^,]+,\s*/);
    expect(updates.length).toBeGreaterThan(0);
  });

  it("a testimonial is sent with its name and quote", () => {
    /* The literal is authored at the hook call: the component decides the fields and
       everything below it forwards them. */
    const calls = findObjectLiteralCalls(/createTestimonial\.mutateAsync\(\s*/);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      for (const required of ["name", "quote"]) expect(call.keys, `${call.file} must send ${required}`).toContain(required);
    }
  });
});
