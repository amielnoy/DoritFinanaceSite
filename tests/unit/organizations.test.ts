import { describe, expect, it } from "vitest";
import { FALLBACK_PALETTE, ORGANIZATIONS, contrastRatio, deriveCode, orgFor, organizationDirectory } from "@/config/organizations";

describe("the organizations' colours and codes", () => {
  it("defines each organization once, with a code of one or two characters", () => {
    const ids = ORGANIZATIONS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of ORGANIZATIONS) expect([...(o.code ?? "")].length, o.id).toBeGreaterThanOrEqual(1);
    for (const o of ORGANIZATIONS) expect([...(o.code ?? "")].length, o.id).toBeLessThanOrEqual(2);
  });

  it("reads at 4.5:1 or more — the white code on the colour, the ink on the tint — for every organization and every fallback", () => {
    for (const c of [...ORGANIZATIONS, ...FALLBACK_PALETTE]) {
      expect(contrastRatio("#FFFFFF", c.color), c.color).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(c.ink, c.tint), `${c.ink} on ${c.tint}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("derives a code: the first letters of the first two words, or a one-word name's first two letters", () => {
    expect(deriveCode("סוכנות אלפא")).toBe("סא");
    expect(deriveCode("  גמא   פיננסים בע\"מ ")).toBe("גפ");
    expect(deriveCode("Zeta partners")).toBe("ZP");
    expect(deriveCode("Omega")).toBe("OM");
    expect(deriveCode("X")).toBe("X");
  });

  it("keeps a configured organization's look, under the name it is given", () => {
    const beta = orgFor("beta", "משרד בטא בע\"מ");
    expect(beta).toMatchObject({ code: "מב", color: "#B4400B", name: "משרד בטא בע\"מ" });
  });

  it("gives an unknown organization a palette colour by its id, the same every time, and a derived code", () => {
    const a = orgFor("org-7f3", "אומגה ייעוץ");
    expect(a).toMatchObject({ id: "org-7f3", name: "אומגה ייעוץ", code: "אי" });
    expect(FALLBACK_PALETTE).toContainEqual({ color: a.color, tint: a.tint, ink: a.ink });
    expect(orgFor("org-7f3", "אומגה ייעוץ")).toEqual(a);
  });

  it("never gives two organizations shown together the same code, and keeps configured codes", () => {
    const dir = organizationDirectory([
      { id: "alpha", name: "סוכנות אלפא" },
      { id: "o1", name: "סוכנות אור" },
      { id: "o2", name: "סוכנות אביב" },
      { id: "o3", name: "סאן" },
    ]);
    const codes = [...dir.values()].map((o) => o.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(dir.get("alpha")!.code).toBe("סא");
    // "סוכנות אור" → "סא" is taken, so its first letter with the next distinct letter: "סו".
    expect(dir.get("o1")!.code).toBe("סו");
    expect(dir.get("o2")!.code).toBe("סכ");
  });

  it("gives the same set of organizations the same codes, whatever order they arrive in", () => {
    const orgs = [
      { id: "o1", name: "סוכנות אור" },
      { id: "o2", name: "סוכנות אביב" },
      { id: "o3", name: "סוכנות אלון" },
    ];
    const codes = (list: typeof orgs) => Object.fromEntries([...organizationDirectory(list)].map(([id, o]) => [id, o.code]));
    expect(codes([...orgs].reverse())).toEqual(codes(orgs));
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
