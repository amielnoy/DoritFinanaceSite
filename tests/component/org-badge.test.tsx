// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import OrgBadge, { badgeSpec } from "@/components/dorit/org/OrgBadge";
import OrgChip from "@/components/dorit/org/OrgChip";
import OrgChips from "@/components/dorit/org/OrgChips";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { orgFor } from "@/config/organizations";

const alpha = orgFor("alpha");

describe("OrgBadge, OrgChip(s) and the avatar with an organization", () => {
  it.each([
    [64, 26, true],
    [44, 20, true],
    [40, 20, true],
    [32, 12, false],
    [24, 12, false],
  ])("on a %ipx avatar: a %ipx badge, code shown: %s", (avatar, size, code) => {
    expect(badgeSpec(avatar)).toMatchObject({ size, code });
    render(<div className="relative"><OrgBadge org={alpha} avatarSize={avatar} /></div>);
    const badge = screen.getByRole("img", { name: "ארגון: סוכנות אלפא" });
    expect(badge.style.width).toBe(`${size}px`);
    expect(badge.style.background).toBe("rgb(31, 78, 140)");
    expect(badge.textContent).toBe(code ? "סא" : "");
  });

  it("writes the code at 9–10px on a 40–44px avatar's badge", () => {
    expect(badgeSpec(44).font).toBeGreaterThanOrEqual(9);
    expect(badgeSpec(44).font).toBeLessThanOrEqual(10);
  });

  it("shows the organization's logo instead of its code when it has one", () => {
    render(<OrgBadge org={{ ...alpha, logoUrl: "https://example.com/logo.png" }} avatarSize={64} />);
    const badge = screen.getByRole("img", { name: "ארגון: סוכנות אלפא" });
    expect(badge.querySelector("img")).toHaveAttribute("src", "https://example.com/logo.png");
    expect(badge.textContent).toBe("");
  });

  it("sits at the inline-end bottom corner, with a white rim", () => {
    render(<OrgBadge org={alpha} avatarSize={64} />);
    const badge = screen.getByRole("img", { name: "ארגון: סוכנות אלפא" });
    expect(badge.style.insetInlineEnd).toBe("-3px");
    expect(badge.style.bottom).toBe("-3px");
    expect(badge.style.borderWidth).toBe("3px");
    expect(badge.className).toContain("border-white");
  });

  it("opens its tooltip on keyboard focus, and on a tap", async () => {
    render(<OrgBadge org={alpha} avatarSize={44} />);
    const badge = screen.getByRole("img", { name: "ארגון: סוכנות אלפא" });
    expect(badge).toHaveAttribute("tabindex", "0");
    act(() => badge.focus());
    expect((await screen.findAllByText("ארגון: סוכנות אלפא")).length).toBeGreaterThan(0);
    act(() => badge.blur());
    fireEvent.pointerDown(badge, { pointerType: "touch" });
    fireEvent.click(badge);
    expect((await screen.findAllByText("ארגון: סוכנות אלפא")).length).toBeGreaterThan(0);
  });

  it("writes the name on the chip, in the ink on the tint, with the colour's square first", () => {
    const { container } = render(<OrgChip org={orgFor("beta")} />);
    const chip = container.querySelector('[data-org="beta"]') as HTMLElement;
    expect(chip).toHaveTextContent("משרד בטא");
    expect(chip.style.background).toBe("rgb(252, 235, 221)");
    expect(chip.style.color).toBe("rgb(138, 47, 6)");
    expect((chip.firstElementChild as HTMLElement).style.background).toBe("rgb(180, 64, 11)");
  });

  it("shows two chips, then +N that lists the rest", async () => {
    const orgs = ["alpha", "beta", "gamma", "delta"].map((id) => orgFor(id));
    const { container } = render(<OrgChips orgs={orgs} />);
    expect(container.querySelectorAll("[data-org]")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "ועוד 2 ארגונים" }));
    const more = await screen.findByRole("list", { name: "ארגונים נוספים" });
    expect(within(more).getByText("גמא פיננסים")).toBeInTheDocument();
    expect(within(more).getByText("דלתא ביטוח")).toBeInTheDocument();
  });

  it("puts the badge on an avatar given an organization, sized to the avatar", () => {
    const { container } = render(
      <Avatar org={orgFor("org-9", "אומגה ייעוץ")} size={64}>
        <AvatarFallback>ד</AvatarFallback>
      </Avatar>,
    );
    const badge = within(container).getByRole("img", { name: "ארגון: אומגה ייעוץ" });
    expect(badge.textContent).toBe("אי");
    expect(badge.style.width).toBe("26px");
  });

  it("leaves an avatar without an organization exactly as it was", () => {
    const { container } = render(
      <Avatar>
        <AvatarFallback>ד</AvatarFallback>
      </Avatar>,
    );
    expect(container.querySelector("[data-org]")).toBeNull();
    expect((container.firstElementChild as HTMLElement).className).toBe("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full");
    expect((container.firstElementChild as HTMLElement).getAttribute("style")).toBeNull();
  });
});
