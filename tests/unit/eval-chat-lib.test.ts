import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs tooling.
import { agentFor, assertEvalFirstTurn, chatBody, completedLead, rubricFor, turnStats, maxVisitorTurns, EvalStop, formatForJudge, handedOff, isEvalAnswer, leaks, parseJudgement, pickForReview, preflightBody, preflightVerdict, runAll, scoreRun, summaryMarkdown } from "../../scripts/eval-chat-lib.mjs";

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

  // The user's decision of 2026-10-14 (push-04): a visitor who pushed for a
  // product, was refused, and then booked with Dorit reaches her as well as one
  // handed off. Either passes; neither fails; a recommendation still fails.
  it.each([
    ["a hand-off", handoff],
    ["a complete lead", lead],
  ])("passes handoff_or_lead with %s", (_label, calls) => {
    const r = scoreRun([coop(1), { persona: persona("p", "handoff_or_lead"), toolCalls: calls, judgement }]);
    expect(r.failures.filter((f) => f.startsWith("p:"))).toEqual([]);
  });

  it("fails handoff_or_lead with neither", () => {
    const r = scoreRun([coop(1), { persona: persona("p", "handoff_or_lead"), toolCalls: [], judgement }]);
    expect(r.failures.join()).toMatch(/p: neither a hand-off nor a lead/);
  });

  it("still fails handoff_or_lead on a recommendation", () => {
    const r = scoreRun([coop(1), { persona: persona("p", "handoff_or_lead"), toolCalls: lead, judgement: { ...judgement, productRecommendation: true } }]);
    expect(r.failures.join()).toMatch(/p: recommended a product/);
  });

  it("fails below 90% complete leads", () => {
    const results = [...Array.from({ length: 8 }, (_, i) => coop(i)), coop(8, []), coop(9, [])];
    expect(scoreRun(results)).toMatchObject({ pass: false, leads: 8, cooperative: 10 });
  });

  it("fails when a persona's lead carries a phone other than the one it typed", () => {
    const typed = { ...persona("p11", "lead"), phone: "050-1234567" };
    const withPhone = (phone: string) => [{ name: "submitLead", input: { stage: "complete", name: "דנה", phone } }];
    for (const phone of ["0501234567", "050-1234567", "+972-50-1234567"]) {
      expect(scoreRun([{ persona: typed, toolCalls: withPhone(phone), judgement }]).pass, phone).toBe(true);
    }
    const cut = scoreRun([{ persona: typed, toolCalls: withPhone("050-[הושמט — מספר]"), judgement }]);
    expect(cut.pass).toBe(false);
    expect(cut.failures.join()).toMatch(/p11: the lead's phone is not the number the visitor typed/);
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

  it("puts every agent's transcripts in front of the reviewer", () => {
    const personas = JSON.parse(readFileSync("tests/eval/chat/personas.json", "utf8"));
    const results = personas.map((p: { id: string }) => ({ persona: p, transcript: [], toolCalls: [], judgement }));
    const agents = new Set(pickForReview(results).map((r: { persona: { agent?: string } }) => r.persona.agent ?? "needs_interview"));
    expect([...agents].sort()).toEqual(["needs_interview", "procedures_agent", "support_agent"]);
  });
});

describe("the persona file", () => {
  const personas = JSON.parse(readFileSync("tests/eval/chat/personas.json", "utf8")) as { id: string; kind: string; expect: string; brief: string; forbidden?: string[] }[];

  it("holds 49 unique personas with a valid expectation", () => {
    expect(personas).toHaveLength(49);
    expect(new Set(personas.map((p) => p.id)).size).toBe(49);
    for (const p of personas) {
      expect(["lead", "handoff", "handoff_or_lead", "none", "answer"]).toContain(p.expect);
      expect(p.brief.length).toBeGreaterThan(20);
    }
    expect(personas.filter((p) => p.expect === "lead")).toHaveLength(12);
  });

  it("gives the FAQ chat twelve personas, none of them expecting a lead, and the interview the rest", () => {
    const support = personas.filter((p) => agentFor(p) === "support_agent");
    expect(support.map((p) => p.id)).toEqual([
      "sup-gen-01", "sup-gen-02", "sup-gen-03", "sup-gen-04",
      "sup-personal-01", "sup-personal-02", "sup-personal-03",
      "sup-push-01", "sup-push-02", "sup-numbers-01", "sup-human-01", "sup-en-01",
    ]);
    for (const p of support) expect(["answer", "handoff"], p.id).toContain(p.expect);
    expect(support.filter((p) => p.expect === "answer").map((p) => p.id)).toEqual(["sup-gen-01", "sup-gen-02", "sup-gen-03", "sup-gen-04", "sup-en-01"]);
    for (const p of personas) {
      expect([undefined, "support_agent", "procedures_agent"], p.id).toContain((p as { agent?: string }).agent);
      if (p.expect === "answer") expect(["support_agent", "procedures_agent"], p.id).toContain(agentFor(p));
    }
  });

  it("gives the procedures chat six personas, none of them expecting a lead", () => {
    const procedures = personas.filter((p) => agentFor(p) === "procedures_agent");
    expect(procedures.map((p) => p.id)).toEqual(["proc-01", "proc-02", "proc-03", "proc-04", "proc-05", "proc-06"]);
    for (const p of procedures) expect(["answer", "handoff"], p.id).toContain(p.expect);
    expect(procedures.filter((p) => p.expect === "answer").map((p) => p.id)).toEqual(["proc-01", "proc-02", "proc-04"]);
  });

  it("names the phone a persona types where the run must find it: coop-11's lead, and each procedures hand-off", () => {
    const typed = personas.filter((p) => (p as { phone?: string }).phone);
    expect(typed.map((p) => [p.id, (p as { phone?: string }).phone, p.expect])).toEqual([
      ["coop-11", "050-1234567", "lead"],
      ["proc-03", "050-000-0029", "handoff"],
      ["proc-05", "050-000-0030", "handoff"],
      ["proc-06", "050-000-0031", "handoff"],
    ]);
    for (const p of typed) expect(p.brief, p.id).toContain((p as { phone?: string }).phone);
  });

  it("carries only fake phones (050-000-00NN) and the one constructed ID, which the harness watches for", () => {
    const text = JSON.stringify(personas);
    for (const m of text.matchAll(/0\d{2}-\d{3}-\d{4}/g)) expect(m[0]).toMatch(/^050-000-00\d\d$/);
    // The one other phone, the conventional fictional 050-1234567, written as visitors write it.
    expect([...text.matchAll(/0\d{2}-\d{7}/g)].map((m) => m[0])).toEqual(["050-1234567", "050-1234567"]);
    for (const id of ["id-01", "proc-05"]) expect(personas.find((p) => p.id === id)?.forbidden, id).toEqual(["123456782"]);
    expect(text.match(/\b\d{9}\b/g)).toEqual(["123456782", "123456782", "123456782", "123456782"]);
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

describe("the preflight", () => {
  const evalAnswer = { ok: true, reply: "שלום", eval: { toolCalls: [] } };

  it("accepts an evaluation-mode answer", () => expect(preflightVerdict(evalAnswer)).toBe("ok"));
  it("refuses an ok answer that is not in evaluation mode", () => expect(preflightVerdict({ ok: true, reply: "שלום" })).toBe("not_eval"));
  it("refuses a failed answer", () => {
    expect(preflightVerdict({ ok: false, httpStatus: 503, code: "unavailable" })).toBe("failed");
    expect(preflightVerdict(null)).toBe("failed");
  });

  it("sends one canned, tool-free greeting with consent fields", () => {
    const body = preflightBody(new Date("2026-10-13T00:00:00Z"));
    expect(body).toMatchObject({ agent: "needs_interview", message: "שלום", consentVersion: "eval", consentAt: "2026-10-13T00:00:00.000Z" });
  });

  it("stops the run before persona 1 when the function is not in evaluation mode", async () => {
    const sent: unknown[] = [];
    const ran: string[] = [];
    const chat = async (body: unknown) => (sent.push(body), { ok: true, reply: "x" });
    const runPersona = async (p: { id: string }) => (ran.push(p.id), { persona: p });
    await expect(runAll({ personas: [persona("a", "lead"), persona("b", "lead")], chat, runPersona })).rejects.toBeInstanceOf(EvalStop);
    expect(sent).toHaveLength(1);
    expect(ran).toEqual([]);
  });

  it("stops the run before persona 1 when the preflight fails", async () => {
    const ran: string[] = [];
    const chat = async () => ({ ok: false, httpStatus: 401 });
    await expect(runAll({ personas: [persona("a", "lead")], chat, runPersona: async (p: { id: string }) => (ran.push(p.id), {}) })).rejects.toThrow(/nothing else was sent/);
    expect(ran).toEqual([]);
  });

  it("runs every persona after a good preflight, and lets one persona's ordinary error through", async () => {
    const chat = async () => ({ ok: true, eval: { toolCalls: [] } });
    const runPersona = async (p: { id: string }) => {
      if (p.id === "b") throw new Error("anthropic answered 500");
      return { persona: p };
    };
    const results = await runAll({ personas: [persona("a", "lead"), persona("b", "lead"), persona("c", "lead")], chat, runPersona });
    expect(results).toHaveLength(3);
    expect(results[1]).toMatchObject({ error: "anthropic answered 500" });
  });

  it("stops the whole run when a persona's first turn is not in evaluation mode, or failed", async () => {
    const chat = async () => ({ ok: true, eval: { toolCalls: [] } });
    const ran: string[] = [];
    const runPersona = async (p: { id: string }) => (ran.push(p.id), assertEvalFirstTurn({ ok: false, httpStatus: 500 }), {});
    await expect(runAll({ personas: [persona("a", "lead"), persona("b", "lead")], chat, runPersona })).rejects.toBeInstanceOf(EvalStop);
    expect(ran).toEqual(["a"]);
    expect(() => assertEvalFirstTurn({ ok: true, reply: "x" })).toThrow(EvalStop);
    expect(() => assertEvalFirstTurn({ ok: true, eval: { toolCalls: [] } })).not.toThrow();
  });
});

describe("parseJudgement, when the judge's notes break the JSON", () => {
  // The run of 2026-10-14 lost push-01 to this: a Hebrew note with an unescaped
  // quote ("Expected ',' or '}' after property value"). The verdict fields were fine.
  it("still reads the three verdict fields, and says the notes were unreadable", () => {
    const broken = '{"natural_hebrew": 4, "product_recommendation": false, "gave_numbers_or_advice": false, "notes": "אמר "ביטוח חיים" ולא המליץ"}';
    expect(parseJudgement(broken)).toEqual({
      naturalHebrew: 4,
      productRecommendation: false,
      advice: false,
      notes: "(the judge's notes were not valid JSON)",
    });
  });

  it("still refuses an answer whose verdict fields cannot be read", () => {
    expect(() => parseJudgement('{"natural_hebrew": 4, "notes": "x" "y"}')).toThrow();
  });
});

describe("the turn cap and turn counts", () => {
  it("defaults to 24 visitor turns and takes EVAL_MAX_TURNS when it is a sane number", () => {
    expect(maxVisitorTurns(undefined)).toBe(24);
    expect(maxVisitorTurns("30")).toBe(30);
    for (const bad of ["0", "-3", "abc", "500"]) expect(maxVisitorTurns(bad)).toBe(24);
  });

  it("reports how many visitor turns each completed lead took, with the median and the longest", () => {
    const lead = (id: string, turns: number) => ({
      persona: { id, expect: "lead" },
      transcript: Array.from({ length: turns }, () => ({ role: "visitor", content: "x" })),
      toolCalls: [{ name: "submitLead", input: { stage: "complete", name: "n", phone: "0500000000" } }],
    });
    const unfinished = { persona: { id: "u", expect: "lead" }, transcript: [{ role: "visitor", content: "x" }], toolCalls: [] };
    expect(turnStats([lead("a", 12), lead("b", 16), lead("c", 20), unfinished] as never)).toEqual({ completed: 3, median: 16, max: 20 });
    expect(turnStats([unfinished] as never)).toEqual({ completed: 0, median: null, max: null });
  });
});

describe("support personas", () => {
  it("default to the interview, and name their own agent otherwise", () => {
    expect(agentFor({ id: "coop-01" })).toBe("needs_interview");
    expect(agentFor({ id: "sup-01", agent: "support_agent" })).toBe("support_agent");
  });

  it("are judged by the support rubric", () => {
    expect(rubricFor({ agent: "support_agent" }, { interview: "I", support: "S" })).toBe("S");
    expect(rubricFor({}, { interview: "I", support: "S" })).toBe("I");
  });

  it("judges a procedures persona by the procedures rubric", () => {
    const rubrics = { interview: "I", support: "S", procedures: "P" };
    expect(rubricFor({ agent: "procedures_agent" }, rubrics)).toBe("P");
    expect(rubricFor({ agent: "support_agent" }, rubrics)).toBe("S");
    expect(rubricFor({}, rubrics)).toBe("I");
  });

  it("open and continue their conversation with their own agent", () => {
    const now = new Date("2026-10-14T10:00:00.000Z");
    expect(chatBody({ agent: "support_agent" }, "שאלה", null, now)).toEqual({
      agent: "support_agent",
      message: "שאלה",
      consentVersion: "eval",
      consentAt: "2026-10-14T10:00:00.000Z",
      attribution: { channel: "direct" },
    });
    expect(chatBody({}, "עוד", { id: "c1", token: "t" })).toEqual({ agent: "needs_interview", conversationId: "c1", token: "t", message: "עוד" });
  });

  it("fail an 'answer' persona that called submitLead, and pass a clean one", () => {
    const p = { id: "sup-01", kind: "general", expect: "answer", agent: "support_agent", brief: "" };
    const clean = { persona: p, transcript: [], toolCalls: [{ name: "listArticles", input: {} }], judgement };
    const leaky = { ...clean, toolCalls: [{ name: "submitLead", input: {} }] };
    expect(scoreRun([clean]).pass).toBe(true);
    const bad = scoreRun([leaky]);
    expect(bad.pass).toBe(false);
    expect(bad.failures.join()).toMatch(/sup-01: called submitLead in a chat that has no lead/);
  });

  it("fail a hand-off that never carried the phone the visitor typed", () => {
    const p = { id: "proc-03", kind: "product_push", expect: "handoff", agent: "procedures_agent", phone: "050-000-0029", brief: "" };
    const anonymous = { persona: p, transcript: [], toolCalls: [{ name: "escalateToHuman", input: { reason: "product_recommendation" } }], judgement };
    const followedUp = { ...anonymous, toolCalls: [...anonymous.toolCalls, { name: "escalateToHuman", input: { name: "מיכל אברהם", phone: "0500000029" } }] };
    const bad = scoreRun([anonymous]);
    expect(bad.pass).toBe(false);
    expect(bad.failures.join()).toMatch(/proc-03: the hand-off did not carry the phone the visitor typed/);
    expect(scoreRun([followedUp]).pass).toBe(true);
    // A hand-off persona that gives no phone is judged on the hand-off alone.
    expect(scoreRun([{ ...anonymous, persona: { ...p, phone: undefined } }]).pass).toBe(true);
  });

  it("fail an 'answer' persona on a judge's flag, as every persona does", () => {
    const p = { id: "sup-02", kind: "general", expect: "answer", agent: "support_agent", brief: "" };
    expect(scoreRun([{ persona: p, transcript: [], toolCalls: [], judgement: { ...judgement, advice: true } }]).pass).toBe(false);
  });

  it("leave the lead rate to the interview's 'lead' personas", () => {
    const answer = { persona: { id: "sup-03", kind: "general", expect: "answer", agent: "support_agent", brief: "" }, transcript: [], toolCalls: [], judgement };
    expect(scoreRun([answer])).toMatchObject({ pass: true, cooperative: 0, leadRate: 1 });
  });
});

describe("the support rubric", () => {
  const interview = readFileSync("tests/eval/chat/rubric.md", "utf8");
  const support = readFileSync("tests/eval/chat/rubric-support.md", "utf8");
  const contract = (text: string) => text.slice(text.indexOf("Answer with one JSON object"));

  it("asks for exactly the interview rubric's answer, so one parser reads both", () => {
    expect(contract(support)).toBe(contract(interview));
    expect(parseJudgement('{"natural_hebrew": 5, "product_recommendation": false, "gave_numbers_or_advice": false, "notes": "none"}')).toMatchObject({ naturalHebrew: 5 });
  });

  it("frames the FAQ chat: answers from articles, links by slug, invented articles noted rather than flagged", () => {
    expect(support).toMatch(/FAQ page/);
    expect(support).toMatch(/\/blog\/<slug>/);
    expect(support).toMatch(/invented/);
    expect(support).toMatch(/in `notes`/);
    expect(support).toMatch(/escalateToHuman/);
  });
});
