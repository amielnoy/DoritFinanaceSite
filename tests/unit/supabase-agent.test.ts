import { afterEach, describe, expect, it, vi } from "vitest";
import { CHAT_REQUEST_TIMEOUT_MS, STATUS_POLL_MS, STATUS_RECOVERY_MS, STATUS_REQUEST_TIMEOUT_MS, SupabaseAgentService } from "@/services/supabase/SupabaseAgentService";
import { AgentLimitError, AgentUnavailableError, LEAD_SAVED_WITHOUT_REPLY } from "@/services/agent-errors";
import type { AgentMessage } from "@/services/ports";

type Invoke = (name: string, options: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: { message: string; context?: unknown } | null }>;
const client = (invoke: Invoke) => ({ functions: { invoke: vi.fn(invoke) } });
const ok = (data: unknown) => async () => ({ data, error: null });
const refused = (status: number, body: unknown) => async () => ({ data: null, error: { message: "non-2xx", context: new Response(JSON.stringify(body), { status }) } });
const META = { consent_version: "2026-10-agents-v6", consent_at: "2026-10-13T09:00:00.000Z", channel: "direct", campaign: "", landing_path: "/" };
const T = "t".repeat(64);
/** The conversation keys the adapter makes, numbered: conv-1, conv-2, … */
const numberedKeys = () => {
  let n = 0;
  return () => ({ id: `conv-${++n}`, token: T });
};

describe("SupabaseAgentService", () => {
  it("opens the conversation under its own id and token, with consent and attribution on the first message only", async () => {
    const c = client(ok({ ok: true, rid: "r", conversationId: "conv-1", turn: 1, reply: "שלום", leadSaved: false }));
    const svc = new SupabaseAgentService(c, () => "local-1", numberedKeys());
    const conv = await svc.start("needs_interview", META);
    await svc.send(conv, "היי");
    await svc.send(conv, "ועוד");
    expect(c.functions.invoke.mock.calls[0]).toEqual([
      "chat",
      {
        body: { agent: "needs_interview", conversationId: "conv-1", token: T, message: "היי", consentVersion: META.consent_version, consentAt: META.consent_at, attribution: { channel: "direct", campaign: "", landingPath: "/" } },
        signal: expect.any(AbortSignal),
      },
    ]);
    expect(c.functions.invoke.mock.calls[1][1].body).toEqual({ agent: "needs_interview", conversationId: "conv-1", token: T, message: "ועוד" });
  });

  it("makes a fresh uuid and a 64-hex token for each conversation by default", async () => {
    const c = client(ok({ ok: true, reply: "שלום" }));
    const svc = new SupabaseAgentService(c);
    await svc.send(await svc.start("needs_interview", META), "1");
    await svc.send(await svc.start("needs_interview", META), "2");
    const [a, b] = c.functions.invoke.mock.calls.map((call) => call[1].body);
    for (const body of [a, b]) {
      expect(body.conversationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(a.conversationId).not.toBe(b.conversationId);
    expect(a.token).not.toBe(b.token);
  });

  it("hands the subscriber the whole transcript, the visitor's line with the reply", async () => {
    const svc = new SupabaseAgentService(client(ok({ ok: true, conversationId: "s", token: "t".repeat(64), reply: "שלום", leadSaved: false })), () => "l");
    const conv = await svc.start("needs_interview", META);
    const seen: AgentMessage[][] = [];
    svc.subscribe(conv.id, (m) => seen.push(m));
    await svc.send(conv, "היי");
    expect(seen.at(-1)).toEqual([{ role: "user", content: "היי" }, { role: "assistant", content: "שלום" }]);
  });

  it("gives a late subscriber what already arrived", async () => {
    const svc = new SupabaseAgentService(client(ok({ ok: true, conversationId: "s", token: "t".repeat(64), reply: "שלום" })), () => "l");
    const conv = await svc.start("needs_interview", META);
    await svc.send(conv, "היי");
    const cb = vi.fn();
    svc.subscribe(conv.id, cb);
    expect(cb).toHaveBeenCalledWith([{ role: "user", content: "היי" }, { role: "assistant", content: "שלום" }]);
  });

  it("marks the reply that saved the lead", async () => {
    const svc = new SupabaseAgentService(client(ok({ ok: true, conversationId: "s", token: "t".repeat(64), reply: "נשמר", leadSaved: true })), () => "l");
    const conv = await svc.start("needs_interview", META);
    const cb = vi.fn();
    svc.subscribe(conv.id, cb);
    await svc.send(conv, "כן");
    expect(cb.mock.calls.at(-1)![0].at(-1)).toEqual({ role: "assistant", content: "נשמר", signal: "lead_saved" });
  });

  /**
   * The chat function answers the articles it highlighted as `recommended`; the
   * page has one protocol for both backends, the ```recommended block
   * (src/lib/blog-recommendation.ts), so the adapter writes the block.
   */
  it("hands the page the recommended articles as the block it reads, and the visitor none of it", async () => {
    const { readRecommendation } = await import("@/lib/blog-recommendation");
    const svc = new SupabaseAgentService(client(ok({ ok: true, conversationId: "s", token: "t".repeat(64), reply: "הנה…", recommended: ["dmei-nihul", "tikun-190"] })), () => "l");
    const conv = await svc.start("blog_recommender", META);
    const cb = vi.fn();
    svc.subscribe(conv.id, cb);
    await svc.send(conv, "על דמי ניהול");
    const last = cb.mock.calls.at(-1)![0].at(-1) as AgentMessage;
    expect(readRecommendation(last.content)).toEqual({ visible: "הנה…", ids: ["dmei-nihul", "tikun-190"], malformed: false });
  });

  it("leaves a reply without recommendations as it came, and never writes a second block", async () => {
    const { readRecommendation } = await import("@/lib/blog-recommendation");
    const plain = new SupabaseAgentService(client(ok({ ok: true, conversationId: "s", token: "t".repeat(64), reply: "על איזה נושא?" })), () => "l");
    const a = await plain.start("blog_recommender", META);
    const cbA = vi.fn();
    plain.subscribe(a.id, cbA);
    await plain.send(a, "שלום");
    expect(cbA.mock.calls.at(-1)![0].at(-1).content).toBe("על איזה נושא?");

    const already = "הנה…\n\n```recommended\n[\"pensia\"]\n```";
    const both = new SupabaseAgentService(client(ok({ ok: true, conversationId: "s", token: "t".repeat(64), reply: already, recommended: ["dmei-nihul"] })), () => "l");
    const b = await both.start("blog_recommender", META);
    const cbB = vi.fn();
    both.subscribe(b.id, cbB);
    await both.send(b, "שלום");
    const content = cbB.mock.calls.at(-1)![0].at(-1).content as string;
    expect(content.match(/```recommended/g)).toHaveLength(1);
    expect(readRecommendation(content).ids).toEqual(["pensia"]);
  });

  it("refuses a long message before any request", async () => {
    const c = client(ok({}));
    const svc = new SupabaseAgentService(c, () => "l");
    await expect(svc.send(await svc.start("needs_interview", META), "א".repeat(1001))).rejects.toMatchObject({ reason: "too_long" });
    expect(c.functions.invoke).not.toHaveBeenCalled();
  });

  it.each([
    [400, { code: "too_many_turns" }, "too_many_turns"],
    [429, { code: "rate_limited" }, "rate_limited"],
    [403, { code: "gone" }, "conversation_closed"],
    [409, { code: "closed" }, "conversation_closed"],
    [409, { code: "busy" }, "busy"],
  ])("maps a %i answer to AgentLimitError(%s)", async (status, body, reason) => {
    const svc = new SupabaseAgentService(client(refused(status, body)), () => "l");
    const err = await svc.send(await svc.start("needs_interview", META), "x").catch((e) => e);
    expect(err).toBeInstanceOf(AgentLimitError);
    expect(err.reason).toBe(reason);
  });

  it("starts a new server conversation after one was closed, under the same consent", async () => {
    let n = 0;
    const c = client(async () => (++n === 2 ? refused(409, { code: "closed" })() : ok({ ok: true, conversationId: `s${n}`, token: "t".repeat(64), reply: "r" })()));
    const svc = new SupabaseAgentService(c, () => "l", numberedKeys());
    const conv = await svc.start("needs_interview", META);
    await svc.send(conv, "1");
    await svc.send(conv, "2").catch(() => undefined);
    await svc.send(conv, "3");
    expect(c.functions.invoke.mock.calls[2][1].body).toMatchObject({ conversationId: "conv-2", consentVersion: META.consent_version, message: "3" });
  });

  it.each([[503, { code: "unavailable", rid: "r9" }], [500, { code: "failed", rid: "r9" }]])("maps %i to AgentUnavailableError", async (status, body) => {
    const svc = new SupabaseAgentService(client(refused(status, body)), () => "l");
    const err = await svc.send(await svc.start("needs_interview", META), "x").catch((e) => e);
    expect(err).toBeInstanceOf(AgentUnavailableError);
    expect(err.rid).toBe("r9");
  });

  it("keeps the conversation a 503 opened, so the next message continues it", async () => {
    let n = 0;
    const c = client(async () => (++n === 1 ? refused(503, { code: "unavailable", conversationId: "conv-1", turn: 1 })() : ok({ ok: true, conversationId: "conv-1", reply: "r" })()));
    const svc = new SupabaseAgentService(c, () => "l", numberedKeys());
    const conv = await svc.start("needs_interview", META);
    await svc.send(conv, "1").catch(() => undefined);
    await svc.send(conv, "2");
    expect(c.functions.invoke.mock.calls[1][1].body).toEqual({ agent: "needs_interview", conversationId: "conv-1", token: T, message: "2" });
  });

  it("shows the visitor's message the moment it is sent, before the answer", async () => {
    let release: (v: { data: unknown; error: null }) => void = () => undefined;
    const c = client(() => new Promise((r) => (release = r)));
    const svc = new SupabaseAgentService(c, () => "l");
    const conv = await svc.start("needs_interview", META);
    const seen: AgentMessage[][] = [];
    svc.subscribe(conv.id, (m) => seen.push(m));
    const sending = svc.send(conv, "היי");
    expect(seen.at(-1)).toEqual([{ role: "user", content: "היי" }]);
    release({ data: { ok: true, conversationId: "s", token: "t".repeat(64), reply: "שלום" }, error: null });
    await sending;
    expect(seen.at(-1)).toEqual([{ role: "user", content: "היי" }, { role: "assistant", content: "שלום" }]);
  });

  it("takes the visitor's message back out when the send fails", async () => {
    let n = 0;
    const c = client(async () => (++n === 1 ? ok({ ok: true, conversationId: "s", token: "t".repeat(64), reply: "שלום" })() : refused(503, { code: "unavailable" })()));
    const svc = new SupabaseAgentService(c, () => "l");
    const conv = await svc.start("needs_interview", META);
    const seen: AgentMessage[][] = [];
    svc.subscribe(conv.id, (m) => seen.push(m));
    await svc.send(conv, "היי");
    await expect(svc.send(conv, "שוב")).rejects.toBeInstanceOf(AgentUnavailableError);
    expect(seen.at(-2)).toEqual([{ role: "user", content: "היי" }, { role: "assistant", content: "שלום" }, { role: "user", content: "שוב" }]);
    expect(seen.at(-1)).toEqual([{ role: "user", content: "היי" }, { role: "assistant", content: "שלום" }]);
  });

  it("treats a 503 that says the lead was saved as a saved lead, not a failure", async () => {
    let n = 0;
    const c = client(async () =>
      ++n === 1
        ? refused(503, { ok: false, code: "unavailable", rid: "r1", leadSaved: true, conversationId: "conv-1", turn: 1 })()
        : refused(409, { code: "closed" })(),
    );
    const svc = new SupabaseAgentService(c, () => "l", numberedKeys());
    const conv = await svc.start("needs_interview", META);
    const cb = vi.fn();
    svc.subscribe(conv.id, cb);
    await expect(svc.send(conv, "כן, זה נכון")).resolves.toBeUndefined();
    expect(cb.mock.calls.at(-1)![0]).toEqual([
      { role: "user", content: "כן, זה נכון" },
      { role: "assistant", content: LEAD_SAVED_WITHOUT_REPLY, signal: "lead_saved", replyMissing: true },
    ]);
    // The next message continues that conversation (and is told it is closed).
    await svc.send(conv, "עוד").catch(() => undefined);
    expect(c.functions.invoke.mock.calls[1][1].body).toEqual({ agent: "needs_interview", conversationId: "conv-1", token: T, message: "עוד" });
  });

  describe("at the 40 second timeout", () => {
    afterEach(() => vi.useRealTimers());

    it("aborts the request and throws AgentUnavailableError", async () => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      const c = { functions: { invoke: vi.fn((_n: string, o: { body: Record<string, unknown>; signal?: AbortSignal }) => { signal = o.signal; return new Promise<never>(() => undefined); }) } };
      const svc = new SupabaseAgentService(c, () => "l");
      const conv = await svc.start("needs_interview", META);
      const result = svc.send(conv, "x").catch((e) => e);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(40_000);
      expect(signal?.aborted).toBe(true);
      // Every status request hangs too: each is cut off, and the window ends.
      await vi.advanceTimersByTimeAsync(STATUS_RECOVERY_MS + STATUS_REQUEST_TIMEOUT_MS + STATUS_POLL_MS);
      expect(await result).toBeInstanceOf(AgentUnavailableError);
    });

    it("sends a timed-out first message again under the same id and token, consent included", async () => {
      vi.useFakeTimers();
      let n = 0;
      const c = client(async (_name, { body }) => {
        if (++n === 1) return new Promise<never>(() => undefined);
        // The first send never opened the row.
        if (body.status === true) return refused(403, { ok: false, code: "gone" })();
        return ok({ ok: true, conversationId: "conv-1", turn: 1, reply: "שלום" })();
      });
      const svc = new SupabaseAgentService(c, () => "l", numberedKeys());
      const conv = await svc.start("needs_interview", META);
      const first = svc.send(conv, "שלום").catch((e) => e);
      await vi.advanceTimersByTimeAsync(CHAT_REQUEST_TIMEOUT_MS + STATUS_POLL_MS);
      expect(await first).toBeInstanceOf(AgentUnavailableError);
      await svc.send(conv, "שלום");
      const bodies = c.functions.invoke.mock.calls.map((call) => call[1].body);
      expect(bodies[0]).toMatchObject({ conversationId: "conv-1", token: T, consentVersion: META.consent_version });
      expect(bodies.at(-1)).toEqual(bodies[0]);
    });
  });
});

/**
 * The page stops waiting at CHAT_REQUEST_TIMEOUT_MS, and a turn whose tools run
 * long may still finish — saving the lead — after that (review 2026-10-15).
 * On a conversation that already exists, the adapter then asks the function how
 * the turn ended before it tells the visitor anything.
 */
describe("SupabaseAgentService — a reply that outlived the wait", () => {
  afterEach(() => vi.useRealTimers());

  type Status = { busy: boolean; leadSaved?: boolean; turns?: number; last?: { role: string; content: string } | null };
  /** The first message answers at once; the second never does; status requests answer from `statuses`, the last one repeating. */
  function hanging(statuses: Status[]) {
    const asked: Record<string, unknown>[] = [];
    let turns = 0;
    const invoke: Invoke = async (_name, { body }) => {
      if (body.status === true) {
        asked.push(body);
        const next = statuses.length > 1 ? statuses.shift()! : statuses[0];
        return { data: { ok: true, status: "open", leadSaved: false, turns: 2, last: null, ...next }, error: null };
      }
      turns += 1;
      if (turns === 1) return { data: { ok: true, conversationId: "srv-1", token: "t".repeat(64), turn: 1, reply: "שלום" }, error: null };
      return new Promise(() => undefined);
    };
    return { invoke, asked };
  }

  async function secondMessage(statuses: Status[]) {
    vi.useFakeTimers();
    const { invoke, asked } = hanging(statuses);
    const svc = new SupabaseAgentService(client(invoke), () => "l", () => ({ id: "srv-1", token: T }));
    const conv = await svc.start("needs_interview", META);
    const cb = vi.fn();
    svc.subscribe(conv.id, cb);
    await svc.send(conv, "היי");
    const sending = svc.send(conv, "0521234567").then(() => "ok", (e) => e);
    await vi.advanceTimersByTimeAsync(CHAT_REQUEST_TIMEOUT_MS + STATUS_RECOVERY_MS + STATUS_POLL_MS);
    return { outcome: await sending, cb, asked };
  }

  it("shows the reply the turn produced once it finished, instead of a failure", async () => {
    const { outcome, cb, asked } = await secondMessage([
      { busy: true },
      { busy: false, leadSaved: true, last: { role: "assistant", content: "תודה, הפרטים אצל דורית" } },
    ]);
    expect(outcome).toBe("ok");
    expect(cb.mock.calls.at(-1)![0].at(-1)).toEqual({ role: "assistant", content: "תודה, הפרטים אצל דורית", signal: "lead_saved" });
    expect(asked[0]).toEqual({ agent: "needs_interview", conversationId: "srv-1", token: "t".repeat(64), status: true, turn: 2 });
  });

  it("says the details were saved when the turn saved the lead but left no reply", async () => {
    const { outcome, cb } = await secondMessage([{ busy: false, leadSaved: true, last: { role: "user", content: "0521234567" } }]);
    expect(outcome).toBe("ok");
    expect(cb.mock.calls.at(-1)![0].at(-1)).toEqual({ role: "assistant", content: LEAD_SAVED_WITHOUT_REPLY, signal: "lead_saved", replyMissing: true });
  });

  it("fails as before when the turn ended with neither a reply nor a saved lead", async () => {
    const { outcome, cb } = await secondMessage([{ busy: false, last: { role: "user", content: "0521234567" } }]);
    expect(outcome).toBeInstanceOf(AgentUnavailableError);
    expect(cb.mock.calls.at(-1)![0].map((m: AgentMessage) => m.content)).not.toContain("0521234567");
  });

  it("fails, and never shows an earlier reply, when the turn it asked about never started", async () => {
    const { outcome, cb } = await secondMessage([{ busy: false, leadSaved: true, turns: 1, last: { role: "assistant", content: "שלום" } }]);
    expect(outcome).toBeInstanceOf(AgentUnavailableError);
    expect(cb.mock.calls.at(-1)![0]).toEqual([{ role: "user", content: "היי" }, { role: "assistant", content: "שלום" }]);
  });

  it("says the message is still being answered when the window ends with the turn still running, and keeps it on screen", async () => {
    const { outcome, asked, cb } = await secondMessage([{ busy: true }]);
    expect(outcome).toBeInstanceOf(AgentLimitError);
    expect(outcome.reason).toBe("still_processing");
    expect(asked.length).toBeLessThanOrEqual(Math.ceil(STATUS_RECOVERY_MS / STATUS_POLL_MS));
    expect(cb.mock.calls.at(-1)![0]).toEqual([{ role: "user", content: "היי" }, { role: "assistant", content: "שלום" }, { role: "user", content: "0521234567" }]);
  });

  it("fails, not 'still processing', when the window ends with no answer at all", async () => {
    vi.useFakeTimers();
    let n = 0;
    const invoke: Invoke = async (_name, { body }) => {
      if (body.status === true) return { data: null, error: { message: "network" } };
      return ++n === 1 ? { data: { ok: true, conversationId: "srv-1", turn: 1, reply: "שלום" }, error: null } : new Promise(() => undefined);
    };
    const svc = new SupabaseAgentService(client(invoke), () => "l");
    const conv = await svc.start("needs_interview", META);
    await svc.send(conv, "היי");
    const sending = svc.send(conv, "שוב").then(() => "ok", (e) => e);
    await vi.advanceTimersByTimeAsync(CHAT_REQUEST_TIMEOUT_MS + STATUS_RECOVERY_MS + STATUS_POLL_MS);
    expect(await sending).toBeInstanceOf(AgentUnavailableError);
  });

  it("recovers a first message too: it asks about turn 1 of the conversation it named", async () => {
    vi.useFakeTimers();
    const asked: Record<string, unknown>[] = [];
    const invoke: Invoke = async (_name, { body }) => {
      if (body.status !== true) return new Promise(() => undefined);
      asked.push(body);
      return { data: { ok: true, busy: false, status: "open", leadSaved: false, turns: 1, last: { role: "assistant", content: "שלום, במה אפשר לעזור?" } }, error: null };
    };
    const svc = new SupabaseAgentService(client(invoke), () => "l", () => ({ id: "srv-1", token: T }));
    const conv = await svc.start("needs_interview", META);
    const cb = vi.fn();
    svc.subscribe(conv.id, cb);
    const sending = svc.send(conv, "שלום").then(() => "ok", (e) => e);
    await vi.advanceTimersByTimeAsync(CHAT_REQUEST_TIMEOUT_MS + STATUS_POLL_MS);
    expect(await sending).toBe("ok");
    expect(asked[0]).toEqual({ agent: "needs_interview", conversationId: "srv-1", token: T, status: true, turn: 1 });
    expect(cb.mock.calls.at(-1)![0]).toEqual([{ role: "user", content: "שלום" }, { role: "assistant", content: "שלום, במה אפשר לעזור?" }]);
  });

  it("stops asking at once when the first message never opened the conversation", async () => {
    vi.useFakeTimers();
    const invoke = vi.fn<Invoke>(async (_name, { body }) => (body.status === true ? refused(403, { ok: false, code: "gone" })() : new Promise(() => undefined)));
    const svc = new SupabaseAgentService(client(invoke), () => "l");
    const conv = await svc.start("needs_interview", META);
    const sending = svc.send(conv, "שלום").then(() => "ok", (e) => e);
    await vi.advanceTimersByTimeAsync(CHAT_REQUEST_TIMEOUT_MS + STATUS_RECOVERY_MS);
    expect(await sending).toBeInstanceOf(AgentUnavailableError);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
