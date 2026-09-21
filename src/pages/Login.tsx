import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { LogIn } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
import { safeReturnTo } from "@/lib/authReturnTo";

/**
 * Sign in. Google, and only Google.
 *
 * The email-and-password half is gone, along with registration and the two
 * password-reset screens. Accounts are moving to Supabase, where password
 * hashes cannot be carried across — so keeping the form would have meant
 * either a forced reset for everyone or maintaining two ways in, one of which
 * was scheduled for deletion. One route also means one thing to reason about
 * when the provider changes underneath this page.
 *
 * Still Base44's flow: the provider swap happens when Supabase's Google client
 * is configured, not here.
 */
export default function Login() {
  const [error, setError] = useState<string>("");
  // Post-login destination. Same-origin paths only — `safeReturnTo` is the
  // shared open-redirect guard, and an attacker controls this query parameter.
  const returnTo = safeReturnTo();

  const handleGoogle = () => {
    setError("");
    try {
      base44.auth.loginWithProvider("google", returnTo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start sign-in. Please try again.");
    }
  };

  return (
    <AuthLayout icon={LogIn} title="Welcome back" subtitle="Log in to your account">
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
      )}

      <Button variant="outline" className="w-full h-12 text-sm font-medium" onClick={handleGoogle}>
        <GoogleIcon className="w-5 h-5 mr-2" />
        Continue with Google
      </Button>
    </AuthLayout>
  );
}
