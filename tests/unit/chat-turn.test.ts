import { describe, expect, it, vi } from "vitest";
import { ModelError, type ModelClient, type ModelRequest, type ModelResponse } from "../../supabase/functions/chat/anthropic.ts";
import { MAX_REPLY_TOKENS, runTurn, toModelHistory, TurnFailure } from "../../supabase/functions/chat/turn.ts";
import type { ToolOutcome } from "../../supabase/functions/chat/tools.ts";

const usage = { input: 100, cached: 0, output: 10 };
const text = (t: string): ModelResponse => ({ content: [{ type: "text", text: t }], stopReason: "end_turn", usage, model: "claude-haiku-5-5" });
const toolUse = (name: string, input: Record<string, unknown>, id = "tu_1"): ModelResponse => ({
  content: [{ type: "text", text: "רגע…" }, { type: "tool_use", id, name, input }],
  stopReason: "tool_use",
  usage,
  model: "claude-haiku-5-5",
});

function scripted(steps: (ModelResponse | Error)[]): ModelClient & { calls: ModelRequest[] } {
  const calls: ModelRequest[] = [];
  return {
    model: "claude-haiku-5-5",
    calls,
    async complete(req) {
      calls.push({ ...req, messages: [...req.messages] });
      const step = steps.shift();
      if (!step) throw new Error("no scripted step left");
      if (step instanceof Error) throw step;
      return step;
    },
  };
}
const ok: ToolOutcome = { name: "submitLead", status: "ok", forModel: '{"ok":true}', isError: false, leadId: "l1", leadSaved: true };
const base = { system: [], tools: [], history: [{ role: "user" as const, content: "שלום" }] };

describe("toModelHistory", () => {
  it("drops tool rows, merges consecutive turns of one side, and starts with the visitor", () => {
    expect(
      toModelHistory([
        { role: "assistant", content: "ברוך הבא" },
        { role: "user", content: "א" },
        { role: "user", content: "ב" },
        { role: "tool", content: "submitLead: ok" },
        { role: "assistant", content: "תודה" },
      ]),
    ).toEqual([
      { role: "user", content: "א\n\nב" },
      { role: "assistant", content: "תודה" },
    ]);
  });
});

describe("runTurn", () => {
  it("returns the reply when the model answers in words", async () => {
    const out = await runTurn({ ...base, model: scripted([text("שלום! במה אפשר לעזור?")]), runTool: vi.fn() });
    expect(out.reply).toBe("שלום! במה אפשר לעזור?");
    expect(out.usage).toEqual([{ model: "claude-haiku-5-5", ...usage }]);
  });

  it("runs a tool, hands the result back, and returns the closing reply", async () => {
    const model = scripted([toolUse("submitLead", { stage: "complete" }), text("נשמר. דורית תחזור אלייך.")]);
    const runTool = vi.fn(async () => ok);
    const out = await runTurn({ ...base, model, runTool });
    expect(runTool).toHaveBeenCalledWith("submitLead", { stage: "complete" });
    expect(model.calls[1].messages.at(-1)).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: '{"ok":true}' }] });
    expect(out).toMatchObject({ reply: "נשמר. דורית תחזור אלייך.", tools: [ok], toolCalls: [{ name: "submitLead", input: { stage: "complete" } }] });
  });

  it("marks a failed tool as an error for the model", async () => {
    const model = scripted([toolUse("submitLead", {}), text("לא הצלחתי לשמור.")]);
    await runTurn({ ...base, model, runTool: async () => ({ ...ok, status: "error", isError: true, forModel: '{"ok":false}' }) });
    expect(model.calls[1].messages.at(-1)).toMatchObject({ content: [{ is_error: true }] });
  });

  it("allows three tool rounds, then asks for the reply with tools switched off", async () => {
    // The evaluation of 2026-10-14: after a confirmed summary the model chained a
    // hand-off and two saves and asked for a fourth tool; the turn failed with 503
    // although the lead was saved. The fourth call now forbids tools.
    const model = scripted([toolUse("a", {}, "1"), toolUse("a", {}, "2"), toolUse("a", {}, "3"), text("הפרטים אצל דורית, והיא תחזור אלייך.")]);
    const runTool = vi.fn(async () => ok);
    const out = await runTurn({ ...base, model, runTool });
    expect(out.reply).toBe("הפרטים אצל דורית, והיא תחזור אלייך.");
    expect(runTool).toHaveBeenCalledTimes(3);
    expect(out.tools).toHaveLength(3);
    expect(model.calls.map((c) => c.toolChoice)).toEqual([undefined, undefined, undefined, "none"]);
    // The tools stay listed: the conversation holds tool_use blocks that name them.
    expect(model.calls[3].tools).toBe(base.tools);
  });

  it("still fails when the model asks for a tool even with tools switched off", async () => {
    const model = scripted([toolUse("a", {}, "1"), toolUse("a", {}, "2"), toolUse("a", {}, "3"), toolUse("a", {}, "4")]);
    const err = await runTurn({ ...base, model, runTool: async () => ok }).catch((e) => e);
    expect(err).toBeInstanceOf(TurnFailure);
    expect(err.reason).toBe("too_many_tool_rounds");
    expect(err.tools).toHaveLength(3);
  });

  it("retries once when the first failure comes early", async () => {
    const out = await runTurn({ ...base, model: scripted([new ModelError("http", 529), text("שלום")]), runTool: vi.fn() });
    expect(out.reply).toBe("שלום");
  });

  it("fails without a retry when the first failure comes after ten seconds", async () => {
    let t = 0;
    const model: ModelClient = {
      model: "m",
      async complete() {
        t += 11_000;
        throw new ModelError("http", 529);
      },
    };
    const err = await runTurn({ ...base, model, runTool: vi.fn(), now: () => t }).catch((e) => e);
    expect(err).toBeInstanceOf(TurnFailure);
    expect(err.reason).toBe("model_http_529");
  });

  it("fails on a second failure, keeping what the tools already did", async () => {
    const model = scripted([toolUse("submitLead", {}), new ModelError("timeout"), new ModelError("timeout")]);
    const err = await runTurn({ ...base, model, runTool: async () => ok }).catch((e) => e);
    expect(err.reason).toBe("model_timeout");
    expect(err.tools).toEqual([ok]);
  });

  it("fails a reply cut off at max_tokens inside a tool call, without running the tool or returning its text", async () => {
    // The model began the closing submitLead and ran out of tokens: the arguments are partial.
    const cut: ModelResponse = {
      content: [{ type: "text", text: "מעולה, אני שומרת את הפרטים" }, { type: "tool_use", id: "tu_1", name: "submitLead", input: { stage: "complete", name: "רונית" } }],
      stopReason: "max_tokens",
      usage,
      model: "claude-haiku-5-5",
    };
    const runTool = vi.fn(async () => ok);
    const err = await runTurn({ ...base, model: scripted([cut]), runTool }).catch((e) => e);
    expect(err).toBeInstanceOf(TurnFailure);
    expect(err.reason).toBe("truncated_tool_call");
    expect(err.usage).toHaveLength(1);
    expect(runTool).not.toHaveBeenCalled();
  });

  // 2,048 cut a complete save off mid-profile in the evaluation of 2026-10-14
  // (run 5, truncated_tool_call): a long Hebrew profile and summary need more.
  it("asks for up to 4,096 reply tokens, room for a full Hebrew profile and summary", async () => {
    const model = scripted([text("שלום")]);
    await runTurn({ ...base, model, runTool: vi.fn() });
    expect(MAX_REPLY_TOKENS).toBe(4096);
    expect(model.calls[0].maxTokens).toBe(4096);
  });

  it("refuses an empty reply", async () => {
    const err = await runTurn({ ...base, model: scripted([text("   ")]), runTool: vi.fn() }).catch((e) => e);
    expect(err.reason).toBe("empty_reply");
  });

  // The evaluation of 2026-10-14: after a quiet partial save the model twice
  // answered with nothing (one output token), and the visitor got a 503 mid-interview.
  it("asks once more when the reply after a tool is empty, and returns the second answer", async () => {
    const model = scripted([toolUse("submitLead", { stage: "partial" }), text(""), text("תודה. ולכמה זמן הכסף מיועד?")]);
    const runTool = vi.fn(async () => ok);
    const result = await runTurn({ ...base, model, runTool });
    expect(result.reply).toBe("תודה. ולכמה זמן הכסף מיועד?");
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(model.calls).toHaveLength(3);
    // The retry sends the same conversation: nothing invented on the visitor's behalf.
    expect(model.calls[2].messages).toEqual(model.calls[1].messages);
    expect(result.usage).toHaveLength(3);
  });

  it("still fails when the reply after a tool is empty twice", async () => {
    const model = scripted([toolUse("submitLead", { stage: "partial" }), text(""), text(" ")]);
    const err = await runTurn({ ...base, model, runTool: vi.fn(async () => ok) }).catch((e) => e);
    expect(err.reason).toBe("empty_reply");
    expect(model.calls).toHaveLength(3);
  });
});
