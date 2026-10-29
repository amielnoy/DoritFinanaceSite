/**
 * @vitest-environment jsdom
 *
 * The blog page's own responsibility in the reading-recommender feature:
 * given recommended post slugs, narrow the grid to those posts, offer a way
 * back to the full list, and scroll the result into view. AgentChat's
 * plumbing (stripping the block, calling onAssistantMessage) is covered
 * separately in blog-recommendation-chat.test.tsx — here AgentChat is stubbed
 * so this test is about Blog.tsx's own reaction.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "@/services";
import { resetServicesMock, servicesMock } from "./services-mock";

if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock("@/services", async (importOriginal) => (await import("./services-mock")).servicesModule(importOriginal));

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

const POSTS: Article[] = [
  { id: "post-a", slug: "dmei-nihul", title: "דמי ניהול בפנסיה", excerpt: "", tags: "פנסיה", created_date: "2026-01-01" },
  { id: "post-b", slug: "bituach-chaim", title: "ביטוח חיים ומשכנתא", excerpt: "", tags: "ביטוח", created_date: "2026-01-02" },
  { id: "post-c", slug: "livui-tviot", title: "ליווי תביעות", excerpt: "", tags: "תביעות", created_date: "2026-01-03" },
];

const keyword = (name: string) =>
  within(screen.getByRole("group", { name: "סינון לפי מילת מפתח" })).getByRole("button", { name });

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

/** The chat lives in a dialog the recommender box opens. A visitor reads the
 *  answer there, then closes it to see the narrowed grid — which the open
 *  modal hides from assistive tech, as it should. */
const recommend = async (ids: string[]) => {
  if (!capturedOnAssistantMessage) fireEvent.click(screen.getByRole("button", { name: "המליצו לי" }));
  await act(() => {
    capturedOnAssistantMessage!("הנה המלצה.\n\n```recommended\n" + JSON.stringify(ids) + "\n```");
  });
  const close = screen.queryByRole("button", { name: "סגירה" });
  if (close) fireEvent.click(close);
};

const BACK_TO_ALL = "חזרה לכל המאמרים";

const card = (id: string) => document.getElementById(`post-${id}`);
const shownIds = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[id^="post-post-"]')).map((el) => el.id.slice(5));

beforeEach(() => {
  resetServicesMock();
  capturedOnAssistantMessage = undefined;
  servicesMock.content.listArticles.mockResolvedValue(POSTS);
  if (!("scrollIntoView" in Element.prototype)) {
    Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), writable: true });
  }
});

describe("the blog page shows only the recommended posts", () => {
  it("shows every post when no recommendation has arrived yet", async () => {
    renderBlog();
    // 5 s, not the 1 s default: under a loaded full run the first render has missed 1 s (M5).
    await screen.findByText("דמי ניהול בפנסיה", {}, { timeout: 5000 });
    expect(shownIds()).toEqual(["post-a", "post-b", "post-c"]);
    expect(screen.queryByText(BACK_TO_ALL)).toBeNull();
  });

  it("hides every post the chat did not recommend", async () => {
    renderBlog();
    // 5 s, not the 1 s default: under a loaded full run the first render has missed 1 s (M5).
    await screen.findByText("דמי ניהול בפנסיה", {}, { timeout: 5000 });

    await recommend(["dmei-nihul"]);

    await waitFor(() => expect(card("post-b")).toBeNull());
    expect(card("post-a")).not.toBeNull();
    expect(card("post-c")).toBeNull();
    expect(screen.getByRole("heading", { name: /מאמרים שהומלצו בצ'אט\s*מאמר אחד/ })).toBeTruthy();
  });

  it("finds a post the chat function named by its slug", async () => {
    renderBlog();
    await screen.findByText("דמי ניהול בפנסיה", {}, { timeout: 5000 });

    await recommend(["livui-tviot"]);

    await waitFor(() => expect(card("post-a")).toBeNull());
    expect(card("post-c")).not.toBeNull();
  });

  it("a recommended id that is not a slug matches nothing", async () => {
    renderBlog();
    await screen.findByText("דמי ניהול בפנסיה", {}, { timeout: 5000 });

    await recommend(["post-c"]);

    expect(shownIds()).toEqual(["post-a", "post-b", "post-c"]);
    expect(screen.queryByText(BACK_TO_ALL)).toBeNull();
  });

  it("orders the posts the way the chat ranked them", async () => {
    renderBlog();
    // 5 s, not the 1 s default: under a loaded full run the first render has missed 1 s (M5).
    await screen.findByText("דמי ניהול בפנסיה", {}, { timeout: 5000 });

    await recommend(["livui-tviot", "dmei-nihul"]);

    await waitFor(() => expect(shownIds()).toEqual(["post-c", "post-a"]));
    expect(screen.getByRole("heading", { name: /מאמרים שהומלצו בצ'אט\s*2 מאמרים/ })).toBeTruthy();
  });

  it("brings every post back from the show-all button", async () => {
    renderBlog();
    // 5 s, not the 1 s default: under a loaded full run the first render has missed 1 s (M5).
    await screen.findByText("דמי ניהול בפנסיה", {}, { timeout: 5000 });
    await recommend(["dmei-nihul"]);
    await waitFor(() => expect(card("post-b")).toBeNull());

    fireEvent.click(screen.getByText(BACK_TO_ALL));

    expect(shownIds()).toEqual(["post-a", "post-b", "post-c"]);
    expect(screen.queryByText(BACK_TO_ALL)).toBeNull();
  });

  it("keeps every post when none of the recommended ids exists, rather than an empty page", async () => {
    renderBlog();
    // 5 s, not the 1 s default: under a loaded full run the first render has missed 1 s (M5).
    await screen.findByText("דמי ניהול בפנסיה", {}, { timeout: 5000 });

    await recommend(["no-such-post"]);

    expect(shownIds()).toEqual(["post-a", "post-b", "post-c"]);
    expect(screen.queryByText(BACK_TO_ALL)).toBeNull();
  });

  it("clears a chosen keyword when a recommendation arrives", async () => {
    renderBlog();
    // 5 s, not the 1 s default: under a loaded full run the first render has missed 1 s (M5).
    await screen.findByText("דמי ניהול בפנסיה", {}, { timeout: 5000 });
    fireEvent.click(keyword("תביעות"));
    expect(shownIds()).toEqual(["post-c"]);

    await recommend(["dmei-nihul"]);

    await waitFor(() => expect(shownIds()).toEqual(["post-a"]));
    expect(keyword("תביעות").getAttribute("aria-pressed")).toBe("false");
  });

  it("drops the recommendation filter once the visitor picks a keyword", async () => {
    renderBlog();
    // 5 s, not the 1 s default: under a loaded full run the first render has missed 1 s (M5).
    await screen.findByText("דמי ניהול בפנסיה", {}, { timeout: 5000 });
    await recommend(["dmei-nihul"]);
    await waitFor(() => expect(card("post-b")).toBeNull());

    fireEvent.click(keyword("ביטוח"));

    expect(shownIds()).toEqual(["post-b"]);
  });

  it("drops the recommendation filter once the visitor searches", async () => {
    renderBlog();
    // 5 s, not the 1 s default: under a loaded full run the first render has missed 1 s (M5).
    await screen.findByText("דמי ניהול בפנסיה", {}, { timeout: 5000 });
    await recommend(["dmei-nihul"]);
    await waitFor(() => expect(card("post-b")).toBeNull());

    fireEvent.change(screen.getByPlaceholderText("חיפוש מאמרים…"), { target: { value: "ביטוח" } });

    expect(shownIds()).toEqual(["post-b"]);
  });

  it("clears an earlier search so the recommendation is not narrowed to nothing", async () => {
    renderBlog();
    // 5 s, not the 1 s default: under a loaded full run the first render has missed 1 s (M5).
    await screen.findByText("דמי ניהול בפנסיה", {}, { timeout: 5000 });
    const search = screen.getByPlaceholderText("חיפוש מאמרים…") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "ביטוח" } });
    expect(shownIds()).toEqual(["post-b"]);

    await recommend(["dmei-nihul"]);

    await waitFor(() => expect(shownIds()).toEqual(["post-a"]));
    expect(search.value).toBe("");
  });

  it("scrolls the recommendation into view", async () => {
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");
    renderBlog();
    // 5 s, not the 1 s default: under a loaded full run the first render has missed 1 s (M5).
    await screen.findByText("דמי ניהול בפנסיה", {}, { timeout: 5000 });
    scrollSpy.mockClear();

    await recommend(["bituach-chaim"]);

    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    scrollSpy.mockRestore();
  });
});
