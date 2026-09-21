import { describe, expect, it, vi } from "vitest";
import { SupabaseAuthService, type SupabaseAuthClient } from "@/services/supabase/SupabaseAuthService";

type Profile = { role?: string | null; full_name?: string | null } | null;

const clientWith = (opts: {
  user?: { id: string; email?: string | null } | null;
  userError?: { message?: string } | null;
  profile?: Profile;
  spy?: Record<string, ReturnType<typeof vi.fn>>;
}): SupabaseAuthClient => ({
  auth: {
    getUser: async () => ({
      data: { user: opts.user ?? null },
      error: opts.userError ?? null,
    }),
    signOut: opts.spy?.signOut ?? (async () => ({ error: null })),
    signInWithOAuth: opts.spy?.signInWithOAuth ?? (async () => ({ error: null })),
  },
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: opts.profile ?? null, error: null }),
      }),
    }),
  }),
});

describe("SupabaseAuthService", () => {
  it("reports the signed-in user with the role from profiles", async () => {
    const svc = new SupabaseAuthService(
      clientWith({ user: { id: "u1", email: "d@example.com" }, profile: { role: "admin", full_name: "דורית" } }),
    );

    await expect(svc.me()).resolves.toEqual({
      id: "u1",
      email: "d@example.com",
      full_name: "דורית",
      role: "admin",
    });
  });

  it("reads the role from the table, never from the token", async () => {
    // A JWT minted an hour ago would still claim admin after it was revoked.
    const svc = new SupabaseAuthService(
      clientWith({ user: { id: "u1" }, profile: { role: "user" } }),
    );
    await expect(svc.me()).resolves.toMatchObject({ role: "user" });
  });

  it("defaults a null role to user rather than leaving it undefined", async () => {
    const svc = new SupabaseAuthService(clientWith({ user: { id: "u1" }, profile: { role: null } }));
    await expect(svc.me()).resolves.toMatchObject({ role: "user" });
  });

  it("asks for sign-in with the reason AuthContext looks for", async () => {
    const svc = new SupabaseAuthService(clientWith({ user: null }));

    // A bare Error would collapse into "unknown" and lose the distinction the
    // context shows different copy for.
    await expect(svc.me()).rejects.toMatchObject({
      status: 403,
      data: { extra_data: { reason: "auth_required" } },
    });
  });

  it("separates 'signed in but not provisioned' from 'not signed in'", async () => {
    const svc = new SupabaseAuthService(clientWith({ user: { id: "u1" }, profile: null }));

    await expect(svc.me()).rejects.toMatchObject({
      status: 403,
      data: { extra_data: { reason: "user_not_registered" } },
    });
  });

  it("sends the visitor to Google, returning where they started", async () => {
    const signInWithOAuth = vi.fn(async () => ({ error: null }));
    const svc = new SupabaseAuthService(clientWith({ spy: { signInWithOAuth } }));

    svc.redirectToLogin("https://example.test/admin");

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://example.test/admin" },
    });
  });

  it("signs out before redirecting, not after", async () => {
    const order: string[] = [];
    const signOut = vi.fn(async () => { order.push("signOut"); return { error: null }; });
    const svc = new SupabaseAuthService(clientWith({ spy: { signOut } }));

    svc.logout("https://example.test/");
    await vi.waitFor(() => expect(signOut).toHaveBeenCalled());

    // Navigating first can tear the page down before the request leaves,
    // leaving the session alive on a machine someone just walked away from.
    expect(order).toEqual(["signOut"]);
  });

  it("answers hasStoredToken synchronously, because the guards ask during render", () => {
    expect(new SupabaseAuthService(clientWith({}), () => true).hasStoredToken()).toBe(true);
    expect(new SupabaseAuthService(clientWith({}), () => false).hasStoredToken()).toBe(false);
  });
});
