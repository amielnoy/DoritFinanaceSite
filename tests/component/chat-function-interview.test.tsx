/**
 * @vitest-environment jsdom
 *
 * The interview on the chat function: consent v6, the reply through the
 * adapter, the lead saved by the function (no fenced block), and Dorit's
 * channels when the function cannot answer. Every agent is on the function
 * (Base44 exit B1): no v5 notice, no 20 s watchdog.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => undefined, writable: true });
}
vi.mock("framer-motion", async () => {
  const R = await import("react");
  const passthrough = new Proxy({}, { get: (_t, tag: string) => ({ children, ...props }: any) => R.createElement(tag, props, children) });
  return { motion: passthrough, AnimatePresence: ({ children }: any) => R.createElement(R.Fragment, null, children), useReducedMotion: () => true };
});

const invoke = vi.fn();
/** Every agents.start call: the agent and the conversation metadata it was given. */
const starts: [string, Record<string, unknown>][] = [];
const submitInterview = vi.fn(async () => ({ ok: true }));
/** A send that ignores its abort signal, for the panel's own guard; null = the adapter's. */
let deafSend: (() => Promise<void>) | null = null;
vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  const { SupabaseAgentService } = await import("@/services/supabase/SupabaseAgentService");
  const chat = new SupabaseAgentService({ functions: { invoke } }, () => "local-1");
  const agents = {
    start: async (agent: string, meta: Record<string, unknown>) => {
      starts.push([agent, meta]);
      return chat.start(agent, meta);
    },
    send: async (conv: { id: string }, text: string, options?: { signal?: AbortSignal }) =>
      deafSend ? deafSend() : chat.send(conv, text, options),
    subscribe: (id: string, cb: (m: any[]) => void) => chat.subscribe(id, cb),
  };
  return {
    ...actual,
    services: { ...actual.services, agents, leads: { ...actual.services.leads, submitInterview } },
  };
});

const { default: AgentChat } = await import("@/components/dorit/chat/AgentChat");
const { AGENTS } = await import("@/config/agents");
const { CHAT_FUNCTION_CONSENT_POINTS, CHAT_FUNCTION_CONSENT_VERSION, HUMAN_HANDOFF } = await import("@/config/compliance");
const { LEAD_SAVED_WITHOUT_REPLY } = await import("@/services/agent-errors");
const { leadEvents } = await import("@/lib/analytics");
const { CHAT_REQUEST_TIMEOUT_MS, STATUS_POLL_MS, STATUS_RECOVERY_MS } = await import("@/services/supabase/SupabaseAgentService");

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

describe("the conversation's metadata", () => {
  it("while the interview on the chat function sends its attribution", async () => {
    starts.length = 0;
    invoke.mockResolvedValue({ data: { ok: true, conversationId: "s1", token: "t".repeat(64), reply: "שלום", leadSaved: false }, error: null });
    await startAndSendSync(AGENTS.needsInterview);
    expect(Object.keys(starts.at(-1)![1]).sort()).toEqual(["campaign", "channel", "consent_at", "consent_version", "description", "landing_path", "name"]);
  });
});

describe("a slow reply", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("is waited for with no apology, even when it takes longer than 20 s", async () => {
    invoke.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ data: { ok: true, conversationId: "s1", token: "t".repeat(64), reply: "תשובה איטית", leadSaved: false }, error: null }), 25_000)),
    );
    await startAndSendSync(AGENTS.needsInterview);
    await act(async () => vi.advanceTimersByTimeAsync(21_000));
    expect(screen.queryByText(/מצטערת/)).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.getByText("תשובה איטית")).toBeTruthy();
    expect(screen.queryByText(/מצטערת/)).toBeNull();
  });
});

/**
 * The adapter stops asking how a timed-out turn ended after its recovery
 * window; a turn still running then is received, not failed (review
 * 2026-10-15, item 14).
 */
describe("a turn still running when the adapter stops waiting", () => {
  beforeEach(() => {
    invoke.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("says the message is still being answered, keeps it in the transcript, and does not hand it back", async () => {
    invoke.mockImplementation(async (_n: string, { body }: { body: Record<string, unknown> }) =>
      body.status === true
        ? { data: { ok: true, busy: true, status: "open", leadSaved: false, turns: 1, last: null }, error: null }
        : new Promise(() => undefined),
    );
    await startAndSendSync(AGENTS.needsInterview, "מה עם הפנסיה שלי?");
    await act(async () => vi.advanceTimersByTimeAsync(CHAT_REQUEST_TIMEOUT_MS + STATUS_RECOVERY_MS + STATUS_POLL_MS));
    expect(screen.getByText(/ההודעה התקבלה ועדיין בטיפול/)).toBeTruthy();
    expect(screen.getByText("מה עם הפנסיה שלי?")).toBeTruthy();
    expect((screen.getByPlaceholderText("כתבו כאן…") as HTMLInputElement).value).toBe("");
  });
});

/**
 * A reset while a message is on its way (review 2026-10-15, item 13): the send
 * is abandoned, and nothing it finishes with reaches the new conversation.
 */
describe("a reset while a message is on its way", () => {
  beforeEach(() => {
    invoke.mockReset();
    deafSend = null;
  });

  afterEach(() => {
    deafSend = null;
  });

  it("aborts the chat function's request and leaves the new conversation clean and usable", async () => {
    let signal: AbortSignal | undefined;
    invoke.mockImplementationOnce((_n: string, o: { signal?: AbortSignal }) => {
      signal = o.signal;
      return new Promise(() => undefined);
    });
    await startAndSend("הודעה ראשונה");
    await userEvent.click(screen.getByRole("button", { name: "התחלה מחדש" }));
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByText("הודעה ראשונה")).toBeNull();
    expect(screen.queryByText(/לא הצלחתי לשלוח/)).toBeNull();
    expect((screen.getByPlaceholderText("כתבו כאן…") as HTMLInputElement).value).toBe("");

    invoke.mockResolvedValueOnce({ data: { ok: true, conversationId: "x", turn: 1, reply: "שיחה חדשה" }, error: null });
    await userEvent.type(screen.getByPlaceholderText("כתבו כאן…"), "שוב");
    await userEvent.click(screen.getByRole("button", { name: "שליחה" }));
    expect(await screen.findByText("שיחה חדשה")).toBeTruthy();
    expect(invoke.mock.calls[1][1].body.conversationId).not.toBe(invoke.mock.calls[0][1].body.conversationId);
  });

  it("ignores what an earlier conversation's send ends with, even from an adapter that cannot abort", async () => {
    let fail: (e: Error) => void = () => undefined;
    deafSend = () => new Promise((_resolve, reject) => (fail = reject));
    const user = userEvent.setup();
    render(<MemoryRouter><AgentChat descriptor={AGENTS.support} /></MemoryRouter>);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /התחלת השיחה/ }));
    await user.type(screen.getByPlaceholderText("כתבו כאן…"), "הודעה ישנה");
    await user.click(screen.getByRole("button", { name: "שליחה" }));
    await user.click(screen.getByRole("button", { name: "התחלה מחדש" }));
    await act(async () => fail(new Error("late failure")));
    expect((screen.getByPlaceholderText("כתבו כאן…") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/לא הצלחתי לשלוח/)).toBeNull();
  });
});
