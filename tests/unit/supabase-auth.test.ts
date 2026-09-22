/**
 * @vitest-environment jsdom
 *
 * Needs a DOM: the adapter resolves the guarded path against
 * `window.location.origin`, and the reason it does is the whole point of two
 * of the tests below.
 */
import { describe, expect, it, vi } from "vitest";
import {
  SupabaseAuthService,
  hasSupabaseSessionKey,
  type SupabaseAuthClient,
} from "@/services/supabase/SupabaseAuthService";

type Profile = { role?: string | null } | null;

const clientWith = (opts: {
  user?: {
    id: string;
    email?: string | null;
    user_metadata?: { full_name?: string | null; name?: string | null } | null;
  } | null;
  userError?: { message?: string } | null;
  profile?: Profile;
  profileError?: { message?: string } | null;
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
        maybeSingle: async () => ({
          data: opts.profile ?? null,
          error: opts.profileError ?? null,
        }),
      }),
    }),
  }),
});

describe("SupabaseAuthService", () => {
  it("reports the signed-in user with the role from profiles", async () => {
    const svc = new SupabaseAuthService(
      clientWith({
        user: { id: "u1", email: "d@example.com", user_metadata: { full_name: "דורית" } },
        profile: { role: "admin" },
      }),
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

  it("does not call a failed profile read 'not registered'", async () => {
    // These two states look identical from `data` alone — both give null. A
    // mistyped column name once surfaced as "User not registered for this app",
    // which reads as a confident verdict about a perfectly good account and
    // sends whoever is debugging it to the wrong place entirely.
    const svc = new SupabaseAuthService(
      clientWith({
        user: { id: "u1" },
        profile: null,
        profileError: { message: 'column profiles.full_name does not exist' },
      }),
    );

    await expect(svc.me()).rejects.toThrow(/does not exist/);
    await expect(svc.me()).rejects.not.toMatchObject({
      data: { extra_data: { reason: "user_not_registered" } },
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
    svc.redirectToLogin("/admin");

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/admin` },
    });
  });

  it("makes the guarded path absolute, because Supabase silently ignores a path", async () => {
    const signInWithOAuth = vi.fn(async () => ({ error: null }));
    const svc = new SupabaseAuthService(clientWith({ spy: { signInWithOAuth } }));

    // `safeReturnTo` returns a path, which is all the open-redirect guard can
    // vouch for. Handed one, Supabase falls back to the project's Site URL —
    // and that is invisible: sign-in completes and the session is stored
    // against the *production* origin, leaving the origin you started from
    // signed out with nothing logged anywhere.
    svc.signInWithGoogle("/admin/leads");

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/admin/leads` },
    });
  });

  it("cannot be walked off this origin by the path it is given", async () => {
    const signInWithOAuth = vi.fn(async () => ({ error: null }));
    const svc = new SupabaseAuthService(clientWith({ spy: { signInWithOAuth } }));

    svc.signInWithGoogle("https://evil.example/steal");

    const sent = signInWithOAuth.mock.calls[0][0] as { options: { redirectTo: string } };
    expect(new URL(sent.options.redirectTo).origin).toBe(window.location.origin);
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

  describe("the session probe", () => {
    // A stand-in rather than the real thing: this jsdom build provides `window`
    // and `location` but no `localStorage` at all, and the bug being guarded
    // against is in the key pattern, not in any browser.
    const storage = (keys: string[]) => ({ length: keys.length, key: (i: number) => keys[i] ?? null });

    it("finds a whole session", () => {
      expect(hasSupabaseSessionKey(storage(["sb-abc123-auth-token"]))).toBe(true);
    });

    it("finds a session split into chunks", () => {
      // supabase-js splits a session past a size threshold across numbered
      // keys, and a Google sign-in carrying a provider token is over it. The
      // first version anchored on `-auth-token$`: it matched the small case and
      // missed the one this app actually produces. Silently — "no stored token"
      // skips the auth check rather than failing it, so the visitor stayed
      // signed out with nothing logged and no button on the page.
      expect(hasSupabaseSessionKey(storage(["sb-abc123-auth-token.0", "sb-abc123-auth-token.1"]))).toBe(true);
    });

    it("is not fooled by somebody else's key", () => {
      expect(hasSupabaseSessionKey(storage(["theme", "sb-something-else", "auth-token"]))).toBe(false);
    });

    it("says no rather than throwing when storage is unavailable", () => {
      const hostile = { length: 1, key: () => { throw new Error("blocked"); } };
      expect(hasSupabaseSessionKey(hostile)).toBe(false);
    });
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
