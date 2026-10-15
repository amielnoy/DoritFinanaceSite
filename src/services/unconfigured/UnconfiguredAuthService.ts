import type { AuthPort, AuthUser } from "../ports";

const SIGN_IN_UNAVAILABLE = "ההתחברות אינה זמינה כרגע. נסו שוב מאוחר יותר.";

/**
 * Identity for a build with no Supabase credentials.
 *
 * A misconfigured build has to degrade to "nobody can sign in", not crash: the
 * bootstrap in `AuthContext` runs for every visitor, so a null client reached
 * from here would take the whole site down, not just the login page. Failures
 * use the same 403 shape as `SupabaseAuthService`, which the context classifies.
 */
export class UnconfiguredAuthService implements AuthPort {
  hasStoredToken(): boolean {
    return false;
  }

  async getPublicSettings(): Promise<unknown> {
    return {};
  }

  async me(): Promise<AuthUser> {
    throw Object.assign(new Error("Authentication is not configured"), {
      status: 403,
      data: { extra_data: { reason: "auth_required" } },
    });
  }

  logout(): void {
    // No session was ever held, so there is nothing to clear.
  }

  redirectToLogin(_returnUrl: string): void {
    throw new Error(SIGN_IN_UNAVAILABLE);
  }

  async signInWithGoogle(_returnUrl: string): Promise<void> {
    throw new Error(SIGN_IN_UNAVAILABLE);
  }

  async signInWithPassword(_email: string, _password: string): Promise<void> {
    throw new Error(SIGN_IN_UNAVAILABLE);
  }
}
