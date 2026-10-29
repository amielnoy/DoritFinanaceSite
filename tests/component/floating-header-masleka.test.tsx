// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { describe, expect, it, vi } from "vitest";


const auth = vi.hoisted(() => ({ value: { user: null, isAuthenticated: false } as { user: Record<string, unknown> | null; isAuthenticated: boolean; isLoadingAuth?: boolean } }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth.value }));

// The switch on, as a build with VITE_MASLEKA_ENABLED=true would have it.
vi.mock("@/config/masleka", () => ({ MASLEKA_ENABLED: true }));

const myRole = vi.hoisted(() => vi.fn<(agencyId: string) => Promise<string | null>>());
const myAgencies = vi.hoisted(() => vi.fn(async () => [] as { id: string; name: string; role: string }[]));
const list = vi.hoisted(() => vi.fn(async () => [] as { status: string }[]));
const countNew = vi.hoisted(() => vi.fn(async () => 0));
const countUnassigned = vi.hoisted(() => vi.fn(async () => 0));
vi.mock("@/services", () => ({
  services: { masleka: { list }, leadsAdmin: { countNew, countUnassigned }, agency: { myRole, myAgencies } },
}));

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

/** The phone menu's row into the admin interface — the same choice as the desktop "ניהול" menu. */
const openDrawer = () => fireEvent.click(screen.getByRole("button", { name: "תפריט" }));
const adminRows = () => screen.queryAllByRole("link", { name: /ממשק ניהול/ });

describe("<FloatingHeader /> — the admin menu with the clearinghouse switched on", () => {
  it("takes the platform operator to their main page, with no membership needed", async () => {
    myRole.mockReset().mockResolvedValue(null);
    renderHeader({ user: { id: "u1", role: "admin" }, isAuthenticated: true });
    openDrawer();
    expect(await screen.findByRole("link", { name: /ממשק ניהול/ })).toHaveAttribute("href", "/account");
  });

  it("gives a member of the agency a ניהול menu that leads to their leads (agency roles)", async () => {
    myAgencies.mockResolvedValue([{ id: "00000000-0000-0000-0000-000000000001", name: "דורית", role: "user" }]);
    myRole.mockReset().mockResolvedValue("user");
    countUnassigned.mockClear();
    renderHeader({ user: { id: "u2", role: "user" }, isAuthenticated: true });
    expect(await screen.findByRole("button", { name: /^ניהול/ })).toBeInTheDocument();
    openDrawer();
    expect(await screen.findByRole("link", { name: /ממשק ניהול/ })).toHaveAttribute("href", "/admin/leads");
    // A User assigns nothing, so the queue is never counted for them.
    expect(countUnassigned).not.toHaveBeenCalled();
  });

  it("offers no ניהול menu to a signed-in client with no membership, or when the role cannot be read", async () => {
    myRole.mockReset().mockResolvedValue(null);
    const { unmount } = renderHeader({ user: { id: "u3", role: "user" }, isAuthenticated: true });
    await vi.waitFor(() => expect(myRole).toHaveBeenCalledTimes(1));
    openDrawer();
    expect(adminRows()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^ניהול/ })).toBeNull();
    unmount();

    myRole.mockReset().mockRejectedValue(new Error("failed"));
    renderHeader({ user: { id: "u4", role: "user" }, isAuthenticated: true });
    await vi.waitFor(() => expect(myRole).toHaveBeenCalledTimes(1));
    openDrawer();
    expect(adminRows()).toHaveLength(0);
  });

  it("asks nothing for a signed-out visitor", () => {
    myRole.mockReset();
    renderHeader({ user: null, isAuthenticated: false });
    openDrawer();
    expect(adminRows()).toHaveLength(0);
    expect(myRole).not.toHaveBeenCalled();
  });

  it("counts the unassigned leads and the requests waiting to be submitted together", async () => {
    myRole.mockReset().mockResolvedValue(null);
    countUnassigned.mockResolvedValue(1);
    list.mockResolvedValue([{ status: "code_received" }, { status: "invited" }, { status: "code_received" }]);
    renderHeader({ user: { id: "u1", role: "admin" }, isAuthenticated: true });
    openDrawer();
    expect(await screen.findByRole("link", { name: /ממשק ניהול\s*3 פריטים ממתינים/ })).toBeInTheDocument();
  });
});
