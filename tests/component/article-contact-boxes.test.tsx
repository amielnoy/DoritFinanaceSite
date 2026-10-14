/**
 * @vitest-environment jsdom
 *
 * The contact boxes inside an article: one after the third paragraph when more
 * follows, one at the end; WhatsApp pre-filled with the title; the topic's offer only on
 * an article a tool there covers.
 */
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { base44Mock } from "./base44-mock";

if (typeof (globalThis as any).ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock("@/api/base44Client", () => ({ base44: base44Mock }));
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ isAuthenticated: false, user: null }) }));
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

const { default: BlogPost } = await import("@/pages/BlogPost");
const { ARTICLE_CTA_FALLBACK } = await import("@/lib/articleCta");

const ARTICLE = {
  id: "64f0a1b2c3d4e5f6a7b8c9d0",
  slug: "horadat-dmei-nihul",
  title: "להוריד דמי ניהול בפנסיה",
  body: ["פסקה ראשונה.", "פסקה שנייה.", "פסקה שלישית.", "פסקה רביעית."].join("\n\n"),
  tags: "פנסיה, דמי ניהול",
  published: true,
  created_date: "2026-10-01T09:00:00Z",
};

const renderArticle = async (over: Record<string, unknown> = {}) => {
  base44Mock.entities.BlogPost.get.mockResolvedValue({ ...ARTICLE, ...over });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/blog/horadat-dmei-nihul"]}>
        <Routes>
          <Route path="/blog/:key" element={<BlogPost />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { level: 1 });
};

beforeEach(() => {
  base44Mock.entities.BlogPost.get.mockReset();
  base44Mock.entities.BlogPost.filter?.mockReset?.();
});

describe("ArticleContactBox in an article", () => {
  it("puts one box after the third paragraph and one at the end, each tracked at its place", async () => {
    await renderArticle();
    const inline = screen.getByTestId("article_inline");
    const end = screen.getByTestId("article_end");
    expect(inline).toHaveAttribute("data-track-location", "article_inline");
    expect(end).toHaveAttribute("data-track-location", "article_end");
    // after the third paragraph, before the fourth
    const third = screen.getByText("פסקה שלישית.");
    const fourth = screen.getByText("פסקה רביעית.");
    expect(third.compareDocumentPosition(inline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(inline.compareDocumentPosition(fourth) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows only the box at the end when nothing follows the third paragraph", async () => {
    await renderArticle({ body: "פסקה אחת.\n\nפסקה שתיים." });
    expect(screen.queryByTestId("article_inline")).toBeNull();
    expect(screen.getByTestId("article_end")).toBeInTheDocument();
  });

  it("pre-fills WhatsApp with the article's title", async () => {
    await renderArticle();
    const link = within(screen.getByTestId("article_end")).getByRole("link", { name: /וואטסאפ/ });
    const text = new URL(link.getAttribute("href")!).searchParams.get("text");
    expect(text).toBe('שלום דורית, קראתי את המאמר "להוריד דמי ניהול בפנסיה" ואשמח לשאלה קצרה');
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("uses the article's cta_headline, else the general line", async () => {
    await renderArticle({ cta_headline: "רוצים לדעת כמה דמי ניהול אתם משלמים בפועל?" });
    expect(within(screen.getByTestId("article_end")).getByText("רוצים לדעת כמה דמי ניהול אתם משלמים בפועל?")).toBeInTheDocument();
  });

  it("falls back to the general headline", async () => {
    await renderArticle();
    expect(within(screen.getByTestId("article_end")).getByText(ARTICLE_CTA_FALLBACK)).toBeInTheDocument();
  });

  it("offers the clearinghouse check on a pension or fees article", async () => {
    await renderArticle();
    expect(within(screen.getByTestId("article_end")).getByRole("link", { name: /נבדוק לך במסלקה/ })).toHaveAttribute("href", "/pension-check");
  });

  it("offers the year-end page to the self-employed", async () => {
    await renderArticle({ tags: "מיסוי, עצמאים, פנסיה" });
    expect(within(screen.getByTestId("article_end")).getByRole("link", { name: /מה להפקיד עד 31.12/ })).toHaveAttribute("href", "/atzmaim-31-12");
  });

  it("offers nothing but WhatsApp on an article no offer covers", async () => {
    await renderArticle({ tags: "מיסוי, החזר מס" });
    const box = within(screen.getByTestId("article_end"));
    expect(box.getAllByRole("link")).toHaveLength(1);
  });
});
