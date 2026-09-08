import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadEntity, validateAgainstEntity } from "../helpers/entity-schema";
import { backendFiles, findObjectLiteralCalls, read, rel } from "../helpers/source-scan";

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

describe("browser → submitLead", () => {
  const calls = findObjectLiteralCalls(/base44\.functions\.invoke\(\s*["']submitLead["']\s*,\s*/);
  const accepted = destructuredBody(backendSource("submitLead"));

  it("is invoked from every lead-capturing form", () => {
    expect(calls.map((c) => c.file).sort()).toEqual([
      "src/components/dorit/ConsultationBuilder.tsx",
      "src/components/dorit/DetailedContactForm.tsx",
      "src/components/dorit/QuickContact.tsx",
    ]);
  });

  for (const call of calls) {
    it(`${call.file} sends only fields the function reads`, () => {
      const unknown = call.keys.filter((k) => !accepted.includes(k));
      expect(unknown, `${call.file} sends fields submitLead ignores`).toEqual([]);
    });

    it(`${call.file} sends the two fields the function requires`, () => {
      for (const required of ["name", "phone"]) {
        expect(call.keys, `${call.file} must send ${required}`).toContain(required);
      }
    });

    it(`${call.file} uses a source the Lead entity declares`, () => {
      const source = call.stringLiterals.source;
      expect(source, `${call.file} must declare a source`).toBeTruthy();
      expect(loadEntity("Lead").properties.source.enum).toContain(source);
    });
  }

  it("covers every lead source the entity declares except the claim path", () => {
    const fromForms = calls.map((c) => c.stringLiterals.source).sort();
    const declared = [...(loadEntity("Lead").properties.source.enum ?? [])]
      .filter((s) => s !== "claim") // written by submitClaim, asserted below
      .sort();
    expect(fromForms).toEqual(declared);
  });
});

describe("browser → submitClaim", () => {
  const calls = findObjectLiteralCalls(/base44\.functions\.invoke\(\s*["']submitClaim["']\s*,\s*/);
  const accepted = destructuredBody(backendSource("submitClaim"));

  it("is invoked from the claim form", () => {
    expect(calls.map((c) => c.file)).toEqual(["src/components/dorit/ClaimForm.tsx"]);
  });

  it("sends only fields the function reads, including name and phone", () => {
    expect(calls[0].keys.filter((k) => !accepted.includes(k))).toEqual([]);
    for (const required of ["name", "phone"]) {
      expect(calls[0].keys).toContain(required);
    }
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
    expect(writes.length).toBe(2); // submitLead, submitClaim
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

  it("the public blog list filters on the published flag only", () => {
    const filters = findObjectLiteralCalls(/base44\.entities\.BlogPost\.filter\(\s*/);
    expect(filters.length).toBe(1);
    expect(filters[0].keys).toEqual(["published"]);
    expect(blogPost.properties.published.type).toBe("boolean");
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
