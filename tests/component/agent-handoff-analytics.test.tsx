/**
 * @vitest-environment jsdom
 *
 * A chat visitor who asks for a person and reaches one is a lead by any
 * definition GA4 has — and until now nothing reported it. `chat_handoff`
 * fires when the hand-off panel is opened, not when the request actually
 * reaches דורית, so a visitor who opened the panel and gave up looked
 * identical, in GA4, to one דורית actually heard from.
 */
import { render, screen, waitFor } from "@testing-library/react";
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

const CONTACT_FIXTURE = {
  phoneDisplay: "050-831-1776",
  phoneE164: "+972508311776",
  whatsapp: "972508311776",
  email: "dorit@govari-fin.co.il",
};

const escalate = vi.fn(async () => ({ ok: true, contact: CONTACT_FIXTURE, acknowledgement: "", warnings: [] }));

vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  return {
    ...actual,
    services: {
      ...actual.services,
      agents: {
        start: vi.fn(async () => ({ id: "conv_1" })),
        send: vi.fn(async () => undefined),
        subscribe: () => () => undefined,
      },
      support: { escalate },
    },
  };
});

const { default: AgentChat } = await import("@/components/dorit/chat/AgentChat");
const { AGENTS } = await import("@/config/agents");

/** Accept the notice and open the hand-off panel, without ever sending a message. */
async function openHandoff() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <AgentChat descriptor={AGENTS.support} />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: /התחלת השיחה/ }));
  await user.click(screen.getByRole("button", { name: /מעבר לטיפול אנושי/ }));
  return user;
}

describe("the hand-off button reports a lead only once it reaches Dorit", () => {
  beforeEach(() => {
    escalate.mockClear();
    (window as any).gtag = vi.fn();
  });

  afterEach(() => {
    delete (window as any).gtag;
  });

  it("counts it as a lead on a successful submission", async () => {
    const user = await openHandoff();

    await user.type(screen.getByLabelText(/שם/), "רונית אבני");
    await user.type(screen.getByLabelText(/טלפון/), "0527654321");
    await user.click(screen.getByRole("button", { name: /שלחו לדורית/ }));

    await waitFor(() => expect(escalate).toHaveBeenCalledTimes(1));
    expect((window as any).gtag).toHaveBeenCalledWith("event", "generate_lead", { method: "ai_support" });
  });

  it("does not count a submission the backend refused", async () => {
    escalate.mockResolvedValueOnce({ ok: false, contact: CONTACT_FIXTURE, acknowledgement: "", warnings: [] });
    const user = await openHandoff();

    await user.type(screen.getByLabelText(/שם/), "רונית אבני");
    await user.type(screen.getByLabelText(/טלפון/), "0527654321");
    await user.click(screen.getByRole("button", { name: /שלחו לדורית/ }));

    await waitFor(() => expect(escalate).toHaveBeenCalledTimes(1));
    expect((window as any).gtag).not.toHaveBeenCalledWith("event", "generate_lead", expect.anything());
  });

  it("never fires just from opening the panel", async () => {
    await openHandoff();
    expect((window as any).gtag).not.toHaveBeenCalledWith("event", "generate_lead", expect.anything());
  });
});

describe("location attribution for a non-embedded chat", () => {
  it("tags its own section, so a click inside does not resolve to 'unknown'", async () => {
    render(
      <MemoryRouter>
        <AgentChat descriptor={AGENTS.support} />
      </MemoryRouter>,
    );
    expect(document.querySelector('[data-track-location="support-chat"]')).not.toBeNull();
  });
});

describe("the interview's attribution never comes from the model", () => {
  it("ignores channel/campaign if the agent's fenced block happens to include them", async () => {
    const { readHandoff } = await import("@/lib/interview-handoff");
    const { summary } = readHandoff(
      "תודה.\n\n```lead\n" +
        JSON.stringify({ name: "רונית", phone: "0500000000", channel: "google", campaign: "hack" }) +
        "\n```"
    );
    expect(summary).not.toBeNull();
    expect(summary).not.toHaveProperty("channel");
    expect(summary).not.toHaveProperty("campaign");
  });
});
