// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/config/masleka", () => ({ MASLEKA_ENABLED: true }));

import AdminMenu, { type AdminMenuProps } from "@/components/dorit/admin/AdminMenu";

/* "ניהול" in the public header: the admin's and agency staff's way into the admin interface. */

const renderMenu = (props: Partial<AdminMenuProps> = {}) => {
  const onSignOut = vi.fn();
  render(
    <MemoryRouter>
      <AdminMenu
        access="admin"
        counts={{ newLeads: 2, maslekaWaiting: 1, total: 3 }}
        name="דורית גוב ארי"
        roleLabel="מנהל/ת"
        onSignOut={onSignOut}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onSignOut, trigger: screen.getByRole("button", { name: /^ניהול/ }) };
};

const open = (trigger: HTMLElement) => fireEvent.keyDown(trigger, { key: "Enter" });

describe("<AdminMenu />", () => {
  it("says it opens a menu, and whether it is open", () => {
    const { trigger } = renderMenu();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    open(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("shows the initials, and the total waiting in the button's name", () => {
    const { trigger } = renderMenu();
    expect(trigger).toHaveTextContent("דג");
    expect(trigger).toHaveAccessibleName(/ניהול\s*3 פריטים ממתינים/);
  });

  it("lists the admin's name and role, her items with their counters, and a way out", () => {
    const { trigger, onSignOut } = renderMenu();
    open(trigger);
    expect(screen.getByText("דורית גוב ארי")).toBeInTheDocument();
    expect(screen.getByText("מנהל/ת")).toBeInTheDocument();
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "ממשק ניהול",
      "פניות חדשות22 חדשות",
      "בקשות מסלקה11 ממתינות להגשה",
      "יציאה",
    ]);
    expect(screen.getByRole("menuitem", { name: "ממשק ניהול" })).toHaveAttribute("href", "/account");
    expect(screen.getByRole("menuitem", { name: /פניות חדשות/ })).toHaveAttribute("href", "/admin/leads");
    expect(screen.getByRole("menuitem", { name: /בקשות מסלקה/ })).toHaveAttribute("href", "/admin/masleka");
    fireEvent.click(screen.getByRole("menuitem", { name: "יציאה" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("gives agency staff the board alone", () => {
    const { trigger } = renderMenu({ access: "staff", counts: { newLeads: 0, maslekaWaiting: 0, total: 0 }, roleLabel: "צוות מסלקה" });
    open(trigger);
    expect(screen.getByRole("menuitem", { name: "ממשק ניהול" })).toHaveAttribute("href", "/admin/masleka");
    expect(screen.queryByRole("menuitem", { name: /פניות חדשות/ })).toBeNull();
  });

  it("shows no counter at zero", () => {
    const { trigger } = renderMenu({ counts: { newLeads: 0, maslekaWaiting: 0, total: 0 } });
    expect(trigger).toHaveAccessibleName("ניהול");
    open(trigger);
    expect(screen.getByRole("menuitem", { name: "פניות חדשות" })).toBeInTheDocument();
  });

  it("closes on Escape and gives focus back to the button", async () => {
    const { trigger } = renderMenu();
    trigger.focus();
    open(trigger);
    await vi.waitFor(() => expect(screen.getByRole("menu")).toContainElement(document.activeElement as HTMLElement));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });
});
