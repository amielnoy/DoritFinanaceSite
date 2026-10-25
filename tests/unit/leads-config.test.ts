import { describe, expect, it } from "vitest";
import { slaHours } from "@/config/leads";

describe("the urgent-lead SLA threshold", () => {
  it("is 4 hours unless the deployment says otherwise", () => {
    expect(slaHours(undefined)).toBe(4);
    expect(slaHours("")).toBe(4);
    expect(slaHours("2")).toBe(2);
    expect(slaHours("1.5")).toBe(1.5);
  });

  it("ignores anything that is not a positive number", () => {
    expect(slaHours("0")).toBe(4);
    expect(slaHours("-3")).toBe(4);
    expect(slaHours("ארבע")).toBe(4);
  });
});
