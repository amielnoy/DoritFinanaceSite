import React, { useState } from "react";
import { services } from "@/services";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, Mail, Lock, Loader2 } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
import { safeReturnTo } from "@/lib/authReturnTo";
import { signInErrorMessage } from "@/lib/signInError";

/**
 * Sign in. Google first, with an address and password beside it.
 *
 * Google leads because it is the route without a password to lose, and the one
 * that carries the account's own two-factor. The form stays for the cases it
 * does not cover.
 *
 * There is no "create one" link. Accounts into a system holding customer
 * enquiries are provisioned rather than self-served, so they are made in the
 * Supabase dashboard — which also means an account signed up through Google has
 * no password until somebody sets one, and the form will refuse it.
 *
 * Which provider answers is the composition root's business, not this page's.
 * Both routes go through the port, so switching provider switches where the
 * visitor actually signs in — not just who answers `me()` afterwards.
 */
export default function Login() {
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  // Post-login destination. Same-origin paths only — `safeReturnTo` is the
  // shared open-redirect guard, and an attacker controls this query parameter.
  const returnTo = safeReturnTo();

  const handleGoogle = () => {
    setError("");
    try {
      services.auth.signInWithGoogle(returnTo);
    } catch (err) {
      setError("לא הצלחנו להתחיל את ההתחברות. נסו שוב.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await services.auth.signInWithPassword(email, password);
      window.location.href = returnTo;
    } catch (err) {
      setError(signInErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout icon={LogIn} title="ברוכים השבים" subtitle="כניסה לאזור האישי שלכם">
      <Button
        variant="outline"
        className="w-full h-12 text-sm font-medium mb-6"
        onClick={handleGoogle}
      >
        <GoogleIcon className="w-5 h-5 me-2" />
        המשיכו עם Google
      </Button>

      <div className="relative mb-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-3 text-muted-foreground">או</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">דוא״ל</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="email"
              type="email"
              dir="ltr"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">סיסמה</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10 h-12"
              required
            />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 me-2 animate-spin" />
              מתחברים…
            </>
          ) : (
            "כניסה"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
