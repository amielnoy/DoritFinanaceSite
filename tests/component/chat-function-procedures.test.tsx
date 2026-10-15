/**
 * @vitest-environment jsdom
 *
 * The procedures chat on the chat function: its own v6 notice (never the
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
  CHAT_FUNCTION_AGENTS: ["needs_interview", "support_agent", "procedures_agent"],
  CHAT_AGENTS: new Set(["procedures_agent"]),
  parseChatAgents: () => new Set(["procedures_agent"]),
  servedByChatFunction: (agent: string) => agent === "procedures_agent",
}));

const invoke = vi.fn();
vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  const { SupabaseAgentService } = await import("@/services/supabase/SupabaseAgentService");
  const chat = new SupabaseAgentService({ functions: { invoke } }, () => "local-1");
  return { ...actual, services: { ...actual.services, agents: chat } };
});

const { default: AgentChat } = await import("@/components/dorit/chat/AgentChat");
const { AGENTS } = await import("@/config/agents");
const { CHAT_FUNCTION_CONSENT_VERSION, CHAT_FUNCTION_PROCEDURES_CONSENT_POINTS, CONSENT, PROCEDURES_CONSENT_POINTS } = await import("@/config/compliance");

describe("the procedures chat on the chat function", () => {
  beforeEach(() => invoke.mockReset());

  it("shows the procedures chat's own v6 notice, not the interview's", () => {
    render(<MemoryRouter><AgentChat descriptor={AGENTS.procedures} /></MemoryRouter>);
    for (const point of CHAT_FUNCTION_PROCEDURES_CONSENT_POINTS) expect(screen.getByText(point)).toBeTruthy();
    expect(screen.queryByText(CONSENT.points[2])).toBeNull();
    expect(screen.queryByText(PROCEDURES_CONSENT_POINTS[3])).toBeNull();
  });

  it("sends the first message as procedures_agent with the v6 stamp, and shows the reply", async () => {
    invoke.mockResolvedValue({ data: { ok: true, conversationId: "p1", token: "t".repeat(64), reply: "כך מושכים…", leadSaved: false }, error: null });
    const user = userEvent.setup();
    render(<MemoryRouter><AgentChat descriptor={AGENTS.procedures} /></MemoryRouter>);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /התחלת השיחה/ }));
    await user.type(screen.getByPlaceholderText("כתבו כאן…"), "איך מושכים כספים מקופת גמל?");
    await user.click(screen.getByRole("button", { name: "שליחה" }));
    expect(await screen.findByText("כך מושכים…")).toBeTruthy();
    expect(invoke.mock.calls[0][0]).toBe("chat");
    expect(invoke.mock.calls[0][1].body).toMatchObject({ agent: "procedures_agent", consentVersion: CHAT_FUNCTION_CONSENT_VERSION });
  });
});
