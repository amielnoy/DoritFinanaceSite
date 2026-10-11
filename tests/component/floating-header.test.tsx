// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { base44Mock } from "./base44-mock";

vi.mock("@/api/base44Client", () => ({ base44: base44Mock }));
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

const auth = vi.hoisted(() => ({ value: { user: null, isAuthenticated: false } as { user: Record<string, unknown> | null; isAuthenticated: boolean; authChecked?: boolean; logout?: (...a: unknown[]) => void; navigateToLogin?: () => void } }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth.value }));

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
  return render(<MemoryRouter><FloatingHeader /></MemoryRouter>);
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

  it("gives an admin both admin pages", () => {
    renderHeader({ user: { email: "d@example.com", role: "admin" }, isAuthenticated: true });
    linksNamed("ניהול פניות").forEach((l) => expect(l).toHaveAttribute("href", "/admin/leads"));
    linksNamed("ניהול בלוג").forEach((l) => expect(l).toHaveAttribute("href", "/admin/blog"));
    expect(linksNamed("ניהול פניות").length).toBeGreaterThan(0);
    expect(linksNamed("ניהול בלוג").length).toBeGreaterThan(0);
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
   * A way in that does not need the address of an admin page.
   *
   * Signed out, the menu offered nothing: the only route to sign-in was typing
   * /admin/leads and letting the guard bounce you to it. "כניסה" now starts
   * the same flow from wherever you are, and comes back there.
   */
  it("offers a signed-out visitor a way to sign in, and starts it", () => {
    const navigateToLogin = vi.fn();
    renderHeader({ user: null, isAuthenticated: false, authChecked: true, navigateToLogin });
    const signIn = screen.getAllByRole("button", { name: "כניסה" });
    fireEvent.click(signIn[0]);
    expect(navigateToLogin).toHaveBeenCalledTimes(1);
  });

  it("offers no sign-in to someone already signed in", () => {
    renderHeader({ user: { email: "a@example.com", role: "user" }, isAuthenticated: true, authChecked: true });
    expect(screen.queryAllByRole("button", { name: "כניסה" })).toHaveLength(0);
  });

  it("does not flash a sign-in button while the auth check is still running", () => {
    renderHeader({ user: null, isAuthenticated: false, authChecked: false });
    expect(screen.queryAllByRole("button", { name: "כניסה" })).toHaveLength(0);
  });
});
