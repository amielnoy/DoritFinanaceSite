import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * An interview's saves meet by the conversation, never by phone and name
 * (review 2026-10-15, item 9), read as source.
 */
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");
const sql = read("supabase/migrations/20261101000000_lead_conversation_ref.sql");
const handler = read("supabase/functions/submit-lead/handler.ts");

describe("the interview's conversation reference", () => {
  it("is a column with the reference's own shape, indexed where set", () => {
    expect(sql).toMatch(/add column conversation_ref text\s+check \(conversation_ref is null or conversation_ref ~ '\^\[A-Za-z0-9:_-\]\{8,100\}\$'\)/);
    expect(sql).toMatch(/create index leads_conversation_ref_idx on public\.leads \(conversation_ref\)\s+where conversation_ref is not null/);
  });

  it("is the only thing submit-lead finds an open interview by — never phone, name or address", () => {
    const lookup = handler.slice(handler.indexOf("async function findOpenInterview("), handler.indexOf("async function markMaslekaInvited("));
    expect(lookup).toContain("conversation_ref=eq.${encodeURIComponent(conversationRef)}");
    // It may read the name back (select=); it never filters or matches by one.
    expect(lookup).not.toMatch(/phone=eq\.|name=eq\.|email=eq\.|sameInterviewee/);
    expect(lookup).toMatch(/if \(!conversationRef\) return null;/);
  });

  it("is taken from the body only when well-formed, and stored on a new interview lead", () => {
    expect(handler).toMatch(/const safeRef = typeof conversationRef === 'string' && CONVERSATION_REF\.test\(conversationRef\) \? conversationRef : '';/);
    expect(handler).toMatch(/source === 'interview' && safeRef \? \{ conversation_ref: safeRef \}/);
  });
});
