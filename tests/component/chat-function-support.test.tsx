/**
 * @vitest-environment jsdom
 *
 * The FAQ chat on the chat function: its own v6 notice (never the
 * interview's), the v6 stamp on the first message, the reply through the
 * adapter, and the hand-off button unchanged.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => undefined, writable: true });
}
vi.mock("framer-motion", async () => {
  const R = await import("react");
  const passthrough = new Proxy({}, { get: (_t, tag: string) => ({ children, ...props }: any) => R.createElement(tag, props, children) });
  return { motion: passthrough, AnimatePresence: ({ children }: any) => R.createElement(R.Fragment, null, children), useReducedMotion: () => true };
});

const invoke = vi.fn();
vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  const { SupabaseAgentService } = await import("@/services/supabase/SupabaseAgentService");
  const chat = new SupabaseAgentService({ functions: { invoke } }, () => "local-1");
  return { ...actual, services: { ...actual.services, agents: chat } };
});

const { default: AgentChat } = await import("@/components/dorit/chat/AgentChat");
const { AGENTS } = await import("@/config/agents");
const { CHAT_FUNCTION_CONSENT_POINTS, CHAT_FUNCTION_CONSENT_VERSION, CHAT_FUNCTION_SUPPORT_CONSENT_POINTS, CONSENT, SUPPORT_CONSENT_POINTS } = await import(
  "@/config/compliance"
);

describe("the FAQ chat on the chat function", () => {
  beforeEach(() => invoke.mockReset());

  it("shows the FAQ chat's own v6 notice, not the interview's", () => {
    render(<MemoryRouter><AgentChat descriptor={AGENTS.support} /></MemoryRouter>);
    for (const point of CHAT_FUNCTION_SUPPORT_CONSENT_POINTS) expect(screen.getByText(point)).toBeTruthy();
    expect(screen.queryByText(CHAT_FUNCTION_CONSENT_POINTS[3])).toBeNull();
    expect(screen.queryByText(CONSENT.points[2])).toBeNull();
    expect(screen.queryByText(SUPPORT_CONSENT_POINTS[3])).toBeNull();
  });

  it("sends the first message as support_agent with the v6 stamp, and shows the reply", async () => {
    invoke.mockResolvedValue({ data: { ok: true, conversationId: "s1", token: "t".repeat(64), reply: "דמי ניהול הם…", leadSaved: false }, error: null });
    const user = userEvent.setup();
    render(<MemoryRouter><AgentChat descriptor={AGENTS.support} /></MemoryRouter>);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /התחלת השיחה/ }));
    await user.type(screen.getByPlaceholderText("כתבו כאן…"), "מה זה דמי ניהול?");
    await user.click(screen.getByRole("button", { name: "שליחה" }));
    expect(await screen.findByText("דמי ניהול הם…")).toBeTruthy();
    expect(invoke.mock.calls[0][0]).toBe("chat");
    expect(invoke.mock.calls[0][1].body).toMatchObject({ agent: "support_agent", consentVersion: CHAT_FUNCTION_CONSENT_VERSION });
  });
});
