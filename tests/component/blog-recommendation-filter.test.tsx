/**
 * @vitest-environment jsdom
 *
 * The blog page's own responsibility in the reading-recommender feature:
 * given recommended post ids, narrow the grid to those posts, offer a way
 * back to the full list, and scroll the result into view. AgentChat's
 * plumbing (stripping the block, calling onAssistantMessage) is covered
 * separately in blog-recommendation-chat.test.tsx — here AgentChat is stubbed
 * so this test is about Blog.tsx's own reaction.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  { id: "post-c", title: "ליווי תביעות", excerpt: "", created_date: "2026-01-03" },
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

const recommend = (ids: string[]) =>
  act(() => {
    capturedOnAssistantMessage!("הנה המלצה.\n\n```recommended\n" + JSON.stringify(ids) + "\n```");
  });

const card = (id: string) => document.getElementById(`post-${id}`);
const shownIds = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[id^="post-post-"]')).map((el) => el.id.slice(5));

beforeEach(() => {
  resetBase44Mock();
  capturedOnAssistantMessage = undefined;
  base44Mock.entities.BlogPost.filter.mockResolvedValue(POSTS);
  if (!("scrollIntoView" in Element.prototype)) {
    Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), writable: true });
  }
});

describe("the blog page shows only the recommended posts", () => {
  it("shows every post when no recommendation has arrived yet", async () => {
    renderBlog();
    await screen.findByText("דמי ניהול בפנסיה");
    expect(shownIds()).toEqual(["post-a", "post-b", "post-c"]);
    expect(screen.queryByText("הצגת כל המאמרים")).toBeNull();
  });

  it("hides every post the chat did not recommend", async () => {
    renderBlog();
    await screen.findByText("דמי ניהול בפנסיה");

    await recommend(["post-a"]);

    await waitFor(() => expect(card("post-b")).toBeNull());
    expect(card("post-a")).not.toBeNull();
    expect(card("post-c")).toBeNull();
    expect(screen.getByText("מוצג מאמר אחד שהומלץ בצ'אט")).toBeTruthy();
  });

  it("orders the posts the way the chat ranked them", async () => {
    renderBlog();
    await screen.findByText("דמי ניהול בפנסיה");

    await recommend(["post-c", "post-a"]);

    await waitFor(() => expect(shownIds()).toEqual(["post-c", "post-a"]));
    expect(screen.getByText("מוצגים 2 מאמרים שהומלצו בצ'אט")).toBeTruthy();
  });

  it("brings every post back from the show-all button", async () => {
    renderBlog();
    await screen.findByText("דמי ניהול בפנסיה");
    await recommend(["post-a"]);
    await waitFor(() => expect(card("post-b")).toBeNull());

    fireEvent.click(screen.getByText("הצגת כל המאמרים"));

    expect(shownIds()).toEqual(["post-a", "post-b", "post-c"]);
    expect(screen.queryByText("הצגת כל המאמרים")).toBeNull();
  });

  it("keeps every post when none of the recommended ids exists, rather than an empty page", async () => {
    renderBlog();
    await screen.findByText("דמי ניהול בפנסיה");

    await recommend(["no-such-post"]);

    expect(shownIds()).toEqual(["post-a", "post-b", "post-c"]);
    expect(screen.queryByText("הצגת כל המאמרים")).toBeNull();
  });

  it("drops the recommendation filter once the visitor searches", async () => {
    renderBlog();
    await screen.findByText("דמי ניהול בפנסיה");
    await recommend(["post-a"]);
    await waitFor(() => expect(card("post-b")).toBeNull());

    fireEvent.change(screen.getByPlaceholderText("חיפוש מאמרים…"), { target: { value: "ביטוח" } });

    expect(shownIds()).toEqual(["post-b"]);
  });

  it("clears an earlier search so the recommendation is not narrowed to nothing", async () => {
    renderBlog();
    await screen.findByText("דמי ניהול בפנסיה");
    const search = screen.getByPlaceholderText("חיפוש מאמרים…") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "ביטוח" } });
    expect(shownIds()).toEqual(["post-b"]);

    await recommend(["post-a"]);

    await waitFor(() => expect(shownIds()).toEqual(["post-a"]));
    expect(search.value).toBe("");
  });

  it("scrolls the recommendation into view", async () => {
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");
    renderBlog();
    await screen.findByText("דמי ניהול בפנסיה");
    scrollSpy.mockClear();

    await recommend(["post-b"]);

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    scrollSpy.mockRestore();
  });
});
