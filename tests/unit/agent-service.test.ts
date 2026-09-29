import { describe, expect, it, vi } from "vitest";
import {
  AgentLimitError,
  Base44AgentService,
  MAX_MESSAGE_CHARS,
  MAX_TURNS_PER_CONVERSATION,
  visibleMessages,
  type AgentClient,
} from "@/services/base44/Base44AgentService";

/**
 * The adapter between the Base44 agent runtime and the chat.
 *
 * Until now nothing tested it, and nothing anywhere in the battery exercised a
 * failing `/agents/` call — which is how a total backend outage came to be
 * indistinguishable from a bad moment on the train. These cases are the failure
 * paths, because those are the ones that were wrong.
 */

const conversation = { id: "conv_1" };

/** A client whose `addMessage` can be told to fail, and that records calls. */
const fakeClient = (overrides: Partial<AgentClient["agents"]> = {}) => {
  const agents = {
    createConversation: vi.fn(async () => ({ id: conversation.id })),
    getConversation: vi.fn(async (id: string) => ({ id })),
    addMessage: vi.fn(async () => ({})),
    subscribeToConversation: vi.fn(() => () => {}),
    ...overrides,
  };
  return { client: { agents } as unknown as AgentClient, agents };
};

describe("the turn cap counts model invocations, not attempts", () => {
  it("does not spend a turn on a send that failed", async () => {
    // The bug this replaces: the counter was incremented before the awaits, so
    // during an outage a visitor who kept retrying was eventually told
    // "השיחה הגיעה לאורכה המרבי" — a second, differently wrong diagnosis, and
    // the one message that would stop them trying again.
    const { client, agents } = fakeClient({
      addMessage: vi.fn(async () => {
        throw new Error("backend is down");
      }),
    });
    const service = new Base44AgentService(client);
    await service.start("needs_interview");

    for (let i = 0; i < MAX_TURNS_PER_CONVERSATION + 5; i++) {
      await expect(service.send(conversation, "שלום")).rejects.toThrow("backend is down");
    }

    // Every attempt reached the backend; none was ever refused locally.
    expect(agents.addMessage).toHaveBeenCalledTimes(MAX_TURNS_PER_CONVERSATION + 5);
  });

  it("still refuses once the visitor has actually taken the maximum turns", async () => {
    const { client } = fakeClient();
    const service = new Base44AgentService(client);
    await service.start("needs_interview");

    for (let i = 0; i < MAX_TURNS_PER_CONVERSATION; i++) {
      await service.send(conversation, "שלום");
    }

    await expect(service.send(conversation, "שלום")).rejects.toThrow(AgentLimitError);
    await expect(service.send(conversation, "שלום")).rejects.toMatchObject({
      reason: "too_many_turns",
    });
  });

  it("refuses an over-long message without calling the backend at all", async () => {
    const { client, agents } = fakeClient();
    const service = new Base44AgentService(client);

    await expect(service.send(conversation, "א".repeat(MAX_MESSAGE_CHARS + 1))).rejects.toMatchObject(
      { reason: "too_long" }
    );
    expect(agents.addMessage).not.toHaveBeenCalled();
  });
});

describe("a conversation id that no longer resolves", () => {
  it("fails with its own error instead of handing undefined to the SDK", async () => {
    // A redeploy, an expiry, a tab left open over a weekend. The SDK types
    // `getConversation` as possibly `undefined`; the old hand-written client
    // interface erased that and passed it straight into `addMessage`.
    const { client, agents } = fakeClient({ getConversation: vi.fn(async () => undefined) });
    const service = new Base44AgentService(client);

    await expect(service.send(conversation, "שלום")).rejects.toThrow("agent_conversation_gone");
    expect(agents.addMessage).not.toHaveBeenCalled();
  });
});

describe("what reaches the transcript", () => {
  it("keeps ordinary user and assistant turns unchanged", () => {
    expect(
      visibleMessages([
        { role: "user", content: "שלום" },
        { role: "assistant", content: "שלום, נעים להכיר." },
      ])
    ).toEqual([
      { role: "user", content: "שלום" },
      { role: "assistant", content: "שלום, נעים להכיר." },
    ]);
  });

  it("drops a message the platform marked hidden", () => {
    // The tool payloads on this chat carry a visitor's name, phone and life
    // circumstances. `hidden` is the runtime saying "not for them"; honouring
    // it is the one default worth getting right without being asked.
    expect(visibleMessages([{ role: "assistant", content: "submitLead(...)", hidden: true }])).toEqual(
      []
    );
  });

  it("drops a system message rather than dressing it as the agent", () => {
    // `role === "user"` is false for `system`, so the component rendered it in
    // an assistant bubble — scaffolding shown as though the agent had said it.
    expect(visibleMessages([{ role: "system", content: "=== כללי ציות מחייבים ===" }])).toEqual([]);
  });

  it("drops content that is not a non-empty string", () => {
    // `<ReactMarkdown>` throws "Objects are not valid as a React child" on an
    // object, and there is no error boundary above this chat — so the whole SPA
    // goes white. The SDK types `content` as `string | Record<string, any>` and
    // optional, so all three arrive in practice.
    expect(
      visibleMessages([
        { role: "assistant", content: { tool: "submitLead" } },
        { role: "assistant" },
        { role: "assistant", content: "" },
      ])
    ).toEqual([]);
  });

  it("passes the survivors through in order", () => {
    expect(
      visibleMessages([
        { role: "user", content: "שאלה" },
        { role: "system", content: "פנימי" },
        { role: "assistant", content: "תשובה", hidden: true },
        { role: "assistant", content: "תשובה גלויה" },
      ])
    ).toEqual([
      { role: "user", content: "שאלה" },
      { role: "assistant", content: "תשובה גלויה" },
    ]);
  });
});
