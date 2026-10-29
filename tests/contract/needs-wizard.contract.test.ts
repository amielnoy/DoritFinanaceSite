import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/entity-schema";
import { CLEARINGHOUSE, CLEARINGHOUSE_TEXT, GOAL, LIFE_STAGE, TRACK_QUESTIONS, TRANSPARENCY, type Track } from "@/config/needs-wizard";

/**
 * The wizard and the interview agent collect the same profile, by the same keys.
 *
 * Three copies of the list exist and must agree: the agent's prompt (what
 * the chat asks), `submitLead`'s `INTERVIEW_TRACKS` (what it keeps — an unknown
 * key is dropped without a word), and the wizard's questions. A key renamed in
 * one place would reach Dorit from one path and silently vanish from the other.
 */

const instructions = readFileSync(join(REPO_ROOT, "supabase/functions/chat/prompts/interview.md"), "utf8");

const submitLead = readFileSync(join(REPO_ROOT, "supabase/functions/submit-lead/lead.js"), "utf8");

const TRACKS: Track[] = ["pension", "insurance", "retirement", "tax", "savings", "self_employed", "general"];

/** "  - pension: employer, seniority, products, fees." from the agent's profile section. */
function agentKeys(label: string): string[] {
  const line = instructions.split("\n").find((l) => new RegExp(`^\\s*-\\s*${label}:`).test(l));
  if (!line) throw new Error(`no profile line for "${label}" in prompts/interview.md`);
  return line.replace(/^\s*-\s*[^:]+:\s*/, "").replace(/\.\s*$/, "").split(/\s*,\s*/);
}

/** The keys of one INTERVIEW_TRACKS entry in submitLead, in order. */
function backendKeys(track: Track): string[] {
  const start = submitLead.indexOf(`  ${track}: {`, submitLead.indexOf("const INTERVIEW_TRACKS"));
  if (start < 0) throw new Error(`no INTERVIEW_TRACKS entry for ${track}`);
  // The fields array closes on its own indented line; each pair inside ends "]," too.
  const block = submitLead.slice(start, submitLead.indexOf("\n    ],", start));
  return [...block.matchAll(/\['([a-z_]+)'/g)].map((m) => m[1]);
}

describe("needs wizard ↔ interview agent ↔ submitLead", () => {
  it.each(TRACKS)("the %s track asks exactly the agent's keys, in its order", (track) => {
    expect(TRACK_QUESTIONS[track].map((q) => q.key)).toEqual(agentKeys(track));
  });

  it.each(TRACKS)("submitLead keeps every key the wizard sends for %s", (track) => {
    expect(TRACK_QUESTIONS[track].map((q) => q.key)).toEqual(backendKeys(track));
  });

  it("the always-asked keys match the agent's", () => {
    expect([LIFE_STAGE.key, GOAL.key, "concern", CLEARINGHOUSE.key].sort()).toEqual(agentKeys("תמיד").sort());
  });

  it("quotes the clearinghouse offer and the transparency sentence verbatim", () => {
    expect(instructions).toContain(CLEARINGHOUSE_TEXT);
    expect(instructions).toContain(TRANSPARENCY);
  });
});
