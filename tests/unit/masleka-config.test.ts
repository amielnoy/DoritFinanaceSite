import { afterEach, describe, expect, it, vi } from "vitest";
import { maslekaEnabled } from "../../supabase/functions/_shared/masleka.ts";
import { isMaslekaOn } from "@/config/masleka";

/** The UI half of the dark launch: off unless the build says exactly "true" (after a trim). */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const load = async () => (await import("@/config/masleka")).MASLEKA_ENABLED;

describe("VITE_MASLEKA_ENABLED", () => {
  it("is off when unset", async () => {
    vi.stubEnv("VITE_MASLEKA_ENABLED", "");
    expect(await load()).toBe(false);
  });

  it.each(["TRUE", "1", "yes", "tru"])("is off for %j", async (value) => {
    vi.stubEnv("VITE_MASLEKA_ENABLED", value);
    expect(await load()).toBe(false);
  });

  it.each(["true", " true "])("is on for %j", async (value) => {
    vi.stubEnv("VITE_MASLEKA_ENABLED", value);
    expect(await load()).toBe(true);
  });

  it("sends people to the clearinghouse operator over https", async () => {
    const config = await import("@/config/masleka");
    expect(config.CLEARINGHOUSE_SAVER_URL).toMatch(/^https:\/\/www\.swiftness\.co\.il\//);
    expect(config.CLEARINGHOUSE_ADVISOR_URL).toMatch(/^https:\/\/www\.swiftness\.co\.il\//);
  });

  it("agrees with the Edge switch for every input, so the site and the functions cannot disagree", () => {
    const inputs: (string | undefined)[] = ["true", " true ", "TRUE", "1", "", undefined];
    for (const value of inputs) {
      vi.stubGlobal("Deno", { env: { get: () => value } });
      expect(isMaslekaOn(value), JSON.stringify(value)).toBe(maslekaEnabled());
    }
    expect(inputs.map((v) => isMaslekaOn(v))).toEqual([true, true, false, false, false, false]);
  });
});
