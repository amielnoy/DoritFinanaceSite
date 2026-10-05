/**
 * @vitest-environment jsdom
 *
 * The end of an interview — the part that was broken, and the part no test
 * reached.
 *
 * Base44 does not execute an agent's tool calls in an anonymous conversation,
 * and every visitor is anonymous. Proven by running the same scripted interview
 * twice against the same build: signed in, `submitLead` fires and everything
 * lands; anonymous, it is never invoked and the agent signs off telling the
 * visitor it could not save (A-59). For three days every interview completed on
 * a phone was discarded while the visitor was told it had reached Dorit.
 *
 * The page carries the close itself now: the agent ends with a fenced `lead`
 * block, `AgentChat` strips it from the transcript and submits it.
 *
 * ── why this is a component test and not e2e ──────────────────────────────
 *
 * It was written as e2e first. The transcript arrives over socket.io, and the
 * Playwright fixture stubs `**​/api/**` only, so the subscription never
 * delivered: three specs failed and the fourth passed for the wrong reason —
 * "no submission happened" is trivially true when no message ever arrives.
 *
 * Stubbing socket.io in the browser would have tested the stub more than the
 * app. The logic here is entirely client-side and the transport is incidental,
 * so the honest seam is `services.agents.subscribe`.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@/services";

// jsdom has no layout, so `Element.scrollTo` does not exist. The chat scrolls
// its transcript on every message, which is cosmetic here and fatal if absent.
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

/** Every dialable or mailable address currently on screen. */
const dialable = () =>
  [...document.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");

const closing = (json: string) =>
  `תודה, רונית. הסיכום הועבר לדורית.\n\n\`\`\`lead\n${json}\n\`\`\``;

/** Accept the notice, send one message, and hand back the agent's reply. */
async function interviewTo(reply: string) {
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
  await act(async () => push!([{ role: "assistant", content: reply }]));
}

describe("the interview actually closes", () => {
  beforeEach(() => {
    submitInterview.mockClear();
    push = null;
  });

  it("submits the summary the agent could not", async () => {
    await interviewTo(closing(JSON.stringify(PAYLOAD)));

    await waitFor(() => expect(submitInterview).toHaveBeenCalledTimes(1));
    // Every field Dorit's mail is built from. A close carrying a name and a
    // phone number and nothing else is the same failure wearing a disguise: it
    // saves, it notifies, and it tells her nothing about the conversation.
    expect(submitInterview).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "רונית אבני",
        phone: "0527654321",
        track: "pension",
        meetingTopic: "גמל, השתלמות ופנסיה",
        scheduledAt: "2026-10-11T11:00:00",
        profile: expect.objectContaining({ concern: "דמי ניהול" }),
      }),
    );
  });

  it("never shows the visitor the machinery", async () => {
    await interviewTo(closing(JSON.stringify(PAYLOAD)));

    expect(await screen.findByText(/הסיכום הועבר לדורית/)).toBeTruthy();
    expect(screen.queryByText(/```lead/)).toBeNull();
    expect(screen.queryByText(/0527654321/)).toBeNull();
  });

  it("submits once, however many times the transcript is pushed", async () => {
    // The transcript is replaced wholesale on every push, so the closing
    // message arrives again and again. A second submission means Dorit gets the
    // same enquiry twice, and nobody involved can tell.
    const message = closing(JSON.stringify(PAYLOAD));
    await interviewTo(message);
    await waitFor(() => expect(submitInterview).toHaveBeenCalledTimes(1));

    await act(async () => push!([{ role: "assistant", content: message }]));
    await act(async () => push!([{ role: "assistant", content: message }]));

    await waitFor(() => expect(submitInterview).toHaveBeenCalledTimes(1));
  });

  it("gives the visitor Dorit when the close cannot be read", async () => {
    // The failure this mechanism exists to prevent is a visitor believing they
    // were passed on when they were not. Replacing it with a silent one would
    // be no better, so an unreadable block shows the direct channels.
    await interviewTo(closing('{"name": "רונית", '));

    // By href rather than by role: what has to be true is that the visitor can
    // dial her, and the markdown renderer's anchor is the thing that carries it.
    await waitFor(() => expect(dialable()).toContain("tel:+972508311776"));
    expect(submitInterview).not.toHaveBeenCalled();
    expect(screen.queryByText(/```lead/)).toBeNull();
  });

  it("refuses a close nobody could be called back on", async () => {
    await interviewTo(closing(JSON.stringify({ name: "רונית" })));

    // By href rather than by role: what has to be true is that the visitor can
    // dial her, and the markdown renderer's anchor is the thing that carries it.
    await waitFor(() => expect(dialable()).toContain("tel:+972508311776"));
    expect(submitInterview).not.toHaveBeenCalled();
  });

  it("submits nothing for an ordinary reply", async () => {
    // The opposite mistake: a conversation about pensions that happens to carry
    // a fenced block must not file an enquiry nobody agreed to.
    await interviewTo('שאלה טובה.\n\n```json\n{"name":"דוגמה","phone":"0500000000"}\n```');

    await new Promise((r) => setTimeout(r, 50));
    expect(submitInterview).not.toHaveBeenCalled();
  });
});
