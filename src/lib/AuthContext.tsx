import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { services } from "@/services";
import type { AuthFailure, AuthUser } from "@/services";

/**
 * Who is signed in, resolved in the background from the first paint.
 *
 * This used to also hold `appPublicSettings` and `isLoadingPublicSettings`,
 * left over from a full-screen gate that held the whole router until the app
 * settings call resolved (see the note in App.jsx). Nothing read them once the
 * gate went, so they are gone; the settings call itself stays, because its
 * 403 is how the SDK reports "sign in first" and "user not registered".
 *
 * Reads through `services.auth`, not the SDK — the last first-party module
 * that still imported the vendor singleton directly.
 */

export type AuthErrorType = "auth_required" | "user_not_registered" | "unknown" | (string & {});

export interface AuthError {
  type: AuthErrorType;
  message: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** True while `me()` is in flight. */
  isLoadingAuth: boolean;
  /** True once the first auth check has settled, either way. */
  authChecked: boolean;
  authError: AuthError | null;
  logout: (shouldRedirect?: boolean) => void;
  navigateToLogin: () => void;
  checkUserAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const toAuthError = (e: unknown, fallback: string): AuthError => {
  const err = (e ?? {}) as AuthFailure;
  const reason = err.status === 403 ? err.data?.extra_data?.reason : undefined;
  if (reason === "auth_required") return { type: "auth_required", message: "Authentication required" };
  if (reason === "user_not_registered")
    return { type: "user_not_registered", message: "User not registered for this app" };
  if (reason) return { type: reason, message: err.message ?? fallback };
  return { type: "unknown", message: err.message ?? fallback };
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<AuthError | null>(null);

  const checkUserAuth = useCallback(async () => {
    setIsLoadingAuth(true);
    try {
      const currentUser = await services.auth.me();
      setUser(currentUser);
      setIsAuthenticated(true);
    } catch (e) {
      console.error("User auth check failed:", e);
      setIsAuthenticated(false);
      const { status } = (e ?? {}) as AuthFailure;
      // A rejected `me()` is most likely an expired token.
      if (status === 401 || status === 403) {
        setAuthError({ type: "auth_required", message: "Authentication required" });
      }
    } finally {
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await services.auth.getPublicSettings();
        if (cancelled) return;
        if (services.auth.hasStoredToken()) {
          await checkUserAuth();
        } else {
          setIsAuthenticated(false);
          setIsLoadingAuth(false);
          setAuthChecked(true);
        }
      } catch (e) {
        if (cancelled) return;
        console.error("App state check failed:", e);
        setAuthError(toAuthError(e, "Failed to load app"));
        setIsLoadingAuth(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [checkUserAuth]);

  const logout = (shouldRedirect = true) => {
    setUser(null);
    setIsAuthenticated(false);
    // With a URL the SDK clears the token and sends the browser there.
    services.auth.logout(shouldRedirect ? window.location.href : undefined);
  };

  const navigateToLogin = () => {
    services.auth.redirectToLogin(window.location.href);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        authChecked,
        authError,
        logout,
        navigateToLogin,
        checkUserAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
