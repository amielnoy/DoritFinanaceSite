import type { AuthPort, AuthUser } from "../ports";

/** The SDK surface this adapter needs — not the whole client. */
export interface AuthClient {
  app: { getPublicSettings(): Promise<unknown> };
  auth: {
    me(): Promise<AuthUser>;
    logout(redirectUrl?: string): void;
    redirectToLogin(returnUrl: string): void;
    loginWithProvider(provider: string, returnUrl: string): void;
    loginViaEmailPassword(email: string, password: string): Promise<unknown>;
  };
}

export class Base44AuthService implements AuthPort {
  /**
   * `tokenPresent` is injected rather than read from `@/lib/app-params` here,
   * so a test can construct the adapter against a fake client without
   * loading the SDK's token bootstrap. The composition root passes the real
   * one. (The SDK's own `auth.isAuthenticated()` is a network round-trip,
   * not a stored-token check, which is why it is not used for this.)
   */
  constructor(
    private readonly client: AuthClient,
    private readonly tokenPresent: () => boolean = () => false
  ) {}

  hasStoredToken(): boolean {
    return this.tokenPresent();
  }

  getPublicSettings(): Promise<unknown> {
    return this.client.app.getPublicSettings();
  }

  me(): Promise<AuthUser> {
    return this.client.auth.me();
  }

  logout(redirectUrl?: string): void {
    if (redirectUrl) this.client.auth.logout(redirectUrl);
    else this.client.auth.logout();
  }

  redirectToLogin(returnUrl: string): void {
    this.client.auth.redirectToLogin(returnUrl);
  }

  signInWithGoogle(returnUrl: string): void {
    this.client.auth.loginWithProvider("google", returnUrl);
  }

  async signInWithPassword(email: string, password: string): Promise<void> {
    await this.client.auth.loginViaEmailPassword(email, password);
  }
}
