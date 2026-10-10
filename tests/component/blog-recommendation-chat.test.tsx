/**
 * @vitest-environment jsdom
 *
 * AgentChat's generic side of the reading-recommender feature: it knows
 * nothing about `recommended` blocks specifically, only that it strips
 * whatever `readHandoff`/`readRecommendation` remove before rendering, and
 * reports each new assistant message to `onAssistantMessage` — once, with
 * the raw content, for a caller (the blog page) to parse itself.
 */
import { render, screen, waitFor } from "@testing-library/react";
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
  const passthrough = new Proxy(
    {},
    { get: (_t, tag: string) => ({ children, ...props }: any) => R.createElement(tag, props, children) },
  );
  return {
    motion: passthrough,
    AnimatePresence: ({ children }: any) => R.createElement(R.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

const RECOMMENDATION =
  'דורית ממליצה לקרוא על "דמי ניהול בפנסיה" — רלוונטי למה שתיארת.\n\n```recommended\n["abc123"]\n```';

/** Lets the test push further server updates after the conversation starts. */
let pushMessages: ((msgs: unknown[]) => void) | undefined;

vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  return {
    ...actual,
    services: {
      ...actual.services,
      agents: {
        start: vi.fn(async () => ({ id: "conv_1" })),
        send: vi.fn(async () => undefined),
        subscribe: (_id: string, cb: (msgs: unknown[]) => void) => {
          pushMessages = cb;
          cb([
            { role: "assistant", content: "שלום, איזה נושא פיננסי מעניין אותך לקרוא?" },
            { role: "user", content: "דמי ניהול" },
            { role: "assistant", content: RECOMMENDATION },
          ]);
          return () => undefined;
        },
      },
    },
  };
});

const { default: AgentChat } = await import("@/components/dorit/chat/AgentChat");
const { AGENTS } = await import("@/config/agents");

async function startConversation() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <AgentChat descriptor={AGENTS.blogRecommender} onAssistantMessage={onAssistantMessage} />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: /התחלת השיחה/ }));
  // conversationId (and so `subscribe`) is only set once a message is actually sent.
  await user.type(screen.getByPlaceholderText("כתבו כאן…"), "דמי ניהול");
  await user.click(screen.getByRole("button", { name: "שליחה" }));
  return user;
}

const onAssistantMessage = vi.fn();

beforeEach(() => {
  onAssistantMessage.mockClear();
  pushMessages = undefined;
});

describe("AgentChat reports each new assistant message", () => {
  it("calls onAssistantMessage with the raw content, block included", async () => {
    await startConversation();
    await waitFor(() => expect(onAssistantMessage).toHaveBeenCalledWith(RECOMMENDATION));
  });

  it("never shows the recommended block to the visitor", async () => {
    await startConversation();
    await waitFor(() => {
      const chatText = document.body.textContent ?? "";
      expect(chatText).not.toContain("```recommended");
      expect(chatText).not.toContain("abc123");
      expect(chatText).toContain('דורית ממליצה לקרוא על "דמי ניהול בפנסיה"');
    });
  });

  it("does not re-report the same trailing assistant message once a later user message arrives", async () => {
    await startConversation();
    await waitFor(() => expect(onAssistantMessage).toHaveBeenLastCalledWith(RECOMMENDATION));
    const callsSoFar = onAssistantMessage.mock.calls.length;

    // The server echoes a further visitor message; the trailing assistant
    // content is unchanged, so this must not call onAssistantMessage again.
    pushMessages!([
      { role: "assistant", content: "שלום, איזה נושא פיננסי מעניין אותך לקרוא?" },
      { role: "user", content: "דמי ניהול" },
      { role: "assistant", content: RECOMMENDATION },
      { role: "user", content: "תודה" },
    ]);

    await waitFor(() => expect(screen.getByText("תודה")).toBeInTheDocument());
    expect(onAssistantMessage).toHaveBeenCalledTimes(callsSoFar);
  });
});
