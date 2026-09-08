import { describe, expect, it } from "vitest";
import { loadEntity, validateAgainstEntity } from "../helpers/entity-schema";
import { findObjectLiteralCalls } from "../helpers/source-scan";

/**
 * These read the real call sites out of src/ rather than restating them, so a
 * field renamed in a form — or a new `source` value that is not in the entity
 * enum — fails here instead of silently 4xx-ing in production.
 */

describe("Lead.create payloads match the Lead entity", () => {
  const lead = loadEntity("Lead");
  const calls = findObjectLiteralCalls(/base44\.entities\.Lead\.create\(\s*/);

  it("finds every Lead.create call site", () => {
    expect(calls.length).toBe(3);
    expect(calls.map((c) => c.file).sort()).toEqual([
      "src/components/dorit/ConsultationBuilder.tsx",
      "src/components/dorit/DetailedContactForm.tsx",
      "src/components/dorit/QuickContact.tsx",
    ]);
  });

  for (const call of calls) {
    describe(call.file, () => {
      it("sends only fields the entity declares", () => {
        const undeclared = call.keys.filter((k) => !(k in lead.properties));
        expect(undeclared, `undeclared fields in ${call.file}`).toEqual([]);
      });

      it("sends both required fields (name, phone)", () => {
        for (const req of lead.required ?? []) {
          expect(call.keys, `${call.file} must send ${req}`).toContain(req);
        }
      });

      it("uses enum-legal literals for source and status", () => {
        for (const field of ["source", "status"] as const) {
          const literal = call.stringLiterals[field];
          if (literal === undefined) continue;
          expect(lead.properties[field].enum, `${call.file}.${field}`).toContain(literal);
        }
      });
    });
  }

  it("covers all three declared lead sources across the site", () => {
    const sources = calls.map((c) => c.stringLiterals.source).filter(Boolean).sort();
    expect(sources).toEqual([...(lead.properties.source.enum ?? [])].sort());
  });

  it("validates a representative payload from each form end to end", () => {
    const samples: Record<string, Record<string, unknown>> = {
      quick: { name: "ישראלה", phone: "050-0000000", email: "", source: "quick", message: "", status: "new" },
      detailed: {
        name: "ישראלה", phone: "050-0000000", email: "a@b.co", source: "detailed",
        topic: "ליווי תביעות", timing: "בוקר", message: "שאלה", status: "new",
      },
      consultation: {
        name: "ישראלה", phone: "050-0000000", email: "", source: "consultation",
        topic: "פנסיה ופיננסים", timing: "השבוע", message: "", status: "new",
      },
    };
    for (const [label, payload] of Object.entries(samples)) {
      expect(validateAgainstEntity(lead, payload), label).toEqual([]);
    }
  });

  it("rejects a payload with an unknown source or a stray field", () => {
    const issues = validateAgainstEntity(loadEntity("Lead"), {
      name: "x", phone: "1", source: "carrier-pigeon", utm_campaign: "spring",
    });
    expect(issues.map((i) => i.field).sort()).toEqual(["source", "utm_campaign"]);
  });
});

describe("BlogPost writes match the BlogPost entity", () => {
  const blogPost = loadEntity("BlogPost");

  it("the admin payload carries title and body and nothing undeclared", () => {
    const calls = findObjectLiteralCalls(/const payload\s*=\s*/);
    const adminPayload = calls.find((c) => c.file === "src/pages/BlogAdmin.tsx");
    expect(adminPayload, "BlogAdmin payload literal").toBeDefined();

    const undeclared = adminPayload!.keys.filter((k) => !(k in blogPost.properties));
    expect(undeclared).toEqual([]);
    for (const req of blogPost.required ?? []) {
      expect(adminPayload!.keys).toContain(req);
    }
  });

  it("publish toggles only flip the declared boolean field", () => {
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
      const undeclared = call.keys.filter((k) => !(k in testimonial.properties));
      expect(undeclared, call.file).toEqual([]);
      for (const req of testimonial.required ?? []) {
        expect(call.keys, `${call.file} must send ${req}`).toContain(req);
      }
    }
  });

  it("keeps the rating inside the declared 1..5 range", () => {
    expect(validateAgainstEntity(testimonial, { name: "א", quote: "ב", rating: 5 })).toEqual([]);
    expect(validateAgainstEntity(testimonial, { name: "א", quote: "ב", rating: 6 })).toHaveLength(1);
    expect(validateAgainstEntity(testimonial, { name: "א", quote: "ב", rating: 0 })).toHaveLength(1);
  });

  it("only accepts the declared review sources", () => {
    expect(testimonial.properties.source.enum).toEqual(["google", "midrag"]);
    expect(
      validateAgainstEntity(testimonial, { name: "א", quote: "ב", source: "yelp" })
    ).toHaveLength(1);
  });
});

describe("Core.SendEmail payloads", () => {
  const calls = findObjectLiteralCalls(/base44\.integrations\.Core\.SendEmail\(\s*/);

  it("every send supplies to, subject and body", () => {
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.keys.sort(), call.file).toEqual(["body", "subject", "to"]);
    }
  });

  it("never hardcodes a recipient inline — recipients come from named constants", () => {
    for (const call of calls) {
      expect(call.stringLiterals.to, `${call.file} inlines a recipient address`).toBeUndefined();
    }
  });
});
