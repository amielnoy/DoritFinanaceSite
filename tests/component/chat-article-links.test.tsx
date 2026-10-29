/**
 * @vitest-environment jsdom
 *
 * D-10, manual test 2026-10-14: the support chat (Base44 engine) linked an
 * article as /blog/6ac496b66444c62d843db5b9 — Base44's BlogPost has no slug,
 * so its record id is all the agent can name — and the address only worked
 * through the 301 to /blog/horadat-dmei-nihul. The chat shows the slug's
 * address once it has read the articles, and asks for them only when a reply
 * carries such a link.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const OLD_ID = "6ac496b66444c62d843db5b9";
let reply = "";
const listArticles = vi.fn(async () => [
  { id: OLD_ID, slug: "horadat-dmei-nihul", title: "הורדת דמי ניהול" },
  { id: "0123456789abcdef01234567", title: "מאמר בלי כתובת" },
]);

vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  return {
    ...actual,
    services: {
      ...actual.services,
      content: { ...actual.services.content, listArticles },
      agents: {
        start: vi.fn(async () => ({ id: "conv_1" })),
        send: vi.fn(async () => undefined),
        subscribe: (_id: string, cb: (msgs: unknown[]) => void) => {
          cb([
            { role: "assistant", content: "שלום" },
            { role: "user", content: "דמי ניהול" },
            { role: "assistant", content: reply },
          ]);
          return () => undefined;
        },
      },
    },
  };
});

const { default: AgentChat } = await import("@/components/dorit/chat/AgentChat");
const { AGENTS } = await import("@/config/agents");

async function converse() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <AgentChat descriptor={AGENTS.support} />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: /התחלת השיחה/ }));
  await user.type(screen.getByPlaceholderText("כתבו כאן…"), "דמי ניהול");
  await user.click(screen.getByRole("button", { name: "שליחה" }));
}

beforeEach(() => {
  listArticles.mockClear();
});

describe("article links in a chat reply", () => {
  it("point at the article's slug, not the Base44 record id", async () => {
    reply = `כדאי לקרוא [הורדת דמי ניהול](/blog/${OLD_ID}).`;
    await converse();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "הורדת דמי ניהול" }).getAttribute("href")).toBe("/blog/horadat-dmei-nihul"),
    );
    expect(listArticles).toHaveBeenCalledTimes(1);
  });

  it("keep the old address for an article with no slug, or one the list does not have", async () => {
    reply = "[בלי כתובת](/blog/0123456789abcdef01234567) ו[לא קיים](/blog/ffffffffffffffffffffffff)";
    await converse();
    await waitFor(() => expect(listArticles).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "בלי כתובת" }).getAttribute("href")).toBe("/blog/0123456789abcdef01234567");
    expect(screen.getByRole("link", { name: "לא קיים" }).getAttribute("href")).toBe("/blog/ffffffffffffffffffffffff");
  });

  it("leave slug links and other links alone, and do not read the articles for them", async () => {
    reply = "[מאמר](/blog/horadat-dmei-nihul) ו[לשיחה קצרה עם דורית](/#start)";
    await converse();
    await waitFor(() => expect(screen.getByRole("link", { name: "מאמר" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "מאמר" }).getAttribute("href")).toBe("/blog/horadat-dmei-nihul");
    expect(screen.getByRole("link", { name: "לשיחה קצרה עם דורית" }).getAttribute("href")).toBe("/#start");
    expect(listArticles).not.toHaveBeenCalled();
  });

  it("still links the old address when the articles cannot be read", async () => {
    listArticles.mockRejectedValueOnce(new Error("offline"));
    reply = `[הורדת דמי ניהול](/blog/${OLD_ID})`;
    await converse();
    await waitFor(() => expect(listArticles).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "הורדת דמי ניהול" }).getAttribute("href")).toBe(`/blog/${OLD_ID}`);
  });
});
