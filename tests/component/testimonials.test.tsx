/**
 * @vitest-environment jsdom
 *
 * The home page's testimonials section exists only when there is something to
 * show: nothing while loading, nothing when empty, and no placeholder.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { base44Mock, resetBase44Mock } from "./base44-mock";

vi.mock("@/api/base44Client", () => ({ base44: base44Mock }));
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

// framer-motion's layout animations need APIs jsdom does not implement.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = new Proxy(
    {},
    { get: (_t, tag: string) => ({ children, ...props }: any) => React.createElement(tag, props, children) }
  );
  return {
    motion: passthrough,
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

const auth = vi.hoisted(() => ({ isAuthenticated: false }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth }));

import Testimonials from "@/components/dorit/sections/Testimonials";

const render_ = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Testimonials />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

beforeEach(() => {
  resetBase44Mock();
  auth.isAuthenticated = false;
});

describe("<Testimonials />", () => {
  it("renders nothing while loading and nothing when there are no testimonials", async () => {
    base44Mock.entities.Testimonial.list.mockResolvedValueOnce([]);
    const { container } = render_();
    expect(container.querySelector("#testimonials")).toBeNull();
    await waitFor(() => expect(base44Mock.entities.Testimonial.list).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("#testimonials")).toBeNull();
    expect(screen.queryByRole("heading", { name: "לקוחות מספרים" })).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders the section and its heading when there are testimonials", async () => {
    base44Mock.entities.Testimonial.list.mockResolvedValueOnce([
      { id: "t1", name: "רונית לוי", quote: "ליווי מקצועי", rating: 5, source: "google" },
    ]);
    const { container } = render_();
    expect(await screen.findByRole("heading", { name: "לקוחות מספרים" })).toBeTruthy();
    expect(container.querySelector("section#testimonials")).not.toBeNull();
    expect(screen.getByText("ליווי מקצועי")).toBeTruthy();
  });

  it("keeps the section for the signed-in owner when empty, so the first one can be added", async () => {
    auth.isAuthenticated = true;
    base44Mock.entities.Testimonial.list.mockResolvedValueOnce([]);
    render_();
    expect(await screen.findByRole("button", { name: /הוספת המלצה/ })).toBeTruthy();
  });
});
