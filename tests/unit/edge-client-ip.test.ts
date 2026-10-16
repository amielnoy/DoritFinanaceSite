import { describe, expect, it } from "vitest";
import { NO_ADDRESS, clientIp } from "../../supabase/functions/_shared/guard.ts";

/* Whose address a limiter counts (review 2026-10-15): never one the client wrote itself. */

const req = (headers: Record<string, string>) => new Request("https://edge.test/x", { headers });

describe("clientIp", () => {
  it("takes the platform's cf-connecting-ip first", () => {
    expect(clientIp(req({ "cf-connecting-ip": "198.51.100.4", "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe("198.51.100.4");
  });

  it("otherwise takes the last x-forwarded-for entry — the one the gateway appended", () => {
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-forwarded-for": " 203.0.113.7 " }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, , 203.0.113.7," }))).toBe("203.0.113.7");
  });

  it("gives a caller with no address the one key they all share, never nothing", () => {
    expect(clientIp(req({}))).toBe(NO_ADDRESS);
    expect(clientIp(req({ "x-forwarded-for": " , " }))).toBe(NO_ADDRESS);
    expect(clientIp(req({ "cf-connecting-ip": "  " }))).toBe(NO_ADDRESS);
  });

  it("keeps at most 64 characters", () => {
    expect(clientIp(req({ "cf-connecting-ip": "x".repeat(200) }))).toHaveLength(64);
  });
});
