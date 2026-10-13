import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { MAX_MESSAGE_CHARS as CLIENT_MAX_CHARS, MAX_TURNS_PER_CONVERSATION } from "@/services/agent-errors";
import { SupabaseAgentService } from "@/services/supabase/SupabaseAgentService";
import { MAX_CONSENT_VERSION_CHARS, MAX_MESSAGE_CHARS, MAX_TURNS } from "../../supabase/functions/chat/handler.ts";
import { ESCALATION_REASONS, INTERVIEW_TOOLS } from "../../supabase/functions/chat/tools.ts";

const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");

/** The names a handler destructures from its request body. */
function destructured(src: string): string[] {
  const m = /const \{([^}]+)\} = body \|\| \{\};/.exec(src);
  if (!m) throw new Error("no `const { … } = body || {};` in the handler");
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}
const properties = (name: string) =>
  Object.keys((INTERVIEW_TOOLS.find((t) => t.name === name)!.input_schema as { properties: object }).properties);

describe("the chat function's tools", () => {
  it("submitLead asks the model only for fields submit-lead reads", () => {
    const reads = destructured(read("supabase/functions/submit-lead/handler.ts"));
    for (const field of properties("submitLead")) expect(reads, field).toContain(field);
  });

  it("escalateToHuman asks the model only for fields escalate-to-human reads", () => {
    const reads = destructured(read("supabase/functions/escalate-to-human/handler.ts"));
    for (const field of properties("escalateToHuman")) expect(reads, field).toContain(field);
  });

  it("offers exactly the hand-off reasons escalate-to-human knows", () => {
    const src = read("supabase/functions/escalate-to-human/escalation.js");
    const block = src.slice(src.indexOf("export const REASONS = {"), src.indexOf("};", src.indexOf("export const REASONS = {")));
    const known = [...block.matchAll(/^\s+([a-z_]+):/gm)].map((m) => m[1]);
    expect([...ESCALATION_REASONS]).toEqual(known);
  });
});

describe("the chat function's registration and limits", () => {
  it("is public, like the forms, and registered", () => {
    expect(read("supabase/config.toml")).toMatch(/\[functions\.chat\]\s*\nverify_jwt = false/);
  });

  it("enforces the same limits the page states", () => {
    expect(MAX_MESSAGE_CHARS).toBe(CLIENT_MAX_CHARS);
    expect(MAX_TURNS).toBe(MAX_TURNS_PER_CONVERSATION);
  });

  it("accepts no consent version longer than submit-lead's column holds", () => {
    // A longer version would open a conversation whose every submitLead fails with a 400.
    const limits = read("supabase/functions/submit-lead/lead.js");
    const column = Number(/export const LEAD_FIELD_LIMITS = \{[^}]*\bconsent_version: (\d+),/.exec(limits)?.[1]);
    expect(column).toBeGreaterThan(0);
    expect(MAX_CONSENT_VERSION_CHARS).toBe(column);
  });
});

describe("adapter → chat", () => {
  it("sends only fields the function reads", async () => {
    const handlerSrc = read("supabase/functions/chat/handler.ts");
    const reads = new Set([...handlerSrc.matchAll(/str\(input\.(\w+)\)|input\.(\w+)/g)].map((m) => m[1] ?? m[2]));
    const bodies: Record<string, unknown>[] = [];
    const svc = new SupabaseAgentService(
      { functions: { invoke: async (_n: string, { body }: { body: Record<string, unknown> }) => (bodies.push(body), { data: { ok: true, conversationId: "s", token: "t".repeat(64), reply: "r" }, error: null }) } },
      () => "l",
    );
    const conv = await svc.start("needs_interview", { consent_version: "v6", consent_at: "2026-10-13T09:00:00.000Z" });
    await svc.send(conv, "1");
    await svc.send(conv, "2");
    for (const body of bodies) for (const key of Object.keys(body)) expect(reads, key).toContain(key);
  });
});
