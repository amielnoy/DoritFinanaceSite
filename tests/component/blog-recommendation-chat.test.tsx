/**
 * @vitest-environment jsdom
 *
 * AgentChat's generic side of the reading-recommender feature: it knows
 * nothing about `recommended` blocks specifically, only that it strips
 * whatever `readHandoff`/`readRecommendation` remove before rendering, and
 * reports each new assistant message to `onAssistantMessage` — once, with
 * the raw content, for a caller (the blog page) to parse itself.
 *
 * Driven through the chat function's adapter: a turn's `recommended` slugs
 * become the block the page reads.
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

const REPLY = 'דורית ממליצה לקרוא על "דמי ניהול בפנסיה" — רלוונטי למה שתיארת.';
/** What the page is handed: the reply, and the block the adapter writes from the turn's `recommended` slugs. */
const RECOMMENDATION = `${REPLY}\n\n\`\`\`recommended\n["dmei-nihul"]\n\`\`\``;

/** The chat function, faked at `functions.invoke`; the adapter is the real one. */
const invoke = vi.fn();
vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  const { SupabaseAgentService } = await import("@/services/supabase/SupabaseAgentService");
  const chat = new SupabaseAgentService({ functions: { invoke } }, () => "local-1");
  return { ...actual, services: { ...actual.services, agents: chat } };
});

const { default: AgentChat } = await import("@/components/dorit/chat/AgentChat");
const { AGENTS } = await import("@/config/agents");
const { CHAT_FUNCTION_BLOG_CONSENT_POINTS } = await import("@/config/compliance");

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
  invoke.mockReset();
  invoke.mockResolvedValue({
    data: { ok: true, conversationId: "b1", token: "t".repeat(64), reply: REPLY, recommended: ["dmei-nihul"], leadSaved: false },
    error: null,
  });
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
      expect(chatText).not.toContain("dmei-nihul");
      expect(chatText).toContain('דורית ממליצה לקרוא על "דמי ניהול בפנסיה"');
    });
  });

  it("does not re-report the same trailing assistant message once a later user message arrives", async () => {
    const user = await startConversation();
    await waitFor(() => expect(onAssistantMessage).toHaveBeenLastCalledWith(RECOMMENDATION));
    const callsSoFar = onAssistantMessage.mock.calls.length;

    // A further visitor message shows at once, before its answer; the
    // trailing assistant content is unchanged, so this must not call
    // onAssistantMessage again.
    invoke.mockImplementationOnce(() => new Promise(() => undefined));
    await user.type(screen.getByPlaceholderText("כתבו כאן…"), "תודה");
    await user.click(screen.getByRole("button", { name: "שליחה" }));

    await waitFor(() => expect(screen.getByText("תודה")).toBeInTheDocument());
    expect(onAssistantMessage).toHaveBeenCalledTimes(callsSoFar);
  });
});

describe("the reading recommender's consent gate", () => {
  const renderGate = (initialInput?: string) =>
    render(
      <MemoryRouter>
        <AgentChat descriptor={AGENTS.blogRecommender} embedded initialInput={initialInput} />
      </MemoryRouter>,
    );

  it("shows the approved one line, the licence and the v6 line, not the interview's notice", () => {
    renderGate();
    expect(screen.getByText("עוזר אוטומטי של דורית, לא ייעוץ. אין לכתוב תעודת זהות או מספרי פוליסה.")).toBeInTheDocument();
    expect(screen.getByText(/L-00107009/)).toBeInTheDocument();
    expect(screen.getByText(CHAT_FUNCTION_BLOG_CONSENT_POINTS[2])).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(document.body.textContent).not.toContain("נאספים שם וטלפון בלבד");
  });

  it("still gates the first message on the checkbox", async () => {
    const user = userEvent.setup();
    renderGate("נולד לנו ילד");
    const start = screen.getByRole("button", { name: /התחלת השיחה/ });
    expect(start).toBeDisabled();
    expect(screen.getByRole("button", { name: "שליחה" })).toBeDisabled();
    expect(screen.getByLabelText(AGENTS.blogRecommender.inputLabel)).toHaveValue("נולד לנו ילד");
    await user.click(screen.getByRole("checkbox"));
    expect(start).toBeEnabled();
  });
});
