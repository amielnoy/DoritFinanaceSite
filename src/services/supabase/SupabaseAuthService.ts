import type { AuthPort, AuthUser } from "../ports";

interface SupabaseError {
  message?: string;
  status?: number;
}

/** The Supabase surface this adapter needs — not the whole client. */
export interface SupabaseAuthClient {
  auth: {
    getUser(): Promise<{
      data: {
        user: {
          id: string;
          email?: string | null;
          /** Whatever the provider sent about the person; Google supplies a name. */
          user_metadata?: { full_name?: string | null; name?: string | null } | null;
        } | null;
      };
      error: SupabaseError | null;
    }>;
    signOut(): Promise<{ error: SupabaseError | null }>;
    signInWithOAuth(args: {
      provider: "google";
      options?: { redirectTo?: string };
    }): Promise<{ error: SupabaseError | null }>;
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<{ error: SupabaseError | null }>;
  };
  from(table: "profiles"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        // PromiseLike, not Promise: PostgREST's builder is a thenable that only
        // issues the request when awaited. Declaring Promise here would demand
        // `catch` and `finally` the builder does not have, and the real client
        // would not satisfy this interface.
        maybeSingle(): PromiseLike<{
          data: { role?: string | null } | null;
          error: SupabaseError | null;
        }>;
      };
    };
  };
}

/**
 * Shaped like the SDK's own failures, because `AuthContext` reads them.
 *
 * It distinguishes "sign in first" from "signed in, but not a user of this app"
 * by looking for a 403 and a reason, and shows different copy for each. Throwing
 * a bare Error here would collapse both into "unknown" and lose that, so the
 * adapter speaks the vocabulary the context already understands rather than the
 * context learning a second one.
 */
const authFailure = (reason: string, message: string) =>
  Object.assign(new Error(message), {
    status: 403,
    data: { extra_data: { reason } },
  });

export class SupabaseAuthService implements AuthPort {
  constructor(
    private readonly client: SupabaseAuthClient,
    /**
     * Whether a session is stored, answered synchronously.
     *
     * `getUser()` is a network round-trip, and the route guards ask this
     * question during render to decide whether a check is even worth starting.
     * Supabase keeps its session in localStorage under `sb-<ref>-auth-token`,
     * possibly split across numbered chunks. Reading a vendor's private storage
     * key is brittle by nature; it is done here because the question — is a
     * check worth starting — has to be answered synchronously during render,
     * and `getSession()` is a promise.
     */
    private readonly sessionPresent: () => boolean = defaultSessionPresent,
  ) {}

  hasStoredToken(): boolean {
    return this.sessionPresent();
  }

  /**
   * Base44 gated on an app-level reachability check that could reject with
   * "you are not a user of this app". Supabase has no such notion — a project
   * either answers or does not — so this resolves and the real decision is made
   * by `me()` and by row-level security.
   */
  async getPublicSettings(): Promise<unknown> {
    return {};
  }

  async me(): Promise<AuthUser> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) {
      throw authFailure("auth_required", error?.message ?? "Authentication required");
    }

    // The role lives in `profiles`, not in the JWT: it can be revoked between
    // one request and the next, and a token minted an hour ago would still
    // claim it. Everything that matters is enforced by RLS regardless — this
    // read only decides which screens to offer.
    const { data: profile, error: profileError } = await this.client
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();

    // A failed read is not an unprovisioned account, and conflating them is how
    // a mistyped column name announced itself as "User not registered for this
    // app" — a confident, wrong diagnosis of a working account. The two states
    // look identical from `data` alone, so the error has to be asked about.
    if (profileError) {
      throw Object.assign(new Error(profileError.message ?? "Could not read the profile"), {
        status: profileError.status,
      });
    }

    if (!profile) {
      // No row, and no error: the trigger creates one on sign-up, so absence
      // really does mean this account is not provisioned for the app.
      throw authFailure("user_not_registered", "User not registered for this app");
    }

    // The display name comes from the provider rather than the table — Google
    // supplies it, and `profiles` deliberately stores only what authorises.
    const meta = data.user.user_metadata;
    return {
      id: data.user.id,
      email: data.user.email ?? undefined,
      full_name: meta?.full_name ?? meta?.name ?? undefined,
      role: profile.role ?? "user",
    };
  }

  logout(redirectUrl?: string): void {
    // Fire-and-forget to match the port's synchronous shape, but the redirect
    // waits for the sign-out: navigating first can leave the session intact if
    // the page tears down before the request goes out.
    void this.client.auth.signOut().finally(() => {
      if (redirectUrl && typeof window !== "undefined") window.location.href = redirectUrl;
    });
  }

  redirectToLogin(returnUrl: string): void {
    this.signInWithGoogle(returnUrl);
  }

  signInWithGoogle(returnUrl: string): void {
    void this.client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: absoluteOnThisOrigin(returnUrl) },
    });
  }

  async signInWithPassword(email: string, password: string): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email, password });
    // Supabase reports failure in the payload rather than by rejecting, so an
    // unchecked call looks like a successful sign-in that leaves no session.
    if (error) throw new Error(error.message ?? "Invalid email or password");
  }
}

/**
 * The guarded path, as an absolute URL on the origin we are running on.
 *
 * `safeReturnTo` returns a path — "/admin/leads", or "/" — because that is what
 * the open-redirect guard can vouch for. Supabase wants an absolute URL, and
 * silently falls back to the project's Site URL when it does not get one. That
 * fallback is not a broken redirect anyone notices: sign-in completes, the
 * session is created, and it is stored against the *production* origin. Signing
 * in from localhost appeared to work and left localhost signed out.
 *
 * Resolving against `window.location.origin` keeps the guarantee intact — the
 * path was already checked same-origin, and this cannot move it to another host
 * because the origin is ours, not the caller's.
 */
const absoluteOnThisOrigin = (path: string): string | undefined => {
  if (typeof window === "undefined") return undefined;
  const origin = window.location.origin;
  try {
    const url = new URL(path, origin);
    // `new URL` ignores the base when the input is already absolute, so a full
    // URL would pass through untouched. Today's only caller hands over a value
    // `safeReturnTo` has already vouched for — but this is the last point
    // before the destination leaves for a third party, and a function that is
    // only safe because of who happens to call it is one refactor from not
    // being safe at all.
    return url.origin === origin ? url.toString() : origin + "/";
  } catch {
    return origin + "/";
  }
};

/**
 * Does this storage hold a Supabase session?
 *
 * Takes the storage rather than reaching for `window`, so the interesting case
 * is testable: not every DOM test environment provides `localStorage`, and the
 * bug this guards against lives in the key pattern, not in the browser.
 *
 * Reading a vendor's private storage key is brittle by nature. It is done here
 * because the question — is an auth check worth starting — must be answered
 * synchronously during render, and `getSession()` is a promise.
 */
export function hasSupabaseSessionKey(storage: Pick<Storage, "length" | "key">): boolean {
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      // The chunk suffix is the point of the trailing group. supabase-js splits
      // a session past a size threshold across `…-auth-token.0`, `.1`, … and a
      // Google sign-in carrying a provider token is comfortably over it.
      // Anchoring on `-auth-token$` matched the small case and missed the one
      // this app actually produces — silently, because "no stored token" skips
      // the auth check rather than failing it, so the visitor simply stays
      // signed out with nothing logged anywhere.
      if (key && /^sb-.+-auth-token(\.\d+)?$/.test(key)) return true;
    }
  } catch {
    // Storage can throw outright when cookies are blocked. A wrong "no" costs
    // one redundant auth check; an exception costs the render.
    return false;
  }
  return false;
}

function defaultSessionPresent(): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  return hasSupabaseSessionKey(window.localStorage);
}
