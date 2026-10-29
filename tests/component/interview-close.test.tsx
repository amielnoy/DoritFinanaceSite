/**
 * @vitest-environment jsdom
 *
 * The end of an interview, on the chat function.
 *
 * The function saves the lead itself and marks the reply that saved it
 * (`signal: "lead_saved"`); the page only counts it. Until Base44 exit B1 the
 * page also submitted a fenced `lead` block an agent wrote, because Base44 did
 * not run an anonymous conversation's tools (A-59). The function never sends
 * one, so these pin what is left: a close is counted once, nothing is ever
 * submitted from the page, and a block a model slips in is never shown.
 *
 * The seam is `services.agents.subscribe`, the transcript the adapter pushes.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@/services";

// jsdom has no layout, so `Element.scrollTo` does not exist. The chat scrolls
// its transcript on every message, which is cosmetic here and fatal if absent.
if (!("scrollTo" in Element.prototype)) {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => undefined, writable: true });
}

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

/** The one seam that matters: what the agent says, and what the page sends. */
const submitInterview = vi.fn(async () => ({ ok: true }));
let push: ((messages: AgentMessage[]) => void) | null = null;

vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  return {
    ...actual,
    services: {
      ...actual.services,
      agents: {
        start: vi.fn(async () => ({ id: "conv_1" })),
        send: vi.fn(async () => undefined),
        subscribe: (_id: string, cb: (m: AgentMessage[]) => void) => {
          push = cb;
          return () => undefined;
        },
      },
      leads: { ...actual.services.leads, submitInterview },
      support: {
        escalate: vi.fn(async () => ({
          ok: true,
          contact: {
            phoneDisplay: "050-831-1776",
            phoneE164: "+972508311776",
            whatsapp: "972508311776",
            email: "dorit@govari-fin.co.il",
          },
          acknowledgement: "",
          warnings: [],
        })),
      },
    },
  };
});

const { default: AgentChat } = await import("@/components/dorit/chat/AgentChat");
const { AGENTS } = await import("@/config/agents");
const { leadEvents } = await import("@/lib/analytics");

const PAYLOAD = {
  name: "רונית אבני",
  phone: "0527654321",
  email: "ronit@example.com",
  track: "pension",
  meetingTopic: "גמל, השתלמות ופנסיה",
  timing: "יום ראשון בבוקר",
  scheduledAt: "2026-10-11T11:00:00",
  summary: "שכירה, מתעניינת בדמי ניהול",
  profile: { life_stage: "שכירה", goal: "שיפור צבירה", concern: "דמי ניהול" },
};

const closing = (json: string) =>
  `תודה, רונית. הסיכום הועבר לדורית.\n\n\`\`\`lead\n${json}\n\`\`\``;

/** The reply the chat function marks as the one that saved the lead. */
const SAVED: AgentMessage = { role: "assistant", content: "תודה, רונית. הפרטים נשמרו ודורית תחזור אלייך.", signal: "lead_saved" };

/** Accept the notice, send one message, and hand back the agent's reply. */
async function interviewTo(reply: string | AgentMessage) {
  const user = userEvent.setup();
  // The chat alone, not the page: `Home` pulls in the auth provider and the
  // SDK, neither of which has anything to do with what is under test.
  render(
    <MemoryRouter>
      <AgentChat descriptor={AGENTS.needsInterview} />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: /התחלת השיחה/ }));
  await user.type(screen.getByPlaceholderText("כתבו כאן…"), "שלום");
  await user.click(screen.getByRole("button", { name: "שליחה" }));
  await waitFor(() => expect(push).toBeTruthy());
  // Inside `act`: the transcript arrives from outside React, and an update that
  // is not wrapped never flushes here.
  await act(async () => push!([typeof reply === "string" ? { role: "assistant", content: reply } : reply]));
}

describe("the interview actually closes", () => {
  let completed: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    submitInterview.mockClear();
    push = null;
    completed = vi.spyOn(leadEvents, "interviewCompleted");
  });
  afterEach(() => completed.mockRestore());

  it("never shows the visitor a lead block, and never submits it from the page", async () => {
    await interviewTo(closing(JSON.stringify(PAYLOAD)));

    expect(await screen.findByText(/הסיכום הועבר לדורית/)).toBeTruthy();
    expect(screen.queryByText(/```lead/)).toBeNull();
    expect(screen.queryByText(/0527654321/)).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(submitInterview).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
  });

  it("counts the close once, however many times the transcript is pushed", async () => {
    // The transcript is replaced wholesale on every push, so the closing
    // message arrives again and again. A second count is a second lead in GA4.
    await interviewTo(SAVED);
    await waitFor(() => expect(completed).toHaveBeenCalledTimes(1));

    await act(async () => push!([SAVED]));
    await act(async () => push!([SAVED]));

    await waitFor(() => expect(completed).toHaveBeenCalledTimes(1));
    expect(submitInterview).not.toHaveBeenCalled();
  });

  it("counts and submits nothing for an ordinary reply", async () => {
    // The opposite mistake: a conversation about pensions that happens to carry
    // a fenced block must not file an enquiry nobody agreed to.
    await interviewTo('שאלה טובה.\n\n```json\n{"name":"דוגמה","phone":"0500000000"}\n```');

    await new Promise((r) => setTimeout(r, 50));
    expect(submitInterview).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
  });
});
