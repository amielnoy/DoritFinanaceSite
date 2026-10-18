/**
 * @vitest-environment jsdom
 *
 * An article reached by an old-form address — a Base44 id from a bookmark, a
 * search result or an agent's answer — takes its slug address once it loads,
 * keeping whatever the visitor's link carried after it. The server answers
 * the same address with a 301 (api/og/blog.ts); this is the half that covers
 * a visit that reaches the page another way, such as in-app navigation.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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

const { default: BlogPost } = await import("@/pages/BlogPost");

const B44 = "64f0a1b2c3d4e5f6a7b8c9d0";
const ARTICLE: Article = {
  id: B44,
  slug: "horadat-dmei-nihul",
  title: "להוריד דמי ניהול בפנסיה",
  body: "גוף המאמר.",
  published: true,
  created_date: "2026-10-01T09:00:00Z",
};

function Where() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="where">{`${pathname}${search}${hash}`}</output>;
}

const renderAt = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/blog/:key"
            element={
              <>
                <BlogPost />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const where = () => screen.getByTestId("where").textContent;

beforeEach(() => resetServicesMock());

describe("an article reached by an old-form address", () => {
  it("takes its slug address, keeping the query and the hash", async () => {
    servicesMock.content.getArticle.mockResolvedValue(ARTICLE);
    renderAt(`/blog/${B44}?utm_source=whatsapp#mah-bodkim`);
    await screen.findByRole("heading", { level: 1, name: ARTICLE.title });
    await waitFor(() => expect(where()).toBe("/blog/horadat-dmei-nihul?utm_source=whatsapp#mah-bodkim"));
    // Put under its new key before the switch, so the slug address costs no second read.
    expect(servicesMock.content.getArticle).toHaveBeenCalledTimes(1);
  });

  it("stays where it is when the address already is the slug", async () => {
    servicesMock.content.getArticle.mockResolvedValue(ARTICLE);
    renderAt("/blog/horadat-dmei-nihul");
    await screen.findByRole("heading", { level: 1, name: ARTICLE.title });
    expect(where()).toBe("/blog/horadat-dmei-nihul");
  });

  it("stays on the id where the store has no slug (a build reading Base44)", async () => {
    servicesMock.content.getArticle.mockResolvedValue({ ...ARTICLE, slug: undefined });
    renderAt(`/blog/${B44}`);
    await screen.findByRole("heading", { level: 1, name: ARTICLE.title });
    expect(where()).toBe(`/blog/${B44}`);
  });
});
