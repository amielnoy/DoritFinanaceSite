import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseAgentService } from "@/services/supabase/SupabaseAgentService";
import { AgentLimitError, AgentUnavailableError } from "@/services/agent-errors";
import type { AgentMessage } from "@/services/ports";

type Invoke = (name: string, options: { body: Record<string, unknown> }) => Promise<{ data: unknown; error: { message: string; context?: unknown } | null }>;
const client = (invoke: Invoke) => ({ functions: { invoke: vi.fn(invoke) } });
const ok = (data: unknown) => async () => ({ data, error: null });
const refused = (status: number, body: unknown) => async () => ({ data: null, error: { message: "non-2xx", context: new Response(JSON.stringify(body), { status }) } });
const META = { consent_version: "2026-10-agents-v6", consent_at: "2026-10-13T09:00:00.000Z", channel: "direct", campaign: "", landing_path: "/" };

describe("SupabaseAgentService", () => {
  it("opens the conversation with consent and attribution on the first message, and the token after", async () => {
    const c = client(ok({ ok: true, rid: "r", conversationId: "srv-1", token: "t".repeat(64), reply: "שלום", leadSaved: false }));
    const svc = new SupabaseAgentService(c, () => "local-1");
    const conv = await svc.start("needs_interview", META);
    await svc.send(conv, "היי");
    await svc.send(conv, "ועוד");
    expect(c.functions.invoke.mock.calls[0]).toEqual(["chat", { body: { agent: "needs_interview", message: "היי", consentVersion: META.consent_version, consentAt: META.consent_at, attribution: { channel: "direct", campaign: "", landingPath: "/" } }, signal: expect.any(AbortSignal) }]);
    expect(c.functions.invoke.mock.calls[1][1].body).toEqual({ agent: "needs_interview", conversationId: "srv-1", token: "t".repeat(64), message: "ועוד" });
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
    const svc = new SupabaseAgentService(c, () => "l");
    const conv = await svc.start("needs_interview", META);
    await svc.send(conv, "1");
    await svc.send(conv, "2").catch(() => undefined);
    await svc.send(conv, "3");
    expect(c.functions.invoke.mock.calls[2][1].body).toMatchObject({ consentVersion: META.consent_version, message: "3" });
    expect(c.functions.invoke.mock.calls[2][1].body).not.toHaveProperty("conversationId");
  });

  it.each([[503, { code: "unavailable", rid: "r9" }], [500, { code: "failed", rid: "r9" }]])("maps %i to AgentUnavailableError", async (status, body) => {
    const svc = new SupabaseAgentService(client(refused(status, body)), () => "l");
    const err = await svc.send(await svc.start("needs_interview", META), "x").catch((e) => e);
    expect(err).toBeInstanceOf(AgentUnavailableError);
    expect(err.rid).toBe("r9");
  });

  it("keeps the conversation a 503 opened, so the next message continues it", async () => {
    let n = 0;
    const c = client(async () => (++n === 1 ? refused(503, { code: "unavailable", conversationId: "s1", token: "t".repeat(64) })() : ok({ ok: true, conversationId: "s1", reply: "r" })()));
    const svc = new SupabaseAgentService(c, () => "l");
    const conv = await svc.start("needs_interview", META);
    await svc.send(conv, "1").catch(() => undefined);
    await svc.send(conv, "2");
    expect(c.functions.invoke.mock.calls[1][1].body).toMatchObject({ conversationId: "s1", token: "t".repeat(64) });
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
      expect(await result).toBeInstanceOf(AgentUnavailableError);
    });

    it("adopts the conversation a late first answer opened, so the retry continues it", async () => {
      vi.useFakeTimers();
      let release: (v: { data: unknown; error: null }) => void = () => undefined;
      let n = 0;
      const c = client(() => (++n === 1 ? new Promise((r) => { release = r; }) : ok({ ok: true, conversationId: "late-1", reply: "r" })()));
      const svc = new SupabaseAgentService(c, () => "l");
      const conv = await svc.start("needs_interview", META);
      const first = svc.send(conv, "1").catch((e) => e);
      await vi.advanceTimersByTimeAsync(40_000);
      expect(await first).toBeInstanceOf(AgentUnavailableError);
      release({ data: { ok: true, conversationId: "late-1", token: "t".repeat(64), reply: "late" }, error: null });
      await vi.advanceTimersByTimeAsync(0);
      await svc.send(conv, "2");
      expect(c.functions.invoke.mock.calls[1][1].body).toEqual({ agent: "needs_interview", conversationId: "late-1", token: "t".repeat(64), message: "2" });
    });
  });
});
