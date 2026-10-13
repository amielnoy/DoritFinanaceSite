import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as browser from "@/lib/israeli-id";
import * as edge from "../../supabase/functions/_shared/israeli-id.ts";
import { REPO_ROOT } from "../helpers/entity-schema";

/**
 * The ת״ז check digit, as the page checks it before sending and the Edge
 * Function checks it again before storing. Every value here is constructed
 * from the algorithm (zero-padded, so no real person's number), never copied
 * from anywhere.
 */
const VALID: Array<[string, string]> = [
  ["000000018", "000000018"],
  ["00018", "000000018"],
  ["000000026", "000000026"],
  ["000000034", "000000034"],
  ["000001016", "000001016"],
  ["000 000 018", "000000018"],
  ["0000-00018", "000000018"],
];

const INVALID: unknown[] = [
  "000000019",
  "000000017",
  "000000000",
  "0018",
  "0000000018",
  "00000001a",
  "",
  "   ",
  null,
  undefined,
  18,
];

describe.each([
  ["browser", browser],
  ["edge", edge],
] as const)("the %s copy", (_label, impl) => {
  it.each(VALID)("accepts %s as %s", (raw, normalized) => {
    expect(impl.normalizeIsraeliId(raw)).toBe(normalized);
    expect(impl.isValidIsraeliId(raw)).toBe(true);
  });

  it.each(INVALID.map((v) => [v]))("rejects %s", (raw) => {
    expect(impl.normalizeIsraeliId(raw)).toBeNull();
    expect(impl.isValidIsraeliId(raw)).toBe(false);
  });
});

describe("the two copies", () => {
  it("are the same code, so the page and the function never disagree", () => {
    const body = (path: string) => {
      const src = readFileSync(join(REPO_ROOT, path), "utf8");
      return src.slice(src.indexOf("export function normalizeIsraeliId")).replace(/\s+/g, " ").trim();
    };
    expect(body("src/lib/israeli-id.ts")).toBe(body("supabase/functions/_shared/israeli-id.ts"));
  });
});
