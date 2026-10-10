/**
 * @vitest-environment jsdom
 *
 * The blog page's own responsibility in the reading-recommender feature:
 * given recommended post ids, highlight the matching cards and scroll the
 * first one into view. AgentChat's plumbing (stripping the block, calling
 * onAssistantMessage) is covered separately in blog-recommendation-chat.test.tsx —
 * here AgentChat is stubbed so this test is about Blog.tsx's own reaction.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { base44Mock, resetBase44Mock } from "./base44-mock";

if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock("@/api/base44Client", () => ({ base44: base44Mock }));
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

const auth = vi.hoisted(() => ({ isAuthenticated: false, user: null as null | { role: string } }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth }));

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

/** A stand-in that lets the test fire `onAssistantMessage` on demand, instead
 *  of driving AgentChat's real consent/send flow (covered elsewhere). */
let capturedOnAssistantMessage: ((content: string) => void) | undefined;
vi.mock("@/components/dorit/chat/AgentChat", () => ({
  default: (props: { onAssistantMessage?: (content: string) => void }) => {
    capturedOnAssistantMessage = props.onAssistantMessage;
    return null;
  },
}));

const POSTS = [
  { id: "post-a", title: "דמי ניהול בפנסיה", excerpt: "", created_date: "2026-01-01" },
  { id: "post-b", title: "ביטוח חיים ומשכנתא", excerpt: "", created_date: "2026-01-02" },
];

const { default: Blog } = await import("@/pages/Blog");

const renderBlog = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Blog />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  resetBase44Mock();
  capturedOnAssistantMessage = undefined;
  base44Mock.entities.BlogPost.filter.mockResolvedValue(POSTS);
  if (!("scrollIntoView" in Element.prototype)) {
    Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), writable: true });
  }
});

describe("the blog page highlights the recommended cards", () => {
  it("applies the highlight styling only to the matching post, after a recommendation arrives", async () => {
    renderBlog();
    await screen.findByText("דמי ניהול בפנסיה");

    capturedOnAssistantMessage!(
      'הנה המלצה.\n\n```recommended\n' + JSON.stringify(["post-a"]) + "\n```",
    );

    await waitFor(() => {
      expect(document.getElementById("post-post-a")?.className).toContain("border-highlight");
    });
    expect(document.getElementById("post-post-b")?.className).not.toContain("border-highlight");
  });

  it("scrolls the first recommended card into view", async () => {
    renderBlog();
    await screen.findByText("דמי ניהול בפנסיה");

    const scrollSpy = vi.fn();
    const target = document.getElementById("post-post-b")!;
    target.scrollIntoView = scrollSpy;

    capturedOnAssistantMessage!(
      'הנה המלצה.\n\n```recommended\n' + JSON.stringify(["post-b", "post-a"]) + "\n```",
    );

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
  });

  it("leaves every card unhighlighted when no recommendation has arrived yet", async () => {
    renderBlog();
    await screen.findByText("דמי ניהול בפנסיה");
    expect(document.getElementById("post-post-a")?.className).not.toContain("border-highlight");
    expect(document.getElementById("post-post-b")?.className).not.toContain("border-highlight");
  });
});
