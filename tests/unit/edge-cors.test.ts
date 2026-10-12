import { describe, expect, it } from "vitest";
import { allowedOrigin, corsHeaders } from "../../supabase/functions/_shared/cors.ts";

describe("allowedOrigin", () => {
  it.each([
    "https://govari-fin.co.il",
    "https://www.govari-fin.co.il",
    "https://safe-arch-plan.base44.app",
    "https://dorit-finance-site.vercel.app",
    "https://dorit-finance-site-git-main-amielnoy-9725s-projects.vercel.app",
    "https://dorit-finance-site-abc123-amielnoy-9725s-projects.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
  ])("lets %s in", (origin) => {
    expect(allowedOrigin(origin)).toBe(origin);
  });

  it.each([
    null,
    "",
    "https://evil.example",
    "https://govari-fin.co.il.evil.example",
    "http://govari-fin.co.il",
    "https://someone-else.vercel.app",
    "https://dorit-finance-site.vercel.app.evil.example",
    "http://localhost.evil.example",
  ])("refuses %s", (origin) => {
    expect(allowedOrigin(origin)).toBeNull();
  });
});

describe("corsHeaders", () => {
  it("echoes an allowed origin and varies on it", () => {
    const h = corsHeaders("https://govari-fin.co.il");
    expect(h["Access-Control-Allow-Origin"]).toBe("https://govari-fin.co.il");
    expect(h.Vary).toBe("Origin");
  });

  it("allows the headers supabase-js sends, and only POST", () => {
    const h = corsHeaders("https://govari-fin.co.il");
    for (const header of ["authorization", "apikey", "content-type", "x-client-info"]) {
      expect(h["Access-Control-Allow-Headers"]).toContain(header);
    }
    expect(h["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
  });

  it("names no origin for one that is not on the list", () => {
    expect(corsHeaders("https://evil.example")).not.toHaveProperty("Access-Control-Allow-Origin");
  });
});
