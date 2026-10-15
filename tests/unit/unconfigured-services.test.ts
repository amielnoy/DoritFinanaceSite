import { describe, expect, it } from "vitest";
import { AccountLoadError } from "@/services/ports";
import { UnconfiguredAccountService } from "@/services/unconfigured/UnconfiguredAccountService";
import { UnconfiguredAuthService } from "@/services/unconfigured/UnconfiguredAuthService";

describe("UnconfiguredAuthService", () => {
  const auth = new UnconfiguredAuthService();

  it("holds no session, so the bootstrap takes the anonymous branch", () => {
    expect(auth.hasStoredToken()).toBe(false);
  });

  it("resolves public settings rather than failing every visitor's page load", async () => {
    await expect(auth.getPublicSettings()).resolves.toEqual({});
  });

  it("rejects me() with the 403 auth_required shape AuthContext classifies", async () => {
    await expect(auth.me()).rejects.toMatchObject({
      status: 403,
      data: { extra_data: { reason: "auth_required" } },
    });
  });

  it("logs out without throwing", () => {
    expect(() => auth.logout()).not.toThrow();
    expect(() => auth.logout("/")).not.toThrow();
  });

  it("refuses a Google sign-in with a message the login page can show", async () => {
    await expect(auth.signInWithGoogle("/")).rejects.toThrow(/\S/);
  });

  it("refuses a password sign-in with a message the login page can show", async () => {
    await expect(auth.signInWithPassword("a@example.com", "pw")).rejects.toThrow(/\S/);
  });
});

describe("UnconfiguredAccountService", () => {
  it("rejects with a signed_out AccountLoadError", async () => {
    const err = await new UnconfiguredAccountService().myEnquiries().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountLoadError);
    expect((err as AccountLoadError).reason).toBe("signed_out");
  });
});
