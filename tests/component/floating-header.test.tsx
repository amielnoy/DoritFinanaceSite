// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { base44Mock } from "./base44-mock";

vi.mock("@/api/base44Client", () => ({ base44: base44Mock }));
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

const auth = vi.hoisted(() => ({ value: { user: null, isAuthenticated: false } as { user: Record<string, unknown> | null; isAuthenticated: boolean; isLoadingAuth?: boolean; logout?: (...a: unknown[]) => void } }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth.value }));

// The admin menu's counter. The clearinghouse switch is off here, so the board is never asked.
const countNew = vi.hoisted(() => vi.fn(async () => 3));
// The operator's counter is the unassigned queue (agency roles); a client's role is none.
const countUnassigned = vi.hoisted(() => vi.fn(async () => 3));
vi.mock("@/services", () => ({
  services: {
    leadsAdmin: { countNew, countUnassigned },
    masleka: { list: vi.fn(async () => []) },
    agency: { myRole: vi.fn(async () => null), myAgencies: vi.fn(async () => []) },
  },
}));

// framer-motion's layout animations need APIs jsdom does not implement.
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
      <MemoryRouter><FloatingHeader /></MemoryRouter>
    </QueryClientProvider>,
  );
};

const linksNamed = (name: string) => screen.queryAllByRole("link", { name });

describe("<FloatingHeader /> account links", () => {
  it("shows no personal-area link to a signed-out visitor", () => {
    renderHeader({ user: null, isAuthenticated: false });
    expect(linksNamed("האזור שלי")).toHaveLength(0);
  });

  it("links a signed-in visitor to /account, with no admin links", () => {
    renderHeader({ user: { email: "a@example.com", role: "user" }, isAuthenticated: true });
    const links = linksNamed("האזור שלי");
    expect(links.length).toBeGreaterThan(0);
    links.forEach((l) => expect(l).toHaveAttribute("href", "/account"));
    expect(linksNamed("ניהול פניות")).toHaveLength(0);
    expect(linksNamed("ניהול בלוג")).toHaveLength(0);
  });

  /**
   * The admin's pages left the site's navigation for a "ניהול" menu beside the
   * call buttons: the public row is the site's, and nothing in it is hers alone.
   */
  it("keeps the admin's pages out of the site's navigation, behind a ניהול menu", async () => {
    renderHeader({ user: { email: "d@example.com", role: "admin" }, isAuthenticated: true });
    expect(await screen.findByRole("button", { name: /^ניהול/ })).toHaveAttribute("aria-haspopup", "menu");
    for (const name of ["ניהול פניות", "ניהול בלוג", "ניהול משתמשים", "האזור שלי"]) expect(linksNamed(name)).toHaveLength(0);
    // Signing out moved into the menu as well.
    expect(screen.queryAllByRole("button", { name: "יציאה" })).toHaveLength(0);
  });

  it("offers a client no ניהול menu", async () => {
    renderHeader({ user: { email: "a@example.com", role: "user" }, isAuthenticated: true });
    await Promise.resolve();
    expect(screen.queryByRole("button", { name: /^ניהול/ })).toBeNull();
    expect(countNew).not.toHaveBeenCalled();
  });

  it("offers no clearinghouse board link, even to an admin, while the switch is off", () => {
    renderHeader({ user: { id: "u1", email: "d@example.com", role: "admin" }, isAuthenticated: true });
    expect(linksNamed("בקשות מסלקה")).toHaveLength(0);
  });

  it("offers no sign-out to a signed-out visitor", () => {
    renderHeader({ user: null, isAuthenticated: false });
    expect(screen.queryAllByRole("button", { name: "יציאה" })).toHaveLength(0);
  });

  it("signs a visitor out and sends them home", () => {
    const logout = vi.fn();
    renderHeader({ user: { email: "a@example.com", role: "user" }, isAuthenticated: true, logout });
    fireEvent.click(screen.getAllByRole("button", { name: "יציאה" })[0]);
    expect(logout).toHaveBeenCalledWith(true, `${window.location.origin}/`);
  });

  /**
   * A way in for a client, from any page.
   *
   * Signed out, the header used to offer nothing: the only route to sign-in was
   * typing an admin address and letting the guard bounce you there.
   */
  it("offers a signed-out visitor \"כניסה ללקוחות\", into their own area", () => {
    renderHeader({ user: null, isAuthenticated: false });
    const links = linksNamed("כניסה ללקוחות");
    expect(links.length).toBeGreaterThan(0);
    links.forEach((l) => expect(l).toHaveAttribute("href", "/login?returnTo=/account"));
  });

  it("does not offer it to a signed-in visitor", () => {
    renderHeader({ user: { email: "a@example.com", role: "user" }, isAuthenticated: true });
    expect(linksNamed("כניסה ללקוחות")).toHaveLength(0);
  });

  it("does not flash it while the auth check is still answering", () => {
    renderHeader({ user: null, isAuthenticated: false, isLoadingAuth: true });
    expect(linksNamed("כניסה ללקוחות")).toHaveLength(0);
  });
});

describe("<FloatingHeader /> phone menu", () => {
  it("gives the admin one row into the admin interface, with what is waiting", async () => {
    renderHeader({ user: { email: "d@example.com", role: "admin" }, isAuthenticated: true });
    fireEvent.click(screen.getByRole("button", { name: "תפריט" }));
    const row = await screen.findByRole("link", { name: /ממשק ניהול\s*3 פריטים ממתינים/ });
    expect(row).toHaveAttribute("href", "/account");
    expect(within(row.parentElement!).queryByRole("link", { name: "ניהול פניות" })).toBeNull();
  });

  it("lists the support chat as well as the sticky bar's תמיכה", () => {
    renderHeader({ user: null, isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "תפריט" }));
    const support = screen.getByRole("link", { name: /תמיכה — שאלה לעוזר/ });
    expect(support).toHaveAttribute("href", "/faq#support-chat");
    // Pressing it closes the menu as well as going to the chat.
    fireEvent.click(support);
    expect(screen.queryByRole("button", { name: "סגירת תפריט" })).toBeNull();
  });

  it("tags its support link header_menu, so click_chat says the menu sent the visitor", () => {
    renderHeader({ user: null, isAuthenticated: false });
    fireEvent.click(screen.getByRole("button", { name: "תפריט" }));
    const support = screen.getByRole("link", { name: /תמיכה — שאלה לעוזר/ });
    expect(support.closest("[data-track-location]")).toHaveAttribute("data-track-location", "header_menu");
  });
});
