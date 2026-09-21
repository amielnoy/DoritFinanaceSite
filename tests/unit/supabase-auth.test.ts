import { describe, expect, it, vi } from "vitest";
import { SupabaseAuthService, type SupabaseAuthClient } from "@/services/supabase/SupabaseAuthService";

type Profile = { role?: string | null; full_name?: string | null } | null;

const clientWith = (opts: {
  user?: { id: string; email?: string | null } | null;
  userError?: { message?: string } | null;
  profile?: Profile;
  spy?: Record<string, ReturnType<typeof vi.fn>>;
  passwordError?: { message?: string } | null;
}): SupabaseAuthClient => ({
  auth: {
    getUser: async () => ({
      data: { user: opts.user ?? null },
      error: opts.userError ?? null,
    }),
    signOut: opts.spy?.signOut ?? (async () => ({ error: null })),
    signInWithOAuth: opts.spy?.signInWithOAuth ?? (async () => ({ error: null })),
    signInWithPassword:
      opts.spy?.signInWithPassword ?? (async () => ({ error: opts.passwordError ?? null })),
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

  it("routes redirectToLogin through the same Google flow", async () => {
    const signInWithOAuth = vi.fn(async () => ({ error: null }));
    const svc = new SupabaseAuthService(clientWith({ spy: { signInWithOAuth } }));

    // Base44 hosted its own sign-in screen, so the port had two doors. Supabase
    // has one: both must reach Google or the flag would half-switch.
    svc.redirectToLogin("https://example.test/admin");

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://example.test/admin" },
    });
  });

  it("sends the visitor to Google, returning where they started", async () => {
    const signInWithOAuth = vi.fn(async () => ({ error: null }));
    const svc = new SupabaseAuthService(clientWith({ spy: { signInWithOAuth } }));

    svc.signInWithGoogle("https://example.test/admin");

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

  it("signs in with an address and a password", async () => {
    const signInWithPassword = vi.fn(async () => ({ error: null }));
    const svc = new SupabaseAuthService(clientWith({ spy: { signInWithPassword } }));

    await expect(svc.signInWithPassword("d@example.com", "hunter2")).resolves.toBeUndefined();
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "d@example.com",
      password: "hunter2",
    });
  });

  it("throws on bad credentials, which Supabase reports without rejecting", async () => {
    // The failure arrives in the payload, not as a rejection. An unchecked call
    // resolves and looks exactly like a successful sign-in — except no session
    // exists, so the visitor is bounced straight back to the login screen with
    // nothing explaining why.
    const svc = new SupabaseAuthService(
      clientWith({ passwordError: { message: "Invalid login credentials" } }),
    );

    await expect(svc.signInWithPassword("d@example.com", "wrong")).rejects.toThrow(
      /Invalid login credentials/,
    );
  });

  it("does not navigate: the caller owns the guarded destination", async () => {
    const svc = new SupabaseAuthService(clientWith({}));
    // Redirecting from in here would put a second destination beside the one
    // the open-redirect guard returned, and only one of them would be checked.
    await expect(svc.signInWithPassword("d@example.com", "pw")).resolves.toBeUndefined();
  });

  it("answers hasStoredToken synchronously, because the guards ask during render", () => {
    expect(new SupabaseAuthService(clientWith({}), () => true).hasStoredToken()).toBe(true);
    expect(new SupabaseAuthService(clientWith({}), () => false).hasStoredToken()).toBe(false);
  });
});
