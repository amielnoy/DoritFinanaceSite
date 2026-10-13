import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelClient, ModelRequest, ModelResponse } from "../../supabase/functions/chat/anthropic.ts";
import { ModelError } from "../../supabase/functions/chat/anthropic.ts";
import type { UsageTotals } from "../../supabase/functions/chat/budget.ts";
import { createChatHandler, MAX_CONSENT_VERSION_CHARS, type ChatDeps } from "../../supabase/functions/chat/handler.ts";
import type { ChatStore, ConversationRow, NewConversation, UpdateOptions } from "../../supabase/functions/chat/store.ts";
import { createToolRunner, type EdgeHandler, type ToolCallContext, type ToolOutcome } from "../../supabase/functions/chat/tools.ts";

const TOKEN = "a".repeat(64);
const clock = { now: Date.UTC(2026, 9, 13, 9, 0) };

afterEach(() => vi.restoreAllMocks());

class MemoryStore implements ChatStore {
  conversations = new Map<string, ConversationRow & { delete_after?: string }>();
  messages: { conversation_id: string; agency_id: string; role: "user" | "assistant" | "tool"; content: string }[] = [];
  usage: Record<string, unknown>[] = [];
  alerts = new Set<string>();
  spend: UsageTotals[] = [];
  broken = false;
  alertBroken = false;
  monthUsageReads = 0;
  private n = 0;
  private check() {
    if (this.broken) throw new Error("select_http_503");
  }
  async createConversation(row: NewConversation) {
    this.check();
    const id = `00000000-0000-4000-8000-${String(++this.n).padStart(12, "0")}`;
    const full = { id, status: "open" as const, lead_id: null, escalated_at: null, turns: 0, last_message_at: new Date(clock.now).toISOString(), ...row };
    this.conversations.set(id, full);
    return { ...full };
  }
  async getConversation(id: string) {
    this.check();
    const c = this.conversations.get(id);
    return c ? { ...c } : null;
  }
  async listMessages(id: string) {
    this.check();
    return this.messages.filter((m) => m.conversation_id === id).map(({ role, content }) => ({ role, content }));
  }
  async addMessage(m: (typeof this.messages)[number]) {
    this.check();
    this.messages.push(m);
  }
  async updateConversation(id: string, fields: Partial<ConversationRow>, options?: UpdateOptions) {
    this.check();
    const c = this.conversations.get(id)!;
    // PostgREST's `lead_id=is.null` filter: no row matches once lead_id is set, and the PATCH changes nothing.
    if (options?.onlyIfLeadIdNull && c.lead_id !== null) return;
    Object.assign(c, fields);
  }
  async recordEscalation(id: string) {
    this.check();
    this.conversations.get(id)!.escalated_at = new Date(clock.now).toISOString();
  }
  async recordUsage(row: { conversation_id: string; agency_id: string; model: string; input_tokens: number; cached_tokens: number; output_tokens: number }) {
    this.usage.push(row);
  }
  async monthUsage() {
    this.monthUsageReads += 1;
    return this.spend;
  }
  async claimBudgetAlert(agency: string, month: string) {
    if (this.alertBroken) throw new Error("insert_http_500:XX000");
    const key = `${agency}:${month}`;
    if (this.alerts.has(key)) return false;
    this.alerts.add(key);
    return true;
  }
}

const usage = { input: 100, cached: 0, output: 10 };
const text = (t: string): ModelResponse => ({ content: [{ type: "text", text: t }], stopReason: "end_turn", usage, model: "claude-haiku-5-5" });
const toolUse = (name: string, input: Record<string, unknown>): ModelResponse => ({
  content: [{ type: "tool_use", id: "tu_1", name, input }],
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
      const s = steps.shift();
      if (!s) throw new Error("no scripted step");
      if (s instanceof Error) throw s;
      return s;
    },
  };
}

function setup(over: Partial<ChatDeps> = {}, steps: (ModelResponse | Error)[] = [text("שלום! מה שלומך?")]) {
  const store = new MemoryStore();
  const model = scripted(steps);
  const deps: ChatDeps = {
    now: () => clock.now,
    store,
    model,
    runTool: vi.fn(async (name: string): Promise<ToolOutcome> => ({ name, status: "ok", forModel: '{"ok":true}', isError: false })),
    allow: vi.fn(async () => true),
    monthlyBudgetUsd: 50,
    evalToken: "eval-secret",
    newToken: () => TOKEN,
    notifyBudgetReached: vi.fn(async () => undefined),
    ...over,
  };
  return { deps, store, model, chat: createChatHandler(deps) };
}

/** The real tool runner over fake Edge handlers, each answering a fixed body and counting its calls. */
function realRunner(answers: { submitLead?: Record<string, unknown>; escalateToHuman?: Record<string, unknown> }) {
  const calls = { submitLead: 0, escalateToHuman: 0 };
  const fake = (name: keyof typeof calls): EdgeHandler => async () => {
    calls[name] += 1;
    return Response.json(answers[name] ?? { ok: false, error: "unexpected" });
  };
  return { calls, runTool: createToolRunner({ submitLead: fake("submitLead"), escalateToHuman: fake("escalateToHuman") }) };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://edge.test/functions/v1/chat", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://govari-fin.co.il", "x-forwarded-for": "203.0.113.9", ...headers },
    body: JSON.stringify(body),
  });
const first = (message = "שלום") => ({
  agent: "needs_interview",
  message,
  consentVersion: "2026-10-agents-v6",
  consentAt: "2026-10-13T08:59:00.000Z",
  attribution: { channel: "direct", campaign: "", landingPath: "/" },
});
const next = (id: unknown, message = "x") => ({ agent: "needs_interview", conversationId: id, token: TOKEN, message });
const json = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

describe("the first message", () => {
  it("creates the conversation, stores both sides, and hands the page its token once", async () => {
    const { chat, store } = setup();
    const { status, body } = await json(await chat(post(first())));
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, reply: "שלום! מה שלומך?", token: TOKEN, leadSaved: false });
    expect(typeof body.rid).toBe("string");
    const [conv] = [...store.conversations.values()];
    expect(conv).toMatchObject({ role: "interview", consent_version: "2026-10-agents-v6", attribution: { channel: "direct", campaign: "", landingPath: "/" }, turns: 1, is_eval: false });
    expect(conv.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(conv.token_hash).not.toBe(TOKEN);
    expect(store.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(store.usage).toHaveLength(1);
  });

  it("refuses a first message without consent, writing nothing", async () => {
    const { chat, store } = setup();
    const { status, body } = await json(await chat(post({ agent: "needs_interview", message: "שלום" })));
    expect([status, body.code]).toEqual([400, "consent_required"]);
    expect(store.conversations.size).toBe(0);
  });

  it("refuses an agent the function does not serve, an empty message, and a long one", async () => {
    const { chat } = setup();
    expect((await json(await chat(post({ ...first(), agent: "support_agent" })))).body.code).toBe("unknown_agent");
    expect((await json(await chat(post(first("   "))))).body.code).toBe("empty");
    expect((await json(await chat(post(first("א".repeat(1001)))))).body.code).toBe("too_long");
  });

  it("accepts a consent version only as long as submit-lead's column (40), so every later save can succeed", async () => {
    expect(MAX_CONSENT_VERSION_CHARS).toBe(40);
    const { chat, store } = setup({}, [text("שלום")]);
    const long = await json(await chat(post({ ...first(), consentVersion: "v".repeat(41) })));
    expect([long.status, long.body.code]).toEqual([400, "consent_required"]);
    expect(store.conversations.size).toBe(0);
    expect((await json(await chat(post({ ...first(), consentVersion: "v".repeat(40) })))).status).toBe(200);
  });
});

describe("limits", () => {
  it("answers 429 when the visitor's address is over its limit", async () => {
    const { chat } = setup({ allow: vi.fn(async (_rid: string, key: string) => !key.startsWith("chat-ip:")) });
    const { status, body } = await json(await chat(post(first())));
    expect([status, body.code]).toEqual([429, "rate_limited"]);
  });

  it("answers 429 when the site is over its new-conversation limit", async () => {
    const { chat } = setup({ allow: vi.fn(async (_rid: string, key: string) => key !== "chat-new") });
    expect((await json(await chat(post(first())))).status).toBe(429);
  });

  it("lets an evaluation run past both limits", async () => {
    const { chat, store } = setup({ allow: vi.fn(async () => false) });
    const { status } = await json(await chat(post(first(), { "x-chat-eval": "eval-secret" })));
    expect(status).toBe(200);
    expect([...store.conversations.values()][0].is_eval).toBe(true);
  });
});

describe("later messages", () => {
  async function started() {
    const s = setup({}, [text("שלום"), text("ספרי לי עוד")]);
    const { body } = await json(await s.chat(post(first())));
    return { ...s, id: body.conversationId as string };
  }

  it("continue with the token, and the model sees the whole conversation", async () => {
    const { chat, model, id } = await started();
    const { status, body } = await json(await chat(post({ agent: "needs_interview", conversationId: id, token: TOKEN, message: "אני שכירה" })));
    expect(status).toBe(200);
    expect(body.token).toBeUndefined();
    expect(model.calls[1].messages).toEqual([
      { role: "user", content: "שלום" },
      { role: "assistant", content: "שלום" },
      { role: "user", content: "אני שכירה" },
    ]);
  });

  it("are refused without the right token", async () => {
    const { chat, id } = await started();
    const { status, body } = await json(await chat(post({ agent: "needs_interview", conversationId: id, token: "b".repeat(64), message: "x" })));
    expect([status, body.code]).toEqual([403, "gone"]);
  });

  it("are refused for a conversation that does not exist", async () => {
    const { chat } = await started();
    const { status, body } = await json(await chat(post(next("00000000-0000-4000-8000-00000000ffff"))));
    expect([status, body.code]).toEqual([403, "gone"]);
  });

  it("close a conversation idle more than two hours", async () => {
    const { chat, store, id } = await started();
    clock.now += 2 * 60 * 60 * 1000 + 1;
    const { status, body } = await json(await chat(post({ agent: "needs_interview", conversationId: id, token: TOKEN, message: "x" })));
    clock.now = Date.UTC(2026, 9, 13, 9, 0);
    expect([status, body.code]).toEqual([409, "closed"]);
    expect(store.conversations.get(id)!.status).toBe("closed");
  });

  it("stop at forty turns", async () => {
    const { chat, store, id } = await started();
    store.conversations.get(id)!.turns = 40;
    const { body } = await json(await chat(post({ agent: "needs_interview", conversationId: id, token: TOKEN, message: "x" })));
    expect(body.code).toBe("too_many_turns");
  });

  it("write under the stored conversation's agency, never one the request names", async () => {
    const { chat, store, id } = await started();
    store.conversations.get(id)!.agency_id = "agency-stored";
    const before = store.messages.length;
    await chat(post({ ...next(id, "אני שכירה"), agency_id: "agency-evil", agencyId: "agency-evil" }));
    const written = [...store.messages.slice(before), ...store.usage.slice(1)];
    expect(written.length).toBeGreaterThanOrEqual(3);
    for (const row of written) expect(row.agency_id).toBe("agency-stored");
  });
});

describe("the interview's close", () => {
  it("saves the lead through the tool, links it, and says so", async () => {
    // The fake runner acts as the real one does: it marks the conversation it was handed (Ruling 9).
    const runTool = vi.fn(async (_n: string, _i: Record<string, unknown>, ctx: ToolCallContext): Promise<ToolOutcome> => {
      ctx.conversation.status = "lead_saved";
      return { name: "submitLead", status: "ok", forModel: '{"ok":true}', isError: false, leadId: "lead-9", leadSaved: true };
    });
    const { chat, store } = setup({ runTool }, [toolUse("submitLead", { stage: "complete", name: "רונית", phone: "0527654321" }), text("נשמר. דורית תחזור אלייך.")]);
    const { body } = await json(await chat(post(first())));
    expect(body).toMatchObject({ ok: true, leadSaved: true, status: "lead_saved", reply: "נשמר. דורית תחזור אלייך." });
    const [conv] = [...store.conversations.values()];
    expect(conv).toMatchObject({ status: "lead_saved", lead_id: "lead-9" });
    expect(store.messages.map((m) => `${m.role}:${m.content}`)).toContain("tool:submitLead: ok");
    expect(store.messages.some((m) => m.content.includes("0527654321") && m.role === "tool")).toBe(false);
  });

  it("closes the conversation to further messages once the lead is saved", async () => {
    const runTool = vi.fn(async (_n: string, _i: Record<string, unknown>, ctx: ToolCallContext): Promise<ToolOutcome> => {
      ctx.conversation.status = "lead_saved";
      return { name: "submitLead", status: "ok", forModel: "{}", isError: false, leadSaved: true };
    });
    const { chat } = setup({ runTool }, [toolUse("submitLead", {}), text("נשמר.")]);
    const { body } = await json(await chat(post(first())));
    const again = await json(await chat(post({ agent: "needs_interview", conversationId: body.conversationId, token: TOKEN, message: "עוד שאלה" })));
    expect([again.status, again.body.code]).toEqual([409, "closed"]);
  });

  it("marks a hand-off, as its status and as escalated_at", async () => {
    const runTool = vi.fn(async (_n: string, _i: Record<string, unknown>, ctx: ToolCallContext): Promise<ToolOutcome> => {
      ctx.conversation.escalated = true;
      ctx.conversation.status = "escalated";
      return { name: "escalateToHuman", status: "ok", forModel: "{}", isError: false, escalated: true };
    });
    const { chat, store } = setup({ runTool }, [toolUse("escalateToHuman", { reason: "product_recommendation", summary: "x" }), text("העברתי לדורית.")]);
    await chat(post(first("איזו קרן הכי טובה?")));
    const [conv] = [...store.conversations.values()];
    expect(conv.status).toBe("escalated");
    expect(conv.escalated_at).toBe(new Date(clock.now).toISOString());
  });

  it("writes one lead when the model calls submitLead complete twice in one turn", async () => {
    const { calls, runTool } = realRunner({ submitLead: { ok: true, leadId: "lead-1" } });
    const { chat, store } = setup({ runTool }, [
      toolUse("submitLead", { stage: "complete", name: "רונית", phone: "0527654321" }),
      toolUse("submitLead", { stage: "complete", name: "רונית", phone: "0527654321" }),
      text("נשמר."),
    ]);
    const { body } = await json(await chat(post(first())));
    expect(calls.submitLead).toBe(1);
    expect(body).toMatchObject({ ok: true, leadSaved: true, status: "lead_saved" });
    expect(store.messages.filter((m) => m.role === "tool").map((m) => m.content)).toEqual(["submitLead: ok", "submitLead: already_saved"]);
    expect([...store.conversations.values()][0]).toMatchObject({ status: "lead_saved", lead_id: "lead-1" });
  });

  it("hands off once per conversation, across turns, from the stored escalated_at", async () => {
    const { calls, runTool } = realRunner({ escalateToHuman: { ok: true, leadId: null, contact: {}, acknowledgement: "" } });
    const { chat, store } = setup({ runTool }, [
      toolUse("escalateToHuman", { reason: "complaint", summary: "x" }),
      text("העברתי לדורית."),
      toolUse("escalateToHuman", { reason: "complaint", summary: "x" }),
      text("כבר העברתי."),
    ]);
    const { body } = await json(await chat(post(first())));
    expect(body.status).toBe("escalated");
    await chat(post(next(body.conversationId, "שוב")));
    expect(calls.escalateToHuman).toBe(1);
    expect(store.messages.filter((m) => m.role === "tool").map((m) => m.content)).toEqual(["escalateToHuman: ok", "escalateToHuman: already_escalated"]);
    expect([...store.conversations.values()][0].lead_id).toBeNull();
  });
});

describe("the conversation's lead (Ruling 11)", () => {
  const answers = {
    submitLead: { ok: true, leadId: "lead-interview" },
    escalateToHuman: { ok: true, leadId: "lead-handoff", contact: {}, acknowledgement: "" },
  };
  const lead = toolUse("submitLead", { stage: "complete", name: "רונית", phone: "0527654321" });
  const handoff = toolUse("escalateToHuman", { reason: "user_request", summary: "x", name: "רונית", phone: "0527654321" });

  it("keeps the interview lead when the hand-off comes after it", async () => {
    const { runTool } = realRunner(answers);
    const { chat, store } = setup({ runTool }, [lead, handoff, text("נשמר והועבר.")]);
    await chat(post(first()));
    const [conv] = [...store.conversations.values()];
    expect(conv).toMatchObject({ lead_id: "lead-interview", status: "lead_saved" });
    expect(conv.escalated_at).not.toBeNull();
  });

  it("takes the interview lead over the hand-off's when the lead comes after it", async () => {
    const { runTool } = realRunner(answers);
    const { chat, store } = setup({ runTool }, [handoff, lead, text("הועבר ונשמר.")]);
    await chat(post(first()));
    const [conv] = [...store.conversations.values()];
    expect(conv).toMatchObject({ lead_id: "lead-interview", status: "lead_saved" });
    expect(conv.escalated_at).not.toBeNull();
  });

  it("links the hand-off's lead first, and the interview lead when it arrives on a later turn", async () => {
    const { runTool } = realRunner(answers);
    const { chat, store } = setup({ runTool }, [handoff, text("הועבר."), lead, text("נשמר.")]);
    const { body } = await json(await chat(post(first())));
    expect([...store.conversations.values()][0]).toMatchObject({ lead_id: "lead-handoff", status: "escalated" });
    await chat(post(next(body.conversationId, "בכל זאת אשמח לפגישה")));
    expect([...store.conversations.values()][0]).toMatchObject({ lead_id: "lead-interview", status: "lead_saved" });
  });
});

describe("privacy", () => {
  it("stores and sends the model a redacted message, never the ID number", async () => {
    const { chat, store, model } = setup();
    await chat(post(first("תעודת הזהות שלי 123456782")));
    expect(store.messages[0].content).toContain("[הושמט — מספר מזהה]");
    expect(store.messages[0].content).not.toContain("123456782");
    expect(JSON.stringify(model.calls[0].messages)).toContain("[הושמט — מספר מזהה]");
    expect(JSON.stringify(model.calls[0].messages)).not.toContain("123456782");
  });

  it.each(["050-1234567", "050 1234567", "0501234567", "+972-50-1234567", "+972501234567", "03-1234567", "031234567"])(
    "keeps the visitor's phone %s, in storage and for the model",
    async (phone) => {
      const { chat, store, model } = setup();
      await chat(post(first(`הטלפון שלי ${phone}`)));
      expect(store.messages[0].content).toBe(`הטלפון שלי ${phone}`);
      expect(model.calls[0].messages).toEqual([{ role: "user", content: `הטלפון שלי ${phone}` }]);
    },
  );

  it("keeps the phone and redacts the ID and the card in one message", async () => {
    const { chat, store, model } = setup();
    await chat(post(first("ת״ז 123456782, כרטיס 4580 1234 5678 9012, טלפון 050-1234567")));
    const expected = "ת״ז [הושמט — מספר מזהה], כרטיס [הושמט — מספר כרטיס], טלפון 050-1234567";
    expect(store.messages[0].content).toBe(expected);
    expect(JSON.stringify(model.calls[0].messages)).toContain(expected);
  });

  it("stores a 3,000-character reply whole, and the model reads it back whole", async () => {
    const reply = `${"תודה רבה על הפרטים. ".repeat(160)}נדבר בקרוב.`;
    expect(reply.length).toBeGreaterThan(3000);
    const { chat, store, model } = setup({}, [text(reply), text("בהחלט")]);
    const { body } = await json(await chat(post(first())));
    expect(store.messages.find((m) => m.role === "assistant")?.content).toBe(reply);
    await chat(post(next(body.conversationId, "עוד")));
    expect(model.calls[1].messages[1]).toEqual({ role: "assistant", content: reply });
  });

  it("answers only the wire contract's fields, never the stored row or its token hash", async () => {
    const { chat, store } = setup({}, [text("שלום"), text("ועוד")]);
    const firstAnswer = await json(await chat(post(first())));
    expect(Object.keys(firstAnswer.body).sort()).toEqual(["conversationId", "leadSaved", "ok", "reply", "rid", "status", "token"]);
    const hash = [...store.conversations.values()][0].token_hash;
    const later = await json(await chat(post(next(firstAnswer.body.conversationId))));
    expect(Object.keys(later.body).sort()).toEqual(["conversationId", "leadSaved", "ok", "reply", "rid", "status"]);
    for (const answer of [firstAnswer, later]) expect(JSON.stringify(answer.body)).not.toContain(hash);
  });

  it("logs what happened, never the token, its hash, the message or the tool's arguments", async () => {
    const lines: string[] = [];
    for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation((line: unknown) => void lines.push(String(line)));
    const { runTool } = realRunner({ submitLead: { ok: true, leadId: "lead-1" } });
    const { chat, store } = setup({ runTool }, [toolUse("submitLead", { stage: "complete", name: "רונית", phone: "0527654321" }), text("נשמר.")]);
    await chat(post(first("קוראים לי רונית")));
    const hash = [...store.conversations.values()][0].token_hash;
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) {
      for (const secret of [TOKEN, hash, "רונית", "0527654321"]) expect(line).not.toContain(secret);
    }
  });
});

describe("failures", () => {
  it("answers 503 when the model fails twice, keeping the visitor's message and the token", async () => {
    const { chat, store } = setup({}, [new ModelError("http", 529), new ModelError("http", 529)]);
    const { status, body } = await json(await chat(post(first())));
    expect([status, body.code]).toEqual([503, "unavailable"]);
    expect(body.token).toBe(TOKEN);
    expect(store.messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("retries an overloaded model once and answers", async () => {
    const { chat, model } = setup({}, [new ModelError("http", 529), text("שלום")]);
    const { status, body } = await json(await chat(post(first())));
    expect([status, body.reply]).toEqual([200, "שלום"]);
    expect(model.calls).toHaveLength(2);
  });

  it("answers 503 when no model is configured", async () => {
    const { chat } = setup({ model: null });
    expect((await json(await chat(post(first())))).body.code).toBe("unavailable");
  });

  it("answers 500 with an rid when storage is down, and no error text", async () => {
    const { chat, store } = setup();
    store.broken = true;
    const { status, body } = await json(await chat(post(first())));
    expect([status, body.code]).toEqual([500, "failed"]);
    expect(JSON.stringify(body)).not.toMatch(/select_http/);
  });
});

describe("the budget", () => {
  const spent: UsageTotals[] = [{ model: "claude-haiku-5-5", input_tokens: 600_000_000, cached_tokens: 0, output_tokens: 0 }];

  it("refuses a new conversation over budget and mails staff once a month", async () => {
    const { chat, store, deps } = setup();
    store.spend = spent;
    expect((await json(await chat(post(first())))).body.code).toBe("unavailable");
    await chat(post(first()));
    expect(deps.notifyBudgetReached).toHaveBeenCalledTimes(1);
    expect(store.conversations.size).toBe(0);
  });

  it("refuses a new conversation once spend reaches the budget exactly", async () => {
    const { chat, store } = setup({ monthlyBudgetUsd: 50 });
    // 100M Haiku output tokens at $0.50 per million: exactly $50.
    store.spend = [{ model: "claude-haiku-5-5", input_tokens: 0, cached_tokens: 0, output_tokens: 100_000_000 }];
    const { status, body } = await json(await chat(post(first())));
    expect([status, body.code]).toEqual([503, "unavailable"]);
    expect(store.conversations.size).toBe(0);
  });

  it("treats a zero budget as the kill switch", async () => {
    const { chat, store, deps } = setup({ monthlyBudgetUsd: 0 });
    expect((await json(await chat(post(first())))).body.code).toBe("unavailable");
    expect(store.conversations.size).toBe(0);
    // Refused before spend is read, so an unreadable spend (which fails open) cannot reopen it, and nobody is mailed.
    expect(store.monthUsageReads).toBe(0);
    expect(deps.notifyBudgetReached).not.toHaveBeenCalled();
  });

  it("logs a failed alert claim by its code, still refuses, and mails no one", async () => {
    const warnings: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((line: unknown) => void warnings.push(String(line)));
    const { chat, store, deps } = setup();
    store.spend = spent;
    store.alertBroken = true;
    expect((await json(await chat(post(first())))).body.code).toBe("unavailable");
    expect(deps.notifyBudgetReached).not.toHaveBeenCalled();
    const line = warnings.map((w) => JSON.parse(w) as Record<string, unknown>).find((w) => w.event === "budget.alert_failed");
    expect(line).toMatchObject({ err: "insert_http_500:XX000" });
    expect(typeof line?.rid).toBe("string");
  });

  it("lets an existing conversation continue over budget", async () => {
    const { chat, store } = setup({}, [text("שלום"), text("ועוד")]);
    const { body } = await json(await chat(post(first())));
    store.spend = spent;
    expect((await json(await chat(post(next(body.conversationId))))).status).toBe(200);
  });
});

describe("an evaluation run", () => {
  it("reports the tool calls only to the holder of the evaluation token", async () => {
    const steps = () => [toolUse("submitLead", { stage: "complete" }), text("נשמר.")];
    const a = setup({}, steps());
    expect((await json(await a.chat(post(first(), { "x-chat-eval": "eval-secret" })))).body.eval).toEqual({ toolCalls: [{ name: "submitLead", input: { stage: "complete" } }] });
    const b = setup({}, steps());
    expect((await json(await b.chat(post(first(), { "x-chat-eval": "wrong" })))).body.eval).toBeUndefined();
  });

  it("keeps an evaluation conversation for one day", async () => {
    const { chat, store } = setup();
    await chat(post(first(), { "x-chat-eval": "eval-secret" }));
    expect([...store.conversations.values()][0].delete_after).toBe(new Date(clock.now + 24 * 60 * 60 * 1000).toISOString());
  });
});

describe("HTTP", () => {
  it("answers a preflight and refuses anything but POST", async () => {
    const { chat } = setup();
    expect((await chat(new Request("https://edge.test/functions/v1/chat", { method: "OPTIONS", headers: { origin: "https://govari-fin.co.il" } }))).status).toBe(204);
    expect((await chat(new Request("https://edge.test/functions/v1/chat", { method: "GET" }))).status).toBe(405);
  });

  it("answers a body that is not JSON as an unknown agent", async () => {
    const { chat } = setup();
    const res = await chat(new Request("https://edge.test/functions/v1/chat", { method: "POST", body: "not json" }));
    expect([res.status, ((await res.json()) as Record<string, unknown>).code]).toEqual([400, "unknown_agent"]);
  });
});
