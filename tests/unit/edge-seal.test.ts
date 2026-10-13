import { afterEach, describe, expect, it, vi } from "vitest";
import {
  importSealKey,
  seal,
  sealConfigured,
  sealKeyFromEnv,
  unseal,
} from "../../supabase/functions/_shared/seal.ts";

const KEY_A = Buffer.alloc(32, 7).toString("base64");
const KEY_B = Buffer.alloc(32, 9).toString("base64");

const withEnv = (env: Record<string, string>) =>
  vi.stubGlobal("Deno", { env: { get: (k: string) => env[k] } });

afterEach(() => vi.unstubAllGlobals());

describe("seal / unseal", () => {
  it("round-trips a value", async () => {
    const key = await importSealKey(KEY_A);
    expect(await unseal(key, await seal(key, "AB12-CD34"))).toBe("AB12-CD34");
  });

  it("uses a fresh IV every time, so equal values never look equal", async () => {
    const key = await importSealKey(KEY_A);
    expect(await seal(key, "000000018")).not.toBe(await seal(key, "000000018"));
  });

  it("stores the IV, then the ciphertext and its 16-byte tag", async () => {
    const key = await importSealKey(KEY_A);
    const sealed = await seal(key, "000000018");
    expect(Buffer.from(sealed, "base64").length).toBe(12 + 9 + 16);
  });

  it("refuses a value that was changed after sealing", async () => {
    const key = await importSealKey(KEY_A);
    const bytes = Buffer.from(await seal(key, "000000018"), "base64");
    bytes[14] ^= 0xff;
    await expect(unseal(key, bytes.toString("base64"))).rejects.toThrow();
  });

  it("refuses a value sealed with another key", async () => {
    const sealed = await seal(await importSealKey(KEY_A), "000000018");
    await expect(unseal(await importSealKey(KEY_B), sealed)).rejects.toThrow();
  });

  it("refuses a value too short to hold an IV and a tag", async () => {
    const key = await importSealKey(KEY_A);
    await expect(unseal(key, Buffer.alloc(20).toString("base64"))).rejects.toThrow("sealed_too_short");
  });

  it("refuses text that is not base64", async () => {
    const key = await importSealKey(KEY_A);
    await expect(unseal(key, "not base64 at all!")).rejects.toThrow();
  });

  it("refuses a key that is not 32 bytes", async () => {
    await expect(importSealKey(Buffer.alloc(16, 1).toString("base64"))).rejects.toThrow("seal_key_length");
  });
});

describe("the key from the environment", () => {
  it("is not configured when MASLEKA_KEY is missing", async () => {
    withEnv({});
    expect(sealConfigured()).toBe(false);
    expect(await sealKeyFromEnv()).toBeNull();
  });

  it("is not configured when MASLEKA_KEY is short or not base64", async () => {
    withEnv({ MASLEKA_KEY: Buffer.alloc(16, 1).toString("base64") });
    expect(sealConfigured()).toBe(false);
    withEnv({ MASLEKA_KEY: "!!!" });
    expect(sealConfigured()).toBe(false);
    expect(await sealKeyFromEnv()).toBeNull();
  });

  it("is configured with 32 bytes, and the key it gives works", async () => {
    withEnv({ MASLEKA_KEY: ` ${KEY_A}\n` });
    expect(sealConfigured()).toBe(true);
    const key = await sealKeyFromEnv();
    expect(key).not.toBeNull();
    expect(await unseal(key!, await seal(key!, "x"))).toBe("x");
  });
});
