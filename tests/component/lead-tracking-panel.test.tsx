// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import LeadTrackingPanel from "@/components/dorit/admin/LeadTrackingPanel";
import { LEAD_EVENTS } from "@/lib/analytics";

/**
 * The admin's view of GA4 lead tracking: which events exist, which to mark as
 * Key Events, and whether this browser is counted.
 */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
});
afterEach(() => {
  delete (window as any).gtag;
});

describe("<LeadTrackingPanel />", () => {
  it("lists every event the site sends", () => {
    render(<LeadTrackingPanel />);
    for (const e of LEAD_EVENTS) expect(screen.getByText(e.name)).toBeInTheDocument();
  });

  it("says when the tag is blocked in this browser", () => {
    render(<LeadTrackingPanel />);
    expect(screen.getByText(/כנראה חוסם פרסומות/)).toBeInTheDocument();
  });

  it("says when the tag is running", () => {
    (window as any).gtag = () => {};
    render(<LeadTrackingPanel />);
    expect(screen.getByText(/אירועים נשלחים/)).toBeInTheDocument();
  });

  it("marks this browser as internal, and unmarks it", async () => {
    const user = userEvent.setup();
    render(<LeadTrackingPanel />);
    expect(screen.getByText("נספר כמבקר רגיל")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "סמנו כגלישה פנימית" }));
    expect(screen.getByText("מסומן כגלישה פנימית")).toBeInTheDocument();
    expect(window.localStorage.getItem("ga_internal_user")).toBe("1");

    await user.click(screen.getByRole("button", { name: "ביטול הסימון" }));
    expect(screen.getByText("נספר כמבקר רגיל")).toBeInTheDocument();
    expect(window.localStorage.getItem("ga_internal_user")).toBeNull();
  });

  it("links to the GA4 reports in a new tab", () => {
    render(<LeadTrackingPanel />);
    const link = screen.getByRole("link", { name: /פתיחת הדוחות/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("analytics.google.com"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});
