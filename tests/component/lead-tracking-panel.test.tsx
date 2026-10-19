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

/** The panel starts folded; open it the way an admin does. */
async function renderOpen() {
  const user = userEvent.setup();
  render(<LeadTrackingPanel />);
  await user.click(screen.getByRole("button", { name: /מעקב לידים ב-Google Analytics/ }));
  return user;
}

describe("<LeadTrackingPanel />", () => {
  it("starts folded, showing only its heading", () => {
    render(<LeadTrackingPanel />);
    const toggle = screen.getByRole("button", { name: /מעקב לידים ב-Google Analytics/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("link", { name: /פתיחת הדוחות/ })).toBeNull();
  });

  it("opens on a click, and folds again on a second", async () => {
    const user = await renderOpen();
    const toggle = screen.getByRole("button", { name: /מעקב לידים ב-Google Analytics/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("table")).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists every event the site sends", async () => {
    await renderOpen();
    for (const e of LEAD_EVENTS) expect(screen.getByText(e.name)).toBeInTheDocument();
  });

  it("says when the tag is blocked in this browser", async () => {
    await renderOpen();
    expect(screen.getByText(/כנראה חוסם פרסומות/)).toBeInTheDocument();
  });

  it("says when the tag is running", async () => {
    (window as any).gtag = () => {};
    await renderOpen();
    expect(screen.getByText(/אירועים נשלחים/)).toBeInTheDocument();
  });

  it("marks this browser as internal, and unmarks it", async () => {
    const user = await renderOpen();
    expect(screen.getByText("נספר כמבקר רגיל")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "סמנו כגלישה פנימית" }));
    expect(screen.getByText("מסומן כגלישה פנימית")).toBeInTheDocument();
    expect(window.localStorage.getItem("ga_internal_user")).toBe("1");

    await user.click(screen.getByRole("button", { name: "ביטול הסימון" }));
    expect(screen.getByText("נספר כמבקר רגיל")).toBeInTheDocument();
    expect(window.localStorage.getItem("ga_internal_user")).toBeNull();
  });

  it("links to the GA4 reports in a new tab", async () => {
    await renderOpen();
    const link = screen.getByRole("link", { name: /פתיחת הדוחות/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("analytics.google.com"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});
