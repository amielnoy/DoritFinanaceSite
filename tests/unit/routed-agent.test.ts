import { describe, expect, it, vi } from "vitest";
import { RoutedAgentService } from "@/services/RoutedAgentService";
import type { AgentPort } from "@/services/ports";

const port = (prefix: string): AgentPort & { sent: string[] } => {
  const sent: string[] = [];
  return {
    sent,
    start: vi.fn(async () => ({ id: `${prefix}-1` })),
    send: vi.fn(async (_c, t: string) => void sent.push(t)),
    subscribe: vi.fn(() => () => undefined),
  };
};

describe("RoutedAgentService", () => {
  it("sends a served agent to the chat function and everything else to Base44", async () => {
    const base44 = port("b");
    const chat = port("c");
    const routed = new RoutedAgentService(base44, chat, new Set(["needs_interview"]));
    const a = await routed.start("needs_interview");
    const b = await routed.start("support_agent");
    await routed.send(a, "1");
    await routed.send(b, "2");
    expect([chat.sent, base44.sent]).toEqual([["1"], ["2"]]);
    routed.subscribe(a.id, () => undefined);
    expect(chat.subscribe).toHaveBeenCalledWith("c-1", expect.any(Function));
  });

  it("uses Base44 for everything when there is no chat adapter", async () => {
    const base44 = port("b");
    const routed = new RoutedAgentService(base44, null, new Set(["needs_interview"]));
    await routed.start("needs_interview");
    expect(base44.start).toHaveBeenCalled();
  });
});
