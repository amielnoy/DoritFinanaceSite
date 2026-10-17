import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { AGENCY_PROFILE } from "@/config/agencyProfile";
import { AGENCY } from "../../supabase/functions/_shared/agency.ts";
import { PROMPTS } from "../../supabase/functions/chat/prompts.generated.ts";
import { fillPlaceholders } from "../../supabase/functions/chat/prompt.ts";
import {
  INTERVIEW_TOOL_SECTION,
  SUPPORT_TOOL_SECTION,
  PROCEDURES_TOOL_SECTION,
  BLOG_TOOL_SECTION,
  collapseBlankRuns,
  complianceExcerpt,
  readAgentInstructions,
  readInterviewInstructions,
  withToolSection,
  // @ts-expect-error — plain .mjs helper, imported for its pure steps.
} from "../helpers/chat-prompt-sources.mjs";
// @ts-expect-error — plain .mjs tooling.
import { renderPromptsModule, OUTPUT } from "../../scripts/build-chat-prompts.mjs";

const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");
const instructions: string = readInterviewInstructions(join(REPO_ROOT, "base44/agents/needs_interview.jsonc"));

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

describe("interview.md against the prompt Base44 runs today", () => {
  it("each tool-section change matches exactly one line of today's instructions", () => {
    for (const change of INTERVIEW_TOOL_SECTION) {
      expect(instructions.split("\n").filter((l) => l.startsWith(change.startsWith)), change.startsWith).toHaveLength(1);
    }
  });

  it("renders, for Dorit, to today's text byte for byte apart from the three tool-section lines and the two language lines", () => {
    expect(fillPlaceholders(PROMPTS.interview)).toBe(withToolSection(instructions, (s: string) => fillPlaceholders(s)));
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

const supportInstructions: string = readAgentInstructions(join(REPO_ROOT, "base44/agents/support_agent.jsonc"));

describe("support.md against the prompt Base44 runs today", () => {
  it("each replaced or removed line exists exactly once today", () => {
    const lines = supportInstructions.split("\n");
    for (const c of SUPPORT_TOOL_SECTION) {
      expect(lines.filter((l: string) => l.startsWith(c.startsWith)), c.startsWith).toHaveLength(1);
    }
  });

  it("equals today's instructions with only the tool section changed", () => {
    expect(fillPlaceholders(PROMPTS.support)).toBe(
      collapseBlankRuns(withToolSection(supportInstructions, (s: string) => fillPlaceholders(s), SUPPORT_TOOL_SECTION)),
    );
  });

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

const proceduresInstructions: string = readAgentInstructions(join(REPO_ROOT, "base44/agents/procedures_agent.jsonc"));

describe("procedures.md against the prompt Base44 runs today", () => {
  it("each replaced or removed line exists exactly once today", () => {
    const lines = proceduresInstructions.split("\n");
    for (const c of PROCEDURES_TOOL_SECTION) {
      expect(lines.filter((l: string) => l.startsWith(c.startsWith)), c.startsWith).toHaveLength(1);
    }
  });

  it("equals today's instructions with only the tool section changed", () => {
    expect(fillPlaceholders(PROMPTS.procedures)).toBe(
      collapseBlankRuns(withToolSection(proceduresInstructions, (s: string) => fillPlaceholders(s), PROCEDURES_TOOL_SECTION)),
    );
  });

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

const blogInstructions: string = readAgentInstructions(join(REPO_ROOT, "base44/agents/blog_recommender.jsonc"));
const matches = (l: string, c: { startsWith?: string; equals?: string }) => (c.equals !== undefined ? l === c.equals : l.startsWith(c.startsWith!));

describe("blog.md against the prompt Base44 runs today", () => {
  it("each replaced or removed line exists exactly once today", () => {
    const lines = blogInstructions.split("\n");
    for (const c of BLOG_TOOL_SECTION) expect(lines.filter((l: string) => matches(l, c)), JSON.stringify(c).slice(0, 60)).toHaveLength(1);
  });

  it("equals today's instructions with only the tool section changed", () => {
    expect(fillPlaceholders(PROMPTS.blog)).toBe(
      collapseBlankRuns(withToolSection(blogInstructions, (s: string) => fillPlaceholders(s), BLOG_TOOL_SECTION)),
    );
  });

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
