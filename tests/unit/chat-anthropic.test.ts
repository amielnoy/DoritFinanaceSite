import { describe, expect, it, vi } from "vitest";
import { createAnthropicClient, ModelError } from "../../supabase/functions/chat/anthropic.ts";

const REQUEST = {
  system: [{ type: "text" as const, text: "rules", cache_control: { type: "ephemeral" as const } }],
  messages: [{ role: "user" as const, content: "שלום" }],
  tools: [{ name: "submitLead", description: "d", input_schema: { type: "object" } }],
  maxTokens: 1024,
};
const signal = new AbortController().signal;

describe("createAnthropicClient", () => {
  it("posts the Messages API request with the key, the version and the cache marks", async () => {
    const fetchImpl = vi.fn(async (_u: string, _i?: RequestInit) =>
      new Response(JSON.stringify({ model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "היי" }], usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 3 } }), { status: 200 }),
    );
    const client = createAnthropicClient({ apiKey: "sk-test", model: "claude-haiku-5-5", fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await client.complete(REQUEST, signal);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init?.headers).toMatchObject({ "x-api-key": "sk-test", "anthropic-version": "2023-06-01", "content-type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({ model: "claude-haiku-5-5", max_tokens: 1024, system: REQUEST.system, messages: REQUEST.messages, tools: REQUEST.tools });
    expect(out).toEqual({ content: [{ type: "text", text: "היי" }], stopReason: "end_turn", model: "claude-haiku-5-5", usage: { input: 15, cached: 100, output: 3 } });
  });

  it("turns an HTTP refusal into ModelError('http') with its status", async () => {
    const client = createAnthropicClient({ apiKey: "k", model: "m", fetchImpl: (async () => new Response("{}", { status: 529 })) as unknown as typeof fetch });
    await expect(client.complete(REQUEST, signal)).rejects.toMatchObject({ kind: "http", status: 529 });
  });

  it("turns an abort into ModelError('timeout')", async () => {
    const client = createAnthropicClient({ apiKey: "k", model: "m", fetchImpl: (async () => { throw new DOMException("aborted", "TimeoutError"); }) as unknown as typeof fetch });
    await expect(client.complete(REQUEST, signal)).rejects.toMatchObject({ kind: "timeout" });
  });

  it("turns an answer without content into ModelError('shape')", async () => {
    const client = createAnthropicClient({ apiKey: "k", model: "m", fetchImpl: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch });
    await expect(client.complete(REQUEST, signal)).rejects.toBeInstanceOf(ModelError);
  });
});
