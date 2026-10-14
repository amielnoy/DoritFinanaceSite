import { describe, expect, it } from "vitest";
import { FALLBACK_PALETTE, ORGANIZATIONS, contrastRatio, orgFor } from "@/config/organizations";

describe("the organizations' colours and letters", () => {
  it("defines each organization once, with a single letter", () => {
    const ids = ORGANIZATIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of ORGANIZATIONS) expect([...o.letter], o.id).toHaveLength(1);
  });

  it("reads at 4.5:1 or more — the white letter on the colour, the ink on the tint — for every organization and every fallback", () => {
    for (const c of [...ORGANIZATIONS, ...FALLBACK_PALETTE]) {
      expect(contrastRatio("#FFFFFF", c.color), c.color).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.ink, c.tint), `${c.ink} on ${c.tint}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("returns a defined organization as it is", () => {
    expect(orgFor("beta")).toBe(ORGANIZATIONS[1]);
  });

  it("gives an unknown organization a palette colour by its id, the same every time, and its name's first letter", () => {
    const a = orgFor("org-7f3", "אומגה ייעוץ");
    expect(a).toMatchObject({ id: "org-7f3", name: "אומגה ייעוץ", letter: "א" });
    expect(FALLBACK_PALETTE).toContainEqual({ color: a.color, tint: a.tint, ink: a.ink });
    expect(orgFor("org-7f3", "אומגה ייעוץ")).toEqual(a);
    expect(orgFor("zeta", "zeta partners").letter).toBe("Z");
  });

  it("spreads different ids across the palette", () => {
    const colours = new Set(Array.from({ length: 40 }, (_, i) => orgFor(`org-${i}`, "x").color));
    expect(colours.size).toBeGreaterThan(3);
  });

  it("measures contrast as WCAG does", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });
});
