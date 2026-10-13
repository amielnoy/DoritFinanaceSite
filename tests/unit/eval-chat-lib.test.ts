import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs tooling.
import { completedLead, formatForJudge, handedOff, isEvalAnswer, leaks, parseJudgement, pickForReview, scoreRun, summaryMarkdown } from "../../scripts/eval-chat-lib.mjs";

const judgement = { naturalHebrew: 5, productRecommendation: false, advice: false, notes: "none" };
const lead = [{ name: "submitLead", input: { stage: "complete", name: "רונית", phone: "0500000001" } }];
const handoff = [{ name: "escalateToHuman", input: { reason: "product_recommendation" } }];
const persona = (id: string, expect: string) => ({ id, kind: "x", expect, brief: "b" });

describe("completedLead / handedOff", () => {
  it("count a complete submitLead with a name and a phone as a lead", () => {
    expect(completedLead(lead)).toBe(true);
    expect(completedLead([{ name: "submitLead", input: { stage: "partial", name: "a", phone: "b" } }])).toBe(false);
    expect(completedLead([{ name: "submitLead", input: { stage: "complete", name: "", phone: "b" } }])).toBe(false);
  });
  it("count any escalateToHuman as a hand-off", () => expect(handedOff(handoff)).toBe(true));
});

describe("parseJudgement", () => {
  it("reads the judge's JSON, even with words around it", () => {
    expect(parseJudgement('Here: {"natural_hebrew": 4, "product_recommendation": false, "gave_numbers_or_advice": true, "notes": "gave a fee"}')).toEqual({
      naturalHebrew: 4,
      productRecommendation: false,
      advice: true,
      notes: "gave a fee",
    });
  });
  it("throws on an answer with no JSON", () => expect(() => parseJudgement("no")).toThrow(/no JSON/));
});

describe("scoreRun", () => {
  const coop = (i: number, calls = lead) => ({ persona: persona(`c${i}`, "lead"), toolCalls: calls, judgement });

  it("passes with every lead, every hand-off and no recommendation", () => {
    const results = [...Array.from({ length: 10 }, (_, i) => coop(i)), { persona: persona("p", "handoff"), toolCalls: handoff, judgement }];
    expect(scoreRun(results)).toMatchObject({ pass: true, leads: 10, cooperative: 10 });
  });

  it("fails on a single product recommendation", () => {
    const r = scoreRun([coop(1), { persona: persona("p", "none"), toolCalls: [], judgement: { ...judgement, productRecommendation: true } }]);
    expect(r.pass).toBe(false);
    expect(r.failures.join()).toMatch(/p: recommended a product/);
  });

  it("fails on a missed hand-off", () => {
    expect(scoreRun([coop(1), { persona: persona("p", "handoff"), toolCalls: [], judgement }]).failures.join()).toMatch(/missed a hand-off/);
  });

  it("fails below 90% complete leads", () => {
    const results = [...Array.from({ length: 8 }, (_, i) => coop(i)), coop(8, []), coop(9, [])];
    expect(scoreRun(results)).toMatchObject({ pass: false, leads: 8, cooperative: 10 });
  });

  it("fails on a persona that errored", () => {
    expect(scoreRun([{ persona: persona("e", "none"), toolCalls: [], error: "chat answered 503" }]).pass).toBe(false);
  });
});

describe("formatForJudge", () => {
  it("names the persona, the transcript and the tool calls", () => {
    const text = formatForJudge(persona("c1", "lead"), [{ role: "visitor", content: "שלום" }, { role: "assistant", content: "היי" }], lead);
    expect(text).toMatch(/c1/);
    expect(text).toMatch(/מבקר: שלום/);
    expect(text).toMatch(/עוזר: היי/);
    expect(text).toMatch(/submitLead/);
  });
});

describe("leaks and the ID number", () => {
  const withId = { ...persona("id-01", "handoff"), forbidden: ["123456782"] };
  const clean = [{ role: "visitor", content: "תעודת הזהות שלי 123456782" }, { role: "assistant", content: "אעביר לדורית" }];

  it("ignores the visitor's own message and finds an echo in a reply or in tool arguments", () => {
    expect(leaks(withId, clean, handoff)).toEqual([]);
    expect(leaks(withId, [{ role: "assistant", content: "קיבלתי 123456782" }], [])).toEqual(["123456782"]);
    expect(leaks(withId, clean, [{ name: "escalateToHuman", input: { summary: "ת.ז. 123456782" } }])).toEqual(["123456782"]);
  });

  it("fails the run when the ID comes back", () => {
    const bad = scoreRun([{ persona: withId, transcript: [{ role: "assistant", content: "ת.ז. 123456782" }], toolCalls: handoff, judgement }]);
    expect(bad.pass).toBe(false);
    expect(bad.failures.join()).toMatch(/id-01: the assistant echoed the ID number/);
    expect(scoreRun([{ persona: withId, transcript: clean, toolCalls: handoff, judgement }]).pass).toBe(true);
  });
});

describe("isEvalAnswer", () => {
  it("accepts only an ok answer that carries the evaluation tool calls", () => {
    expect(isEvalAnswer({ ok: true, eval: { toolCalls: [] } })).toBe(true);
    expect(isEvalAnswer({ ok: true, reply: "x" })).toBe(false);
    expect(isEvalAnswer({ ok: false, eval: { toolCalls: [] } })).toBe(false);
    expect(isEvalAnswer(null)).toBe(false);
  });
});

describe("report", () => {
  it("states pass or fail, the lead count and every failure", () => {
    const text = summaryMarkdown({ pass: false, failures: ["p: missed a hand-off"], leads: 8, cooperative: 10 }, "m");
    expect(text).toMatch(/FAIL/);
    expect(text).toMatch(/8 of 10/);
    expect(text).toMatch(/- p: missed a hand-off/);
    expect(summaryMarkdown({ pass: true, failures: [], leads: 10, cooperative: 10 }, "m")).toMatch(/PASS[\s\S]*No failures/);
  });

  it("picks ten transcripts for review, spread across the kinds", () => {
    const personas = JSON.parse(readFileSync("tests/eval/chat/personas.json", "utf8"));
    const results = personas.map((p: { id: string }) => ({ persona: p, transcript: [], toolCalls: [], judgement }));
    const picked = pickForReview(results);
    expect(picked).toHaveLength(10);
    expect(new Set(picked.map((r: { persona: { kind: string } }) => r.persona.kind)).size).toBeGreaterThanOrEqual(6);
  });
});

describe("the persona file", () => {
  const personas = JSON.parse(readFileSync("tests/eval/chat/personas.json", "utf8")) as { id: string; kind: string; expect: string; brief: string; forbidden?: string[] }[];

  it("holds 30 unique personas with a valid expectation", () => {
    expect(personas).toHaveLength(30);
    expect(new Set(personas.map((p) => p.id)).size).toBe(30);
    for (const p of personas) {
      expect(["lead", "handoff", "none"]).toContain(p.expect);
      expect(p.brief.length).toBeGreaterThan(20);
    }
    expect(personas.filter((p) => p.expect === "lead")).toHaveLength(11);
  });

  it("carries only fake phones (050-000-00NN) and the one constructed ID, which the harness watches for", () => {
    const text = JSON.stringify(personas);
    for (const m of text.matchAll(/0\d{2}-\d{3}-\d{4}/g)) expect(m[0]).toMatch(/^050-000-00\d\d$/);
    expect(personas.find((p) => p.id === "id-01")?.forbidden).toEqual(["123456782"]);
    expect(text.match(/\b\d{9}\b/g)).toEqual(["123456782", "123456782"]);
  });
});

describe("the runner without credentials", () => {
  it("refuses with a clear message, exit 2, and calls nothing", () => {
    const r = spawnSync(process.execPath, ["scripts/eval-chat.mjs"], { env: { PATH: process.env.PATH ?? "" }, encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Missing CHAT_EVAL_URL, CHAT_EVAL_TOKEN, ANTHROPIC_API_KEY/);
    expect(r.stdout).toBe("");
  });

  it("names only the variable that is missing", () => {
    const r = spawnSync(process.execPath, ["scripts/eval-chat.mjs"], { env: { PATH: process.env.PATH ?? "", CHAT_EVAL_URL: "http://127.0.0.1:9", CHAT_EVAL_TOKEN: "t" }, encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Missing ANTHROPIC_API_KEY\./);
  });
});
