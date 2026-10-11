# Retiring Base44 as an auth fallback

**Date:** 2026-10-11 · **Status:** design, not yet implemented.

**Parent:** [2026-09-21-supabase-auth-data-migration-design.md](2026-09-21-supabase-auth-data-migration-design.md)
proved the Supabase auth path end to end against the live project on
2026-09-22 (Google sign-in, the `profiles` trigger, `is_admin()`, RLS all
confirmed against real data) and left it live behind `VITE_AUTH_PROVIDER`.
This spec is the next piece of Phase 2 of
[2026-10-10-multi-agent-platform-design.md](2026-10-10-multi-agent-platform-design.md):
retiring the Base44 side of that flag now that the Supabase side is proven.

## Why now

`VITE_AUTH_PROVIDER` has been doing its job as an opt-in while the Supabase
path was unproven. It is proven. Carrying the flag past that point costs two
things every day it stays: a local/CI divergence (this developer's
`.env.local` forces `supabase`, CI never sets the variable and defaults to
`base44`, which is the most likely explanation for three e2e specs —
`navigation.spec.ts`, `security.spec.ts`, `account.spec.ts` — failing locally
while green in CI), and a second, unexercised code path (`Base44AuthService`,
`Base44AccountService`) that every future auth change has to keep reasoning
about correctly even though nothing production-relevant still chooses it.

## Scope

**In:**
- Delete `src/config/auth-provider.ts` and the `VITE_AUTH_PROVIDER` type
  entry in `src/vite-env.d.ts` (its `VITE_UPLOAD_PROVIDER` sibling entry
  stays — that flag has its own, separate lifecycle).
- Delete `src/services/base44/Base44AuthService.ts` and
  `src/services/base44/Base44AccountService.ts`. Remove only the
  `failureOf` function from `src/services/base44/invoke.ts` — that file's
  other exports, `responseBody` and `invokeFunction`, are still used by
  `Base44LeadAdminService.ts`, `Base44LeadService.ts`, and
  `Base44SupportService.ts`, none of which this piece touches, so the file
  itself stays.
- In `src/services/index.ts`: `authPort`, `accountPort` and the
  `ContentAdminPort` branch all currently key off
  `AUTH_PROVIDER === "supabase" && supabase`. Replace each with the
  unconditional Supabase construction (`SupabaseAuthService`,
  `SupabaseAccountService`, `FunctionContentAdminService`). `UploadPort`'s
  own `VITE_UPLOAD_PROVIDER` switch is untouched — it's a separate flag with
  its own lifecycle.
- Delete the `Base44AccountService` and `failureOf` test blocks in
  `tests/unit/account-services.test.ts` (lines 1, 4, 6, 57-97, 99-115 as of
  this writing) — the `toEnquiry` and `SupabaseAccountService` blocks stay.
- Confirm the three e2e specs pass identically with no env override, in
  both a local run and CI, as the regression test for this piece.

**Out — explicitly deferred, not silently dropped:**
- The 7 Base44-restored legacy auth pages/components
  (`src/pages/{Login,Register,ForgotPassword,ResetPassword,OAuthConsent}.jsx`,
  `src/components/{AuthLayout,GoogleIcon}.jsx`) stay exactly as they are.
  AGENTS.md documents five prior deletion attempts and one two-day `main`
  outage from the fifth; Base44 restores them regardless of what git says
  for as long as Base44 still hosts the app environment, which this piece
  does not change. The current accommodation —
  `vite.config.js`'s `.tsx`-before-`.jsx` resolve order, the matching eslint
  ignores, and `PLATFORM_AUTH_PAGES` in
  `tests/contract/frontend-payloads.contract.test.ts` — is left untouched.
- Password sign-in stays live in `SupabaseAuthService.signInWithPassword`
  and on Supabase's auth server, even though the parent spec's decision
  table says "Google SSO only." Removing it is a UI and product decision
  (does the login page's password form disappear too?), not a mechanical
  consequence of retiring Base44.
- No enforcement point for domain restriction (Google's `hd` is a hint, not
  a control) and no automation for admin bootstrap (still the one hand-run
  SQL insert). Both were already open items in the parent spec.
- `base44/functions/myAccount`: once `Base44AccountService` is deleted,
  nothing in `src/` calls it anymore, but the function, its integration
  test (`tests/integration/my-account.integration.test.ts`), and its
  mentions in `base44/agents/COMPLIANCE.md` and the test-plan docs are left
  in place. Deleting a function that compliance documentation references is
  its own decision with its own review, not a side effect of a frontend
  adapter cleanup.

## Rollout

Hard cutover, no transitional flag. The Supabase path was proven against
production data in September; keeping `Base44AuthService` alive as a safety
net for one more release would mean maintaining two auth code paths to
de-risk a path that's already de-risked. After merge: a manual sign-in
check against production (Google login as the admin account, confirm
`/admin/leads` loads) is the verification step, alongside the existing e2e
coverage for the anonymous-visitor and admin-gating cases.

## Known one-time user impact

Any visitor who previously signed in to `/account` through Base44's Google
login will need to sign in again after this ships. Same Google identity, a
new Supabase session; `enquiries_for` matches on verified email, so no data
is lost — just a one-time re-login, not a silent break. Worth knowing before
a support message arrives about it, not worth blocking the cutover over.

## Testing

- `tests/unit/account-services.test.ts`: trimmed as described above; stays
  green for the `SupabaseAccountService` and `toEnquiry` cases.
- `e2e/ui/navigation.spec.ts`, `e2e/security/security.spec.ts`,
  `e2e/ui/account.spec.ts`: these are the regression test for this whole
  piece — they exercise admin-route gating and the login redirect through
  whichever `AuthPort` is wired, and should behave identically once there's
  only one path to test instead of two.
- `tests/contract/frontend-payloads.contract.test.ts`'s "only the
  composition root names a concrete implementation" check
  (lines 285-291) continues to hold trivially — there's one fewer concrete
  implementation to name, not a new exception to carve out.
- No new test infrastructure. This is a deletion-heavy change; the
  existing suite is the regression net for it.
