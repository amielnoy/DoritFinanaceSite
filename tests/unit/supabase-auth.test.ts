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
  isAuthCallback,
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

    // The port has two doors (signInWithGoogle and redirectToLogin); Supabase has one
    // flow, so both must reach Google.
    svc.redirectToLogin("/admin");

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/admin`, queryParams: { prompt: "select_account" } },
    });
  });

  /**
   * supabase-js reports a refused OAuth start in the payload, not by rejecting.
   * The call was fired and forgotten, so the login page's catch never ran and a
   * failed click ended in silence (review 2026-10-15).
   */
  it("reports a Google sign-in Supabase refused, so the page can say so", async () => {
    const refused = new SupabaseAuthService(clientWith({ spy: { signInWithOAuth: vi.fn(async () => ({ error: { message: "provider is not enabled" } })) } }));
    await expect(refused.signInWithGoogle("/")).rejects.toThrow(/provider is not enabled/);
    const down = new SupabaseAuthService(clientWith({ spy: { signInWithOAuth: vi.fn(async () => { throw new Error("network"); }) } }));
    await expect(down.signInWithGoogle("/")).rejects.toThrow(/network/);
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
      options: { redirectTo: `${window.location.origin}/admin/leads`, queryParams: { prompt: "select_account" } },
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

  /**
   * The page load that comes back from Google.
   *
   * The session arrives in the address (`#access_token=…`) and supabase-js
   * stores it only after a round trip to verify it. AuthContext asks
   * hasStoredToken once, on mount — before that round trip ends — so on this
   * one load the answer was "no", the auth check was skipped, and a person who
   * had just signed in saw the site signed out until they reloaded (2026-10-11,
   * production). `getUser()` waits for supabase-js to finish reading the URL,
   * so a callback in the address is reason enough to start the check.
   */
  describe("the return from a sign-in", () => {
    it("recognises the implicit-flow callback and the PKCE one", () => {
      expect(isAuthCallback({ hash: "#access_token=abc&token_type=bearer&expires_in=3600", search: "" })).toBe(true);
      expect(isAuthCallback({ hash: "", search: "?code=8f2c" })).toBe(true);
    });

    it("is not fooled by an ordinary anchor or a failed sign-in", () => {
      expect(isAuthCallback({ hash: "#services", search: "" })).toBe(false);
      expect(isAuthCallback({ hash: "", search: "" })).toBe(false);
      expect(isAuthCallback({ hash: "#error=access_denied&error_description=x", search: "" })).toBe(false);
    });

    it("starts the auth check on that load, before anything is stored", () => {
      const before = window.location.href;
      window.history.replaceState(null, "", "/#access_token=abc&token_type=bearer");
      try {
        // No sessionPresent override: this is the default probe the app uses,
        // in a jsdom without localStorage — nothing stored, token in the URL.
        expect(new SupabaseAuthService(clientWith({})).hasStoredToken()).toBe(true);
      } finally {
        window.history.replaceState(null, "", before);
      }
    });

    it("still says no on an ordinary load with nothing stored", () => {
      expect(new SupabaseAuthService(clientWith({})).hasStoredToken()).toBe(false);
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

describe("SupabaseAuthService — the welcome mail after a new account's first sign-in", () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const withFunctions = (confirmedAt: string | null | undefined, invoke = vi.fn(async () => ({ data: { sent: true }, error: null }))) => {
    const client = clientWith({ user: { id: "u1", email: "new@example.com" }, profile: { role: "user" } });
    const getUser = client.auth.getUser;
    client.auth.getUser = async () => {
      const answer = await getUser();
      return { ...answer, data: { user: answer.data.user ? { ...answer.data.user, email_confirmed_at: confirmedAt } : null } };
    };
    client.functions = { invoke };
    return { svc: new SupabaseAuthService(client), invoke };
  };

  it("asks welcome-user once for an address confirmed minutes ago", async () => {
    const { svc, invoke } = withFunctions(minutesAgo(2));
    await svc.me();
    await svc.me();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("welcome-user", { body: {} });
  });

  it("does not ask for an account confirmed more than 30 minutes ago, or never", async () => {
    for (const confirmed of [minutesAgo(31), minutesAgo(60 * 24 * 30), null, undefined, "not a date"]) {
      const { svc, invoke } = withFunctions(confirmed);
      await svc.me();
      expect(invoke, String(confirmed)).not.toHaveBeenCalled();
    }
  });

  it("never lets the welcome hold up or fail the sign-in", async () => {
    const { svc } = withFunctions(minutesAgo(1), vi.fn(async () => { throw new Error("offline"); }));
    await expect(svc.me()).resolves.toMatchObject({ id: "u1", role: "user" });
  });

  it("does not ask when the account is not provisioned for the app", async () => {
    const client = clientWith({ user: { id: "u1" }, profile: null });
    const invoke = vi.fn(async () => ({ data: null, error: null }));
    client.functions = { invoke };
    await expect(new SupabaseAuthService(client).me()).rejects.toBeTruthy();
    expect(invoke).not.toHaveBeenCalled();
  });
});
