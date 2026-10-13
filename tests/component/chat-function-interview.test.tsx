/**
 * @vitest-environment jsdom
 *
 * The interview on the chat function: consent v6, the reply through the
 * adapter, the lead saved by the function (no fenced block), and Dorit's
 * channels when the function cannot answer. Agents NOT served by the function
 * keep v5 and the 20 s watchdog.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  CHAT_FUNCTION_AGENTS: ["needs_interview"],
  CHAT_AGENTS: new Set(["needs_interview"]),
  parseChatAgents: () => new Set(["needs_interview"]),
  servedByChatFunction: (agent: string) => agent === "needs_interview",
}));

const invoke = vi.fn();
/** Every agents.start call: the agent and the conversation metadata it was given. */
const starts: [string, Record<string, unknown>][] = [];
const submitInterview = vi.fn(async () => ({ ok: true }));
/** What a Base44 agent's send does here: accepted, and no reply ever comes. */
const base44Send = vi.fn(async () => undefined);
vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  const { SupabaseAgentService } = await import("@/services/supabase/SupabaseAgentService");
  const chat = new SupabaseAgentService({ functions: { invoke } }, () => "local-1");
  const agents = {
    start: async (agent: string, meta: Record<string, unknown>) => {
      starts.push([agent, meta]);
      return agent === "needs_interview" ? chat.start(agent, meta) : { id: "b44_1" };
    },
    send: async (conv: { id: string }, text: string) =>
      conv.id === "b44_1" ? base44Send() : chat.send(conv, text),
    subscribe: (id: string, cb: (m: any[]) => void) => (id === "b44_1" ? () => undefined : chat.subscribe(id, cb)),
  };
  return {
    ...actual,
    services: { ...actual.services, agents, leads: { ...actual.services.leads, submitInterview } },
  };
});

const { default: AgentChat, NO_REPLY_TIMEOUT_MS } = await import("@/components/dorit/chat/AgentChat");
const { AGENTS } = await import("@/config/agents");
const { CHAT_FUNCTION_CONSENT_POINTS, CHAT_FUNCTION_CONSENT_VERSION, CONSENT, CONSENT_VERSION, HUMAN_HANDOFF } = await import("@/config/compliance");
const { LEAD_SAVED_WITHOUT_REPLY } = await import("@/services/agent-errors");
const { leadEvents } = await import("@/lib/analytics");

async function startAndSend(text = "שלום") {
  const user = userEvent.setup();
  render(<MemoryRouter><AgentChat descriptor={AGENTS.needsInterview} /></MemoryRouter>);
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: /התחלת השיחה/ }));
  await user.type(screen.getByPlaceholderText("כתבו כאן…"), text);
  await user.click(screen.getByRole("button", { name: "שליחה" }));
}

/** fireEvent, for the fake-timer tests: userEvent deadlocks against fake timers. */
async function startAndSendSync(descriptor: typeof AGENTS.needsInterview, text = "שלום") {
  render(<MemoryRouter><AgentChat descriptor={descriptor} /></MemoryRouter>);
  await act(async () => fireEvent.click(screen.getByRole("checkbox")));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /התחלת השיחה/ })));
  await act(async () => fireEvent.change(screen.getByPlaceholderText("כתבו כאן…"), { target: { value: text } }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "שליחה" })));
}

const failure = (status: number, code: string) => ({
  data: null,
  error: { message: "non-2xx", context: new Response(JSON.stringify({ ok: false, code, rid: "r1" }), { status }) },
});

describe("the interview on the chat function", () => {
  beforeEach(() => {
    invoke.mockReset();
    submitInterview.mockClear();
    base44Send.mockClear();
  });

  it("shows the v6 notice", () => {
    render(<MemoryRouter><AgentChat descriptor={AGENTS.needsInterview} /></MemoryRouter>);
    expect(screen.getByText(CHAT_FUNCTION_CONSENT_POINTS[3])).toBeTruthy();
  });

  it("sends the first message with the v6 stamp and shows the reply", async () => {
    invoke.mockResolvedValue({ data: { ok: true, conversationId: "s1", token: "t".repeat(64), reply: "שלום! איך אפשר לעזור?", leadSaved: false }, error: null });
    await startAndSend();
    expect(await screen.findByText("שלום! איך אפשר לעזור?")).toBeTruthy();
    expect(invoke.mock.calls[0][1].body).toMatchObject({ agent: "needs_interview", consentVersion: CHAT_FUNCTION_CONSENT_VERSION });
  });

  it("counts the lead the function saved, and never submits it from the page", async () => {
    const completed = vi.spyOn(leadEvents, "interviewCompleted");
    invoke.mockResolvedValue({ data: { ok: true, conversationId: "s1", token: "t".repeat(64), reply: "נשמר. דורית תחזור אלייך.", leadSaved: true }, error: null });
    await startAndSend("כן, זה מדויק");
    await waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
    expect(submitInterview).not.toHaveBeenCalled();
  });

  it("shows Dorit's channels and gives the text back when the function cannot answer", async () => {
    invoke.mockResolvedValue(failure(503, "unavailable"));
    await startAndSend("שאלה");
    await waitFor(() => expect([...document.querySelectorAll("a")].some((a) => (a.getAttribute("href") ?? "").startsWith("tel:"))).toBe(true));
    expect((screen.getByPlaceholderText("כתבו כאן…") as HTMLTextAreaElement).value).toBe("שאלה");
  });

  it("answers a rate limit with its own final wording and gives the text back", async () => {
    invoke.mockResolvedValue(failure(429, "rate_limited"));
    await startAndSend("עוד אחת");
    expect(await screen.findByText("נשלחו הרבה הודעות בזמן קצר. אפשר לנסות שוב בעוד דקה.")).toBeTruthy();
    expect((screen.getByPlaceholderText("כתבו כאן…") as HTMLTextAreaElement).value).toBe("עוד אחת");
  });

  it("answers a message sent while the last one is still being answered, and gives the text back", async () => {
    invoke.mockResolvedValue(failure(409, "busy"));
    await startAndSend("עוד משהו");
    expect(await screen.findByText("הודעה קודמת עדיין בטיפול — רגע אחד.")).toBeTruthy();
    expect((screen.getByPlaceholderText("כתבו כאן…") as HTMLTextAreaElement).value).toBe("עוד משהו");
  });

  it("shows the saved confirmation and Dorit's channels when the lead was saved but the reply failed (503 leadSaved)", async () => {
    const completed = vi.spyOn(leadEvents, "interviewCompleted");
    completed.mockClear();
    invoke.mockResolvedValue({
      data: null,
      error: { message: "non-2xx", context: new Response(JSON.stringify({ ok: false, code: "unavailable", rid: "r1", leadSaved: true, conversationId: "s1", token: "t".repeat(64) }), { status: 503 }) },
    });
    await startAndSend("כן, הכל נכון");
    expect(await screen.findByText(LEAD_SAVED_WITHOUT_REPLY)).toBeTruthy();
    await waitFor(() => expect([...document.querySelectorAll("a")].some((a) => (a.getAttribute("href") ?? "").startsWith("tel:"))).toBe(true));
    expect(screen.getByText(HUMAN_HANDOFF.reachHer)).toBeTruthy();
    expect(screen.queryByText(HUMAN_HANDOFF.failure)).toBeNull();
    expect(completed).toHaveBeenCalledTimes(1);
    expect(submitInterview).not.toHaveBeenCalled();
    // Saved, so nothing is handed back to send again.
    expect((screen.getByPlaceholderText("כתבו כאן…") as HTMLTextAreaElement).value).toBe("");
  });

  it("shows the visitor's message while the reply is on its way", async () => {
    let release: (v: unknown) => void = () => undefined;
    invoke.mockImplementation(() => new Promise((r) => (release = r)));
    await startAndSend("מה עם הפנסיה שלי?");
    expect(await screen.findByText("מה עם הפנסיה שלי?")).toBeTruthy();
    await act(async () => release({ data: { ok: true, conversationId: "s1", token: "t".repeat(64), reply: "נבדוק יחד.", leadSaved: false }, error: null }));
    expect(await screen.findByText("נבדוק יחד.")).toBeTruthy();
  });

  it("answers a closed conversation with its own final wording", async () => {
    invoke.mockResolvedValue(failure(410, "gone"));
    await startAndSend("חזרתי");
    expect(await screen.findByText("השיחה הזו הסתיימה. אפשר להתחיל שיחה חדשה.")).toBeTruthy();
  });
});

describe("agents not served by the chat function", () => {
  it("open their Base44 conversation with main's metadata only, no attribution keys (dark means byte-exact)", async () => {
    starts.length = 0;
    await startAndSendSync(AGENTS.support);
    const [agent, meta] = starts.at(-1)!;
    expect(agent).toBe(AGENTS.support.agent);
    expect(Object.keys(meta).sort()).toEqual(["consent_at", "consent_version", "description", "name"]);
    expect(meta).toMatchObject({ name: AGENTS.support.conversationName, description: AGENTS.support.conversationDescription, consent_version: CONSENT_VERSION });
  });

  it("while the interview on the chat function sends its attribution", async () => {
    starts.length = 0;
    invoke.mockResolvedValue({ data: { ok: true, conversationId: "s1", token: "t".repeat(64), reply: "שלום", leadSaved: false }, error: null });
    await startAndSendSync(AGENTS.needsInterview);
    expect(Object.keys(starts.at(-1)![1]).sort()).toEqual(["campaign", "channel", "consent_at", "consent_version", "description", "landing_path", "name"]);
  });

  it("keep the v5 notice, byte for byte", () => {
    render(<MemoryRouter><AgentChat descriptor={AGENTS.support} /></MemoryRouter>);
    const points = AGENTS.support.consentPoints ?? CONSENT.points;
    for (const point of points) expect(screen.getByText(point)).toBeTruthy();
    expect(screen.queryByText(CHAT_FUNCTION_CONSENT_POINTS[3])).toBeNull();
  });
});

describe("the no-reply watchdog", () => {
  beforeEach(() => {
    invoke.mockReset();
    base44Send.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("stays off for an agent on the chat function, even when the reply takes longer than 20 s", async () => {
    invoke.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ data: { ok: true, conversationId: "s1", token: "t".repeat(64), reply: "תשובה איטית", leadSaved: false }, error: null }), NO_REPLY_TIMEOUT_MS + 5_000)),
    );
    await startAndSendSync(AGENTS.needsInterview);
    await act(async () => vi.advanceTimersByTimeAsync(NO_REPLY_TIMEOUT_MS + 1_000));
    expect(screen.queryByText(/לא התקבלה כראוי/)).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.getByText("תשובה איטית")).toBeTruthy();
  });

  it("still fires for a Base44 agent whose reply never comes", async () => {
    await startAndSendSync(AGENTS.support);
    expect(base44Send).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(NO_REPLY_TIMEOUT_MS));
    expect(screen.getByText(/לא התקבלה כראוי/)).toBeTruthy();
  });
});
