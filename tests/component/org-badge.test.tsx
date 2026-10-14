// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import OrgBadge, { badgeSpec } from "@/components/dorit/org/OrgBadge";
import OrgChip from "@/components/dorit/org/OrgChip";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ORGANIZATIONS, orgFor } from "@/config/organizations";

const alpha = ORGANIZATIONS[0];

describe("OrgBadge, OrgChip and the avatar with an organization", () => {
  it.each([
    [64, 26, true],
    [44, 20, true],
    [40, 20, true],
    [32, 12, false],
    [24, 12, false],
  ])("on a %ipx avatar: a %ipx badge, letter shown: %s", (avatar, size, letter) => {
    expect(badgeSpec(avatar)).toMatchObject({ size, letter });
    const { container } = render(<div className="relative"><OrgBadge org={alpha} avatarSize={avatar} /></div>);
    const badge = screen.getByRole("img", { name: "סוכנות אלפא" });
    expect(badge.style.width).toBe(`${size}px`);
    expect(badge.style.background).toBe("rgb(31, 78, 140)");
    expect(badge.textContent).toBe(letter ? "א" : "");
    expect(container.querySelector('[data-org="alpha"]')).toBe(badge);
  });

  it("sits at the inline-end bottom corner, with a white rim", () => {
    render(<OrgBadge org={alpha} avatarSize={64} />);
    const badge = screen.getByRole("img", { name: "סוכנות אלפא" });
    expect(badge.style.insetInlineEnd).toBe("-3px");
    expect(badge.style.bottom).toBe("-3px");
    expect(badge.style.borderWidth).toBe("3px");
    expect(badge.className).toContain("border-white");
  });

  it("writes the name on the chip, in the ink on the tint, with the colour's square first", () => {
    const { container } = render(<OrgChip org={ORGANIZATIONS[1]} />);
    const chip = container.querySelector('[data-org="beta"]') as HTMLElement;
    expect(chip).toHaveTextContent("משרד בטא");
    expect(chip.style.background).toBe("rgb(252, 235, 221)");
    expect(chip.style.color).toBe("rgb(138, 47, 6)");
    const square = chip.firstElementChild as HTMLElement;
    expect(square).toHaveAttribute("aria-hidden", "true");
    expect(square.style.background).toBe("rgb(180, 64, 11)");
  });

  it("puts the badge on an avatar given an organization, sized to the avatar", () => {
    const { container } = render(
      <Avatar org={orgFor("org-9", "אומגה")} size={64}>
        <AvatarFallback>ד</AvatarFallback>
      </Avatar>,
    );
    const badge = within(container).getByRole("img", { name: "אומגה" });
    expect(badge.textContent).toBe("א");
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
