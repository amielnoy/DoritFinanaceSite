import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadEntity, validateAgainstEntity } from "../helpers/entity-schema";
import { join } from "node:path";
import { REPO_ROOT } from "../helpers/entity-schema";
import { backendFiles, findObjectLiteralCalls, read, rel, sourceFiles } from "../helpers/source-scan";

/**
 * Lead capture crosses two boundaries, and this file pins both:
 *
 *   browser  --invoke("submitLead")-->  backend function  --create-->  Lead
 *
 * The tests read the real call sites out of src/ and base44/functions/ and the
 * real schema out of base44/entities/, so a field renamed on either side — or a
 * `source` value outside the entity enum — fails here rather than in production.
 */

const BACKEND = backendFiles();
const backendSource = (name: string) =>
  readFileSync(BACKEND.find((f) => f.includes(`/${name}/`))!, "utf8");

/** Fields a backend function destructures off its request body. */
function destructuredBody(src: string): string[] {
  const m = src.match(/const\s*\{([^}]*)\}\s*=\s*body\s*\|\|\s*\{\}/);
  if (!m) throw new Error("function no longer destructures its request body");
  return m[1].split(",").map((s) => s.trim()).filter(Boolean).sort();
}

const ADAPTERS = [
  join(REPO_ROOT, "src/services/base44/Base44LeadService.ts"),
  join(REPO_ROOT, "src/services/base44/Base44ContentService.ts"),
];

describe("adapter → submitLead", () => {
  const calls = findObjectLiteralCalls(
    /functions\.invoke\(\s*["']submitLead["']\s*,\s*/,
    ADAPTERS
  );
  const accepted = destructuredBody(backendSource("submitLead"));

  // Fields the agent passes as a tool call and that no browser form has. The
  // booking agent composes `summary` from the conversation; a contact form has
  // no conversation to summarise. Listing them here keeps the check strict for
  // everything else — a field the backend starts accepting that is neither sent
  // by the adapter nor named here still fails.
  const AGENT_ONLY = ["summary"];

  it("exactly one adapter owns the call", () => {
    // Previously three components each built this payload by hand. The contract
    // now has a single place to drift, which is the point of the adapter.
    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe("src/services/base44/Base44LeadService.ts");
  });

  it("sends exactly the fields the function destructures, bar the agent-only ones", () => {
    expect([...calls[0].keys].sort()).toEqual(accepted.filter((k) => !AGENT_ONLY.includes(k)));
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

describe("adapter → submitClaim", () => {
  const calls = findObjectLiteralCalls(
    /functions\.invoke\(\s*["']submitClaim["']\s*,\s*/,
    ADAPTERS
  );
  const accepted = destructuredBody(backendSource("submitClaim"));

  it("exactly one adapter owns the call", () => {
    expect(calls).toHaveLength(1);
  });

  it("sends only fields the function reads, including name and phone", () => {
    expect(calls[0].keys.filter((k) => !accepted.includes(k))).toEqual([]);
    for (const required of ["name", "phone"]) {
      expect(calls[0].keys).toContain(required);
    }
  });
});

describe("dependency inversion holds", () => {
  const uiFiles = sourceFiles().filter(
    (f) => rel(f).startsWith("src/components/") || rel(f).startsWith("src/pages/")
  );

  /** Admin and auth screens still talk to the SDK directly — a known boundary. */
  const ALLOWED_DIRECT_SDK = [
    "src/components/dorit/sections/Testimonials.tsx",
    "src/pages/BlogAdmin.tsx",
    "src/pages/Leads.tsx",
    "src/pages/Login.tsx",
    "src/pages/Register.tsx",
    "src/pages/ForgotPassword.tsx",
    "src/pages/ResetPassword.tsx",
  ];

  it("no public-facing component imports the Base44 SDK directly", () => {
    const offenders = uiFiles
      .filter((f) => /from ["']@\/api\/base44Client["']/.test(read(f)))
      .map(rel)
      .filter((f) => !ALLOWED_DIRECT_SDK.includes(f));
    expect(offenders, "these should depend on @/services instead").toEqual([]);
  });

  it("only the composition root names a concrete implementation", () => {
    const wiring = sourceFiles().filter((f) => {
      const r = rel(f);
      if (r.startsWith("src/services/")) return false;
      return /new Base44\w+Service\(/.test(read(f));
    });
    expect(wiring.map(rel)).toEqual([]);
  });

  it("the lead source union matches the entity enum", () => {
    const ports = read(join(REPO_ROOT, "src/services/ports.ts"));
    const union = ports.match(/export type LeadSource =([^;]+);/)![1];
    const declared = (loadEntity("Lead").properties.source.enum ?? []).slice().sort();
    const inCode = [...union.matchAll(/"([a-z]+)"/g)].map((m) => m[1]).sort();
    expect(inCode).toEqual(declared);
  });
});

describe("backend → Lead entity", () => {
  const lead = loadEntity("Lead");
  const writes = findObjectLiteralCalls(
    /base44\.entities\.Lead\.create\(\s*/,
    BACKEND
  );

  it("only the backend functions create leads — the browser no longer does", () => {
    const fromBrowser = findObjectLiteralCalls(/base44\.entities\.Lead\.create\(\s*/);
    expect(fromBrowser, "a component still writes Lead directly").toEqual([]);
    expect(writes.length).toBe(3); // submitLead, submitClaim, escalateToHuman
  });

  for (const write of writes) {
    it(`${write.file} writes only declared fields`, () => {
      const undeclared = write.keys.filter((k) => !(k in lead.properties));
      expect(undeclared, `${write.file}`).toEqual([]);
    });

    it(`${write.file} supplies both required fields`, () => {
      for (const required of lead.required ?? []) {
        expect(write.keys, `${write.file} must write ${required}`).toContain(required);
      }
    });

    it(`${write.file} uses enum-legal source and status literals`, () => {
      for (const field of ["source", "status"] as const) {
        const literal = write.stringLiterals[field];
        if (literal === undefined) continue;
        expect(lead.properties[field].enum, `${write.file}.${field}`).toContain(literal);
      }
    });
  }

  it("validates a representative payload for every declared source", () => {
    for (const source of loadEntity("Lead").properties.source.enum ?? []) {
      const payload = {
        name: "ישראלה", phone: "050-0000000", email: "", source,
        topic: "", timing: "", message: "", status: "new",
      };
      expect(validateAgainstEntity(lead, payload), source).toEqual([]);
    }
  });

  it("rejects an unknown source and a stray field", () => {
    const issues = validateAgainstEntity(lead, {
      name: "x", phone: "1", source: "carrier-pigeon", utm_campaign: "spring",
    });
    expect(issues.map((i) => i.field).sort()).toEqual(["source", "utm_campaign"]);
  });
});

describe("email is sent from the backend, never the browser", () => {
  it("no component calls Core.SendEmail", () => {
    const fromBrowser = findObjectLiteralCalls(
      /base44\.integrations\.Core\.SendEmail\(\s*/
    );
    expect(fromBrowser.map((c) => c.file)).toEqual([]);
  });

  const backendSends = findObjectLiteralCalls(
    /integrations\.Core\.SendEmail\(\s*/,
    BACKEND
  );

  it("every backend send supplies a recipient and a subject", () => {
    expect(backendSends.length).toBeGreaterThan(0);
    for (const send of backendSends) {
      expect(send.keys, send.file).toContain("to");
      expect(send.keys, send.file).toContain("subject");
      expect(
        send.keys.includes("body") || send.keys.includes("html"),
        `${send.file} sends neither body nor html`
      ).toBe(true);
    }
  });

  it("recipients come from named constants, never inline literals", () => {
    for (const send of backendSends) {
      expect(
        send.stringLiterals.to,
        `${send.file} inlines a recipient address`
      ).toBeUndefined();
    }
  });

  it("an HTML send always ships a plain-text alternative", () => {
    for (const send of backendSends.filter((s) => s.keys.includes("html"))) {
      expect(send.keys, `${send.file} sends HTML with no text fallback`).toContain("text");
    }
  });
});

describe("BlogPost writes match the BlogPost entity", () => {
  const blogPost = loadEntity("BlogPost");

  it("the admin payload carries title and body and nothing undeclared", () => {
    const adminPayload = findObjectLiteralCalls(/const payload\s*=\s*/).find(
      (c) => c.file === "src/pages/BlogAdmin.tsx"
    );
    expect(adminPayload, "BlogAdmin payload literal").toBeDefined();
    expect(adminPayload!.keys.filter((k) => !(k in blogPost.properties))).toEqual([]);
    for (const required of blogPost.required ?? []) {
      expect(adminPayload!.keys).toContain(required);
    }
  });

  it("publish toggles only flip declared fields", () => {
    const updates = findObjectLiteralCalls(/base44\.entities\.BlogPost\.update\([^,]+,\s*/);
    expect(updates.length).toBeGreaterThan(0);
    for (const call of updates) {
      for (const key of call.keys) {
        expect(Object.keys(blogPost.properties), `${call.file} → ${key}`).toContain(key);
      }
    }
  });

  it("the published filter lives in the content adapter, not in a page", () => {
    // Keeping it in the port means no caller can accidentally list drafts.
    const inAdapter = findObjectLiteralCalls(/BlogPost\.filter\(\s*/, [
      join(REPO_ROOT, "src/services/base44/Base44ContentService.ts"),
    ]);
    expect(inAdapter).toHaveLength(1);
    expect(inAdapter[0].keys).toEqual(["published"]);
    expect(blogPost.properties.published.type).toBe("boolean");

    const inPages = findObjectLiteralCalls(/BlogPost\.filter\(\s*/, sourceFiles().filter((f) => rel(f).startsWith("src/pages/")));
    expect(inPages).toEqual([]);
  });
});

describe("Testimonial.create payloads match the Testimonial entity", () => {
  const testimonial = loadEntity("Testimonial");
  const calls = findObjectLiteralCalls(/base44\.entities\.Testimonial\.create\(\s*/);

  it("sends only declared fields and both required ones", () => {
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.keys.filter((k) => !(k in testimonial.properties)), call.file).toEqual([]);
      for (const required of testimonial.required ?? []) {
        expect(call.keys, `${call.file} must send ${required}`).toContain(required);
      }
    }
  });

  it("keeps the rating inside the declared 1..5 range", () => {
    expect(validateAgainstEntity(testimonial, { name: "א", quote: "ב", rating: 5 })).toEqual([]);
    expect(validateAgainstEntity(testimonial, { name: "א", quote: "ב", rating: 6 })).toHaveLength(1);
    expect(validateAgainstEntity(testimonial, { name: "א", quote: "ב", rating: 0 })).toHaveLength(1);
  });
});
