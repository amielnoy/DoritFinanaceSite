// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

const auth = vi.hoisted(() => ({ value: { user: null, isAuthenticated: false } as { user: Record<string, unknown> | null; isAuthenticated: boolean; isLoadingAuth?: boolean } }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth.value }));

// The switch on, as a build with VITE_MASLEKA_ENABLED=true would have it.
vi.mock("@/config/masleka", () => ({ MASLEKA_ENABLED: true }));

const myRole = vi.hoisted(() => vi.fn<() => Promise<string | null>>());
vi.mock("@/services", () => ({ services: { masleka: { myRole } } }));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = new Proxy({}, {
    get: (_t, tag: string) => ({ children, ...props }: any) => React.createElement(tag, props, children),
  });
  return {
    motion: passthrough,
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

import FloatingHeader from "@/components/dorit/layout/FloatingHeader";

const renderHeader = (value: typeof auth.value) => {
  auth.value = value;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FloatingHeader />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const boardLinks = () => screen.queryAllByRole("link", { name: "בקשות מסלקה" });

describe("<FloatingHeader /> — the clearinghouse board link, switched on", () => {
  it("links the admin to the board without asking for a membership", async () => {
    myRole.mockReset();
    renderHeader({ user: { id: "u1", role: "admin" }, isAuthenticated: true });
    expect(boardLinks().length).toBeGreaterThan(0);
    boardLinks().forEach((l) => expect(l).toHaveAttribute("href", "/admin/masleka"));
    expect(myRole).not.toHaveBeenCalled();
  });

  it("links a member of the agency to the board", async () => {
    myRole.mockReset().mockResolvedValue("staff");
    renderHeader({ user: { id: "u2", role: "user" }, isAuthenticated: true });
    expect((await screen.findAllByRole("link", { name: "בקשות מסלקה" })).length).toBeGreaterThan(0);
    boardLinks().forEach((l) => expect(l).toHaveAttribute("href", "/admin/masleka"));
  });

  it("offers no board link to a signed-in client with no membership, or when the role cannot be read", async () => {
    myRole.mockReset().mockResolvedValue(null);
    const { unmount } = renderHeader({ user: { id: "u3", role: "user" }, isAuthenticated: true });
    await vi.waitFor(() => expect(myRole).toHaveBeenCalledTimes(1));
    expect(boardLinks()).toHaveLength(0);
    unmount();

    myRole.mockReset().mockRejectedValue(new Error("failed"));
    renderHeader({ user: { id: "u4", role: "user" }, isAuthenticated: true });
    await vi.waitFor(() => expect(myRole).toHaveBeenCalledTimes(1));
    expect(boardLinks()).toHaveLength(0);
  });

  it("asks nothing for a signed-out visitor", () => {
    myRole.mockReset();
    renderHeader({ user: null, isAuthenticated: false });
    expect(boardLinks()).toHaveLength(0);
    expect(myRole).not.toHaveBeenCalled();
  });
});
