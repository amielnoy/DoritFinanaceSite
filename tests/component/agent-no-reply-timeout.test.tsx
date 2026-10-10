/**
 * @vitest-environment jsdom
 *
 * A send can succeed — the backend accepts the message, nothing throws — and
 * the reply still never arrives: an intermittent Base44 fault resolving an
 * anonymous conversation's owner has been observed to do exactly this, with
 * no error anywhere a visitor or a console can see. That failure lands
 * entirely outside `send()`'s own try/catch, in the separate subscribe path
 * that pushes replies into `messages` — this is the fallback that catches it.
 *
 * `fireEvent` rather than `userEvent`: this file runs under fake timers for
 * the whole test (the timeout under test is 20s real time), and `userEvent`'s
 * own internal scheduling deadlocks against fake timers even with `delay:
 * null` — `fireEvent` dispatches synchronously and has no such conflict.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
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

/** Captured so a test can push a reply manually, or never push one at all. */
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
          return () => undefined;
        },
      },
    },
  };
});

const { default: AgentChat, NO_REPLY_TIMEOUT_MS } = await import("@/components/dorit/chat/AgentChat");
const { AGENTS } = await import("@/config/agents");

async function startAndSend(text: string) {
  render(
    <MemoryRouter>
      <AgentChat descriptor={AGENTS.support} />
    </MemoryRouter>,
  );
  await act(async () => fireEvent.click(screen.getByRole("checkbox")));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /התחלת השיחה/ })));
  await act(async () =>
    fireEvent.change(screen.getByPlaceholderText("כתבו כאן…"), { target: { value: text } }),
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "שליחה" })));
}

beforeEach(() => {
  pushMessages = undefined;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a send that never gets a reply", () => {
  it("shows a fallback message once the timeout elapses", async () => {
    await startAndSend("שלום");

    expect(screen.queryByText(/לא התקבלה כראוי/)).not.toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(NO_REPLY_TIMEOUT_MS));
    expect(screen.getByText(/לא התקבלה כראוי/)).toBeInTheDocument();
  });

  it("never fires once a reply actually arrives", async () => {
    await startAndSend("שלום");

    await act(async () => vi.advanceTimersByTimeAsync(NO_REPLY_TIMEOUT_MS / 2));
    act(() => {
      pushMessages!([
        { role: "assistant", content: "ברוך הבא" },
        { role: "user", content: "שלום" },
        { role: "assistant", content: "תשובה אמיתית הגיעה בזמן" },
      ]);
    });

    await act(async () => vi.advanceTimersByTimeAsync(NO_REPLY_TIMEOUT_MS));
    expect(screen.queryByText(/לא התקבלה כראוי/)).not.toBeInTheDocument();
    expect(screen.getByText("תשובה אמיתית הגיעה בזמן")).toBeInTheDocument();
  });

  it("does not leave a stale timeout armed after the conversation is reset", async () => {
    await startAndSend("שלום");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "התחלה מחדש" })));
    await act(async () => vi.advanceTimersByTimeAsync(NO_REPLY_TIMEOUT_MS));
    expect(screen.queryByText(/לא התקבלה כראוי/)).not.toBeInTheDocument();
  });
});
