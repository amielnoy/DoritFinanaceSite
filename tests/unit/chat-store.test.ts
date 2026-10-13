import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGE_CONTENT_LIMIT, restStore, toFacts } from "../../supabase/functions/chat/store.ts";

const URL_ = "https://ref.supabase.test";
let calls: { url: string; method: string; body: unknown }[] = [];
let answer: (url: string, method: string) => Response;

beforeEach(() => {
  calls = [];
  vi.stubGlobal("Deno", { env: { get: (k: string) => ({ SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: "service" } as Record<string, string>)[k] } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = String(init.method ?? "GET");
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return answer(url, method);
  }));
});
afterEach(() => vi.unstubAllGlobals());

const ID = "00000000-0000-4000-8000-000000000001";

describe("restStore", () => {
  it("reads a conversation by id", async () => {
    answer = () => new Response(JSON.stringify([{ id: ID, status: "open", turns: 2 }]), { status: 200 });
    expect(await restStore.getConversation(ID)).toMatchObject({ id: ID, turns: 2 });
    expect(calls[0].url).toBe(`${URL_}/rest/v1/chat_conversations?id=eq.${ID}&select=*&limit=1`);
  });

  it("never queries with an id that is not a uuid", async () => {
    answer = () => new Response("[]", { status: 200 });
    expect(await restStore.getConversation("x&select=token_hash")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("lists a conversation's messages in the order they were written", async () => {
    answer = () => new Response(JSON.stringify([{ role: "user", content: "א" }]), { status: 200 });
    expect(await restStore.listMessages(ID)).toEqual([{ role: "user", content: "א" }]);
    expect(calls[0].url).toBe(`${URL_}/rest/v1/chat_messages?conversation_id=eq.${ID}&select=role,content&order=id.asc&limit=200`);
  });

  it("reads this month's totals through the RPC, as numbers", async () => {
    answer = () => new Response(JSON.stringify([{ model: "claude-haiku-5-5", input_tokens: "10", cached_tokens: 0, output_tokens: "2" }]), { status: 200 });
    expect(await restStore.monthUsage("agency", "2026-10-01T00:00:00.000Z")).toEqual([{ model: "claude-haiku-5-5", input_tokens: 10, cached_tokens: 0, output_tokens: 2 }]);
    expect(calls[0]).toMatchObject({ url: `${URL_}/rest/v1/rpc/chat_month_usage`, body: { p_agency_id: "agency", p_since: "2026-10-01T00:00:00.000Z" } });
  });

  it("claims the month's budget alert once: true on the insert, false on the conflict", async () => {
    answer = () => new Response(JSON.stringify([{ month: "2026-10" }]), { status: 201 });
    expect(await restStore.claimBudgetAlert("agency", "2026-10")).toBe(true);
    answer = () => new Response(JSON.stringify({ code: "23505" }), { status: 409 });
    expect(await restStore.claimBudgetAlert("agency", "2026-10")).toBe(false);
  });

  it("lets a budget-alert refusal other than the conflict through, by its code", async () => {
    answer = () => new Response(JSON.stringify({ code: "XX000", message: "Failing row contains (secret)" }), { status: 500 });
    await expect(restStore.claimBudgetAlert("agency", "2026-10")).rejects.toThrow(/^insert_http_500:XX000$/);
  });

  it("creates a conversation and hands back the stored row", async () => {
    answer = () => new Response(JSON.stringify([{ id: ID, status: "open", turns: 0 }]), { status: 201 });
    const row = await restStore.createConversation({
      agency_id: "a", role: "interview", token_hash: "f".repeat(64), consent_version: "v6", consent_at: "2026-10-13T09:00:00.000Z",
      attribution: { channel: "direct", campaign: "", landingPath: "/" }, is_eval: false,
    });
    expect(row.id).toBe(ID);
    expect(calls[0]).toMatchObject({ url: `${URL_}/rest/v1/chat_conversations`, method: "POST" });
  });

  it("loads escalated_at into the conversation's facts as escalated", () => {
    const base = {
      id: ID, agency_id: "a", role: "interview", token_hash: "f", consent_version: "v6", consent_at: "2026-10-13T09:00:00.000Z",
      status: "open" as const, lead_id: null, turns: 1, attribution: { channel: "direct", campaign: "", landingPath: "/" },
      is_eval: false, last_message_at: "2026-10-13T09:00:00.000Z",
    };
    expect(toFacts({ ...base, escalated_at: null })).toEqual({
      id: ID, status: "open", escalated: false, consentVersion: "v6", consentAt: "2026-10-13T09:00:00.000Z", attribution: base.attribution,
    });
    expect(toFacts({ ...base, escalated_at: "2026-10-13T10:00:00.000Z" }).escalated).toBe(true);
  });

  it("persists a hand-off as escalated_at, set to the current time", async () => {
    answer = () => new Response(null, { status: 204 });
    const before = Date.now();
    await restStore.recordEscalation(ID);
    expect(calls[0]).toMatchObject({ url: `${URL_}/rest/v1/chat_conversations?id=eq.${ID}`, method: "PATCH" });
    const at = (calls[0].body as { escalated_at: string }).escalated_at;
    expect(Date.parse(at)).toBeGreaterThanOrEqual(before);
    expect(Object.keys(calls[0].body as object)).toEqual(["escalated_at"]);
  });

  it("truncates a message to the 8,000 characters the column allows", async () => {
    answer = () => new Response(JSON.stringify([{ id: 1 }]), { status: 201 });
    await restStore.addMessage({ conversation_id: ID, agency_id: "a", role: "assistant", content: "א".repeat(MESSAGE_CONTENT_LIMIT + 500) });
    expect(MESSAGE_CONTENT_LIMIT).toBe(8000);
    expect((calls[0].body as { content: string }).content).toHaveLength(8000);
    await restStore.addMessage({ conversation_id: ID, agency_id: "a", role: "assistant", content: "קצר" });
    expect((calls[1].body as { content: string }).content).toBe("קצר");
  });

  it("does not cut an emoji in half at the limit", async () => {
    answer = () => new Response(JSON.stringify([{ id: 1 }]), { status: 201 });
    await restStore.addMessage({ conversation_id: ID, agency_id: "a", role: "assistant", content: "a".repeat(7999) + "😀" });
    expect((calls[0].body as { content: string }).content).toBe("a".repeat(7999));
  });

  it("claims a turn with one filtered PATCH: this turn count, open or escalated, no live lease", async () => {
    answer = () => new Response(JSON.stringify([{ id: ID, status: "open", turns: 3, busy_until: "2026-10-13T09:01:00.000Z" }]), { status: 200 });
    const row = await restStore.claimTurn(ID, 2, "2026-10-13T09:00:00.000Z", "2026-10-13T09:01:00.000Z");
    expect(row).toMatchObject({ id: ID, turns: 3 });
    const url = new URL(calls[0].url);
    expect(calls[0].method).toBe("PATCH");
    expect(url.pathname).toBe("/rest/v1/chat_conversations");
    expect(url.searchParams.get("id")).toBe(`eq.${ID}`);
    expect(url.searchParams.get("turns")).toBe("eq.2");
    expect(url.searchParams.get("status")).toBe("in.(open,escalated)");
    expect(url.searchParams.get("or")).toBe('(busy_until.is.null,busy_until.lt."2026-10-13T09:00:00.000Z")');
    expect(calls[0].body).toEqual({ turns: 3, busy_until: "2026-10-13T09:01:00.000Z" });
  });

  it("answers null when no row matched the claim (another turn holds it, or the count moved)", async () => {
    answer = () => new Response("[]", { status: 200 });
    expect(await restStore.claimTurn(ID, 2, "2026-10-13T09:00:00.000Z", "2026-10-13T09:01:00.000Z")).toBeNull();
    expect(await restStore.claimTurn("not-a-uuid", 2, "2026-10-13T09:00:00.000Z", "2026-10-13T09:01:00.000Z")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("lets go of its own lease only, stamping the last message time", async () => {
    answer = () => new Response(null, { status: 204 });
    await restStore.releaseTurn(ID, "2026-10-13T09:01:00.000Z", "2026-10-13T09:00:20.000Z");
    const url = new URL(calls[0].url);
    expect(calls[0].method).toBe("PATCH");
    expect(url.searchParams.get("id")).toBe(`eq.${ID}`);
    expect(url.searchParams.get("busy_until")).toBe("eq.2026-10-13T09:01:00.000Z");
    expect(calls[0].body).toEqual({ busy_until: null, last_message_at: "2026-10-13T09:00:20.000Z" });
  });

  it("sets lead_id only while it is null when asked to", async () => {
    answer = () => new Response(null, { status: 204 });
    await restStore.updateConversation(ID, { lead_id: "lead-1" }, { onlyIfLeadIdNull: true });
    expect(calls[0]).toMatchObject({ url: `${URL_}/rest/v1/chat_conversations?id=eq.${ID}&lead_id=is.null`, method: "PATCH", body: { lead_id: "lead-1" } });
    await restStore.updateConversation(ID, { lead_id: "lead-2" });
    expect(calls[1].url).toBe(`${URL_}/rest/v1/chat_conversations?id=eq.${ID}`);
  });
});
