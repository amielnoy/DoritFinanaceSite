/**
 * @vitest-environment jsdom
 *
 * The blog recommender on the chat function: its own v6 notice (never the
 * interview's), the v6 stamp on the first message, and the reply through the
 * adapter.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => undefined, writable: true });
}
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));
vi.mock("framer-motion", async () => {
  const R = await import("react");
  const passthrough = new Proxy({}, { get: (_t, tag: string) => ({ children, ...props }: any) => R.createElement(tag, props, children) });
  return { motion: passthrough, AnimatePresence: ({ children }: any) => R.createElement(R.Fragment, null, children), useReducedMotion: () => true };
});
vi.mock("@/config/chat-agents", () => ({
  CHAT_FUNCTION_AGENTS: ["needs_interview", "support_agent", "procedures_agent", "blog_recommender"],
  CHAT_AGENTS: new Set(["blog_recommender"]),
  parseChatAgents: () => new Set(["blog_recommender"]),
  servedByChatFunction: (agent: string) => agent === "blog_recommender",
}));

const invoke = vi.fn();
vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  const { SupabaseAgentService } = await import("@/services/supabase/SupabaseAgentService");
  const chat = new SupabaseAgentService({ functions: { invoke } }, () => "local-1");
  return { ...actual, services: { ...actual.services, agents: chat } };
});

const { default: AgentChat } = await import("@/components/dorit/chat/AgentChat");
const START = /התחלת השיחה/;
const PLACEHOLDER = "כתבו כאן…";
const { AGENTS } = await import("@/config/agents");
const { CHAT_FUNCTION_BLOG_CONSENT_POINTS, CHAT_FUNCTION_CONSENT_VERSION, CONSENT } = await import("@/config/compliance");

describe("the blog recommender on the chat function", () => {
  beforeEach(() => invoke.mockReset());

  it("shows the blog recommender's own v6 notice, not the interview's", () => {
    render(<MemoryRouter><AgentChat descriptor={AGENTS.blogRecommender} /></MemoryRouter>);
    for (const point of CHAT_FUNCTION_BLOG_CONSENT_POINTS) expect(screen.getByText(point)).toBeTruthy();
    expect(screen.queryByText(CONSENT.points[2])).toBeNull();
  });

  it("sends the first message as blog_recommender with the v6 stamp, and hides the block it is handed", async () => {
    invoke.mockResolvedValue({ data: { ok: true, conversationId: "b1", token: "t".repeat(64), reply: "הנה מאמר על דמי ניהול", recommended: ["dmei-nihul"], leadSaved: false }, error: null });
    const onAssistantMessage = vi.fn();
    const user = userEvent.setup();
    render(<MemoryRouter><AgentChat descriptor={AGENTS.blogRecommender} onAssistantMessage={onAssistantMessage} /></MemoryRouter>);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: START }));
    await user.type(screen.getByPlaceholderText(PLACEHOLDER), "על דמי ניהול");
    await user.click(screen.getByRole("button", { name: "שליחה" }));
    expect(await screen.findByText("הנה מאמר על דמי ניהול")).toBeTruthy();
    expect(screen.queryByText(/```recommended|dmei-nihul/)).toBeNull();
    expect(invoke.mock.calls[0][1].body).toMatchObject({ agent: "blog_recommender", consentVersion: CHAT_FUNCTION_CONSENT_VERSION });
    expect(onAssistantMessage.mock.calls.at(-1)?.[0]).toContain('```recommended\n["dmei-nihul"]');
  });
});
