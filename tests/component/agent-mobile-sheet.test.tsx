/**
 * @vitest-environment jsdom
 *
 * Below md, the support chat is a card on the page and a full-screen layer
 * over it (`mobileSheet` in src/config/agents.ts). On a desktop it is the
 * embedded panel it always was.
 *
 * What these pin is the part a layout change could quietly lose: the consent
 * notice word for word, the GA4 events fired from inside the layer, the
 * dialog's keyboard contract, and that a desktop sees none of it.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
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

const escalate = vi.fn(async () => ({
  ok: true,
  contact: { phoneDisplay: "050-831-1776", phoneE164: "+972508311776", whatsapp: "972508311776", email: "d@example.com" },
  acknowledgement: "",
  warnings: [],
}));

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
const { SUPPORT_CONSENT_POINTS } = await import("@/config/compliance");

/** A viewport `width` px wide, as far as `matchMedia("(min-width: …)")` is concerned. */
let width = 1440;
const listeners = new Set<() => void>();
function viewport(w: number) {
  width = w;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const min = /min-width:\s*(\d+)px/.exec(query);
      return {
        get matches() {
          return min ? width >= Number(min[1]) : false;
        },
        media: query,
        onchange: null,
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      };
    },
  });
}
/** Resize: the new width, and every query told that it may have changed. */
function resizeTo(w: number) {
  width = w;
  act(() => listeners.forEach((fn) => fn()));
}

function renderSupport() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <AgentChat descriptor={AGENTS.support} />
    </MemoryRouter>,
  );
  return user;
}

const opener = () => screen.getByRole("button", { name: "שאלו את העוזר" });

beforeEach(() => {
  (window as any).gtag = vi.fn();
  escalate.mockClear();
});

afterEach(() => {
  delete (window as any).gtag;
  delete (window as any).matchMedia;
  listeners.clear();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});

describe("on a phone, the support chat is a card that opens a layer", () => {
  beforeEach(() => viewport(390));

  it("shows the card, with the fence in a closed <details>, and no chat until asked", () => {
    renderSupport();
    expect(screen.getByRole("heading", { name: "לא מצאתם את התשובה?" })).toBeTruthy();
    expect(opener().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();

    const details = screen.getByText("מה העוזר עושה, ומה לא").closest("details")!;
    expect(details.open).toBe(false);
    // The fence, word for word, inside it.
    for (const line of [
      ...AGENTS.support.guardrails!.allowed,
      ...AGENTS.support.guardrails!.forbidden,
    ]) {
      expect(details.textContent).toContain(line);
    }
    expect(details.textContent).toContain(AGENTS.support.guardrails!.handoff);
    expect(details.textContent).toContain(AGENTS.support.tagline!);
    expect(details.textContent).toContain(AGENTS.support.note);
  });

  it("opens a modal dialog, locks the page's scroll, and shows the notice word for word", async () => {
    const user = renderSupport();
    await user.click(opener());

    const dialog = screen.getByRole("dialog", { name: "העוזר של דורית" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(opener().getAttribute("aria-expanded")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");
    expect(within(dialog).getByText("אוטומטי · לא דורית עצמה")).toBeTruthy();
    for (const point of SUPPORT_CONSENT_POINTS) expect(within(dialog).getByText(point)).toBeTruthy();
  });

  it("closes on Escape and on the X, and gives focus back to the button", async () => {
    const user = renderSupport();

    await user.click(opener());
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener());
    expect(document.body.style.overflow).toBe("");

    await user.click(opener());
    await user.click(screen.getByRole("button", { name: "סגירת הצ׳אט" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener());
  });

  it("fires chat_start and chat_handoff from inside the layer, and generate_lead only once it reaches Dorit", async () => {
    const user = renderSupport();
    await user.click(opener());
    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "התחלת השיחה" }));
    expect((window as any).gtag).toHaveBeenCalledWith("event", "chat_start", { method: "ai_support" });

    const handoff = within(dialog).getByRole("button", { name: "מעבר לטיפול אנושי" });
    await user.click(handoff);
    expect(handoff.getAttribute("aria-expanded")).toBe("true");
    expect((window as any).gtag).toHaveBeenCalledWith("event", "chat_handoff", { method: "ai_support" });
    expect((window as any).gtag).not.toHaveBeenCalledWith("event", "generate_lead", expect.anything());

    await user.type(within(dialog).getByLabelText(/טלפון/), "0527654321");
    await user.click(within(dialog).getByRole("button", { name: /שלחו לדורית/ }));
    await waitFor(() => expect(escalate).toHaveBeenCalledTimes(1));
    expect((window as any).gtag).toHaveBeenCalledWith("event", "generate_lead", { method: "ai_support" });
  });

  it("counts each opening of the layer as click_chat, from the chat's own section", async () => {
    const user = renderSupport();
    await user.click(opener());
    expect((window as any).gtag).toHaveBeenCalledWith("event", "click_chat", {
      method: "ai_support",
      location: "support-chat",
    });
    await user.click(screen.getByRole("button", { name: "סגירת הצ׳אט" }));
    await user.click(opener());
    const opened = (window as any).gtag.mock.calls.filter((c: unknown[]) => c[1] === "click_chat");
    expect(opened).toHaveLength(2);
  });

  it("keeps the conversation, and the consent, across closing and reopening", async () => {
    const user = renderSupport();
    await user.click(opener());
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "התחלת השיחה" }));
    await user.type(screen.getByLabelText("הודעה לסוכן התמיכה"), "טיוטה");

    await user.click(screen.getByRole("button", { name: "סגירת הצ׳אט" }));
    await user.click(opener());

    // The notice does not come back in the same conversation, and nothing typed was lost.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect((screen.getByLabelText("הודעה לסוכן התמיכה") as HTMLTextAreaElement).value).toBe("טיוטה");
  });

  it("gives every field in the layer at least 16px, so iOS does not zoom", async () => {
    const user = renderSupport();
    await user.click(opener());
    await user.click(screen.getByRole("button", { name: "מעבר לטיפול אנושי" }));
    const dialog = screen.getByRole("dialog");
    for (const field of within(dialog).getAllByRole("textbox")) {
      expect(field.className, field.outerHTML.slice(0, 80)).not.toMatch(/text-\[1[0-5]px\]|text-sm|text-xs/);
    }
  });

  it("goes back in place when the viewport grows past md", async () => {
    const user = renderSupport();
    await user.click(opener());
    expect(screen.getByRole("dialog")).toBeTruthy();

    resizeTo(1440);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "שאלו את העוזר" })).toBeNull();
    expect(document.querySelector(".h-\\[560px\\]")).not.toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});

describe("on a desktop, nothing changes", () => {
  it("renders the embedded panel and no card, with no matchMedia at all", () => {
    renderSupport();
    expect(screen.queryByRole("button", { name: "שאלו את העוזר" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("כללי הגדר").closest("details")).toBeNull();
    expect(document.querySelector(".h-\\[560px\\]")).not.toBeNull();
  });

  it("renders the same at 1440px with matchMedia present", () => {
    viewport(1440);
    renderSupport();
    expect(screen.queryByRole("button", { name: "שאלו את העוזר" })).toBeNull();
    expect(document.querySelector(".h-\\[560px\\]")).not.toBeNull();
  });

  it("leaves the home page's interview, which has no mobileSheet, as it was on a phone", () => {
    viewport(390);
    render(
      <MemoryRouter>
        <AgentChat descriptor={AGENTS.needsInterview} embedded />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "שאלו את העוזר" })).toBeNull();
    expect(document.querySelector(".h-\\[560px\\]")).not.toBeNull();
  });
});
