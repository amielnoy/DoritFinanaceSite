import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { AGENCY_PROFILE } from "@/config/agencyProfile";
import { AGENCY } from "../../supabase/functions/_shared/agency.ts";
import { PROMPTS } from "../../supabase/functions/chat/prompts.generated.ts";
import { fillPlaceholders } from "../../supabase/functions/chat/prompt.ts";
// @ts-expect-error — plain .mjs helper, imported for its pure steps.
import { complianceExcerpt } from "../helpers/chat-prompt-sources.mjs";
// @ts-expect-error — plain .mjs tooling.
import { renderPromptsModule, OUTPUT } from "../../scripts/build-chat-prompts.mjs";

const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");

describe("the agency copy the chat function fills prompts from", () => {
  it.each(["displayName", "phoneDisplay", "email", "licenceEntity", "licenceNumber", "licenceRegulator"] as const)(
    "%s equals agencyProfile.ts",
    (key) => {
      expect(AGENCY[key]).toBe(AGENCY_PROFILE[key]);
    },
  );

  it("names the agency the tenant migration seeds", () => {
    expect(read("supabase/migrations/20261010000000_tenant_schema.sql")).toContain(`values ('${AGENCY.id}'`);
  });
});

// The Markdown prompts are the only source since the agents left Base44
// (2026-10-17); until then each was held, line for line, to the Base44 agent
// definition it replaced. What stays checked is what each prompt must say.
describe("interview.md", () => {
  it("carries the agency's details as placeholders, not literals", () => {
    for (const literal of ["050-831-1776", "dorit@govari-fin.co.il", "L-00107009"]) {
      expect(PROMPTS.interview).not.toContain(literal);
    }
    expect(fillPlaceholders(PROMPTS.interview)).not.toMatch(/\{\{agency\./);
  });

  it("interviews a visitor who writes in English in English, and keeps what reaches Dorit in Hebrew", () => {
    // The user's decision of 2026-10-14: en-01 (an English-only visitor) was handed
    // off under "דבר רק בעברית" instead of being interviewed.
    expect(PROMPTS.interview).not.toContain("דבר רק בעברית");
    expect(PROMPTS.interview).toMatch(/מבקר שכותב באנגלית — ראיין אותו באנגלית/);
    expect(PROMPTS.interview).toMatch(/אל תעביר מבקר לדורית רק משום שהוא כותב באנגלית/);
    expect(PROMPTS.interview).toMatch(/נכתב תמיד בעברית/);
  });

  it("asks for submitLead and never for a fenced block", () => {
    expect(PROMPTS.interview).not.toMatch(/```lead/);
    expect(PROMPTS.interview).toMatch(/קריאה ל-submitLead עם stage='complete'/);
  });
});

describe("compliance.md", () => {
  it("is COMPLIANCE.md §3 and §5, verbatim", () => {
    expect(PROMPTS.compliance).toBe(complianceExcerpt(read("docs/COMPLIANCE.md")));
  });

  it("no longer lists createConsultationEvent as an interview tool", () => {
    expect(read("docs/COMPLIANCE.md")).not.toMatch(/`submitLead`, `createConsultationEvent`/);
  });
});

describe("prompts.generated.ts", () => {
  it("is what the build script writes from the Markdown files today", () => {
    expect(read(OUTPUT)).toBe(renderPromptsModule(REPO_ROOT));
  });
});

describe("support.md", () => {
  it("names its real tools and no Base44 one", () => {
    expect(PROMPTS.support).toMatch(/listArticles/);
    expect(PROMPTS.support).toMatch(/readArticle/);
    expect(PROMPTS.support).toMatch(/escalateToHuman/);
    expect(PROMPTS.support).not.toMatch(/BlogPost|logSupportChat/);
    expect(PROMPTS.support).toMatch(/\(\/blog\/<slug>\)/);
  });

  it("carries the agency's details as placeholders, not literals", () => {
    for (const literal of ["050-831-1776", "dorit@govari-fin.co.il", "L-00107009"]) {
      expect(PROMPTS.support).not.toContain(literal);
    }
  });
});

describe("procedures.md", () => {
  it("names its real tools and no Base44 one", () => {
    expect(PROMPTS.procedures).toMatch(/listArticles/);
    expect(PROMPTS.procedures).toMatch(/readArticle/);
    expect(PROMPTS.procedures).toMatch(/escalateToHuman/);
    expect(PROMPTS.procedures).not.toMatch(/BlogPost|logSupportChat/);
    expect(PROMPTS.procedures).toMatch(/\(\/blog\/<slug>\)/);
  });

  it("carries the agency's details as placeholders, not literals", () => {
    for (const literal of ["050-831-1776", "dorit@govari-fin.co.il", "L-00107009"]) {
      expect(PROMPTS.procedures).not.toContain(literal);
    }
  });
});

describe("blog.md", () => {
  it("recommends through the tool, never a fenced block, and names no Base44 tool", () => {
    expect(PROMPTS.blog).toMatch(/recommendArticles/);
    expect(PROMPTS.blog).toMatch(/listArticles/);
    expect(PROMPTS.blog).toMatch(/escalateToHuman/);
    expect(PROMPTS.blog).not.toMatch(/```recommended|BlogPost/);
    // Base44 left two lines the site cannot honour: an anchor no page has, and a link by id.
    expect(PROMPTS.blog).not.toMatch(/#consultation|\/blog\/<id>/);
    expect(PROMPTS.blog).toMatch(/\(\/blog\/<slug>\)/);
  });

  it("carries the agency's details as placeholders, not literals", () => {
    for (const literal of ["050-831-1776", "dorit@govari-fin.co.il", "L-00107009"]) expect(PROMPTS.blog).not.toContain(literal);
  });
});
