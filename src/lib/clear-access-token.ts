/**
 * `?clear_access_token=true` wipes any Base44 token this browser holds
 * (SEC-TOK-002, tests/test-plan/04-std-security.md).
 *
 * This used to happen only in app-params.js, at the moment that module was
 * first evaluated. Since the services load lazily (#158), that moment is "the
 * first time some page calls a backend port", and a visit that never does
 * (the anonymous home page on a Supabase build, any static route, a prerendered
 * article) never wiped anything. Worse: a client-side navigation drops the
 * query, so a later chat or form loaded the SDK with no flag in sight and sent
 * the stale token as a Bearer.
 *
 * So main.jsx runs this at boot, before React and before any SDK. It imports
 * nothing, which keeps #158's lazy loading intact. The flag is removed from the
 * URL afterwards: the wipe is done, and a bookmark or a shared link should not
 * carry it on. Every other parameter, `?access_token=` included, stays where
 * app-params.js expects to read it.
 */
const TOKEN_KEYS = ["base44_access_token", "token"] as const;

export function clearAccessTokenIfRequested(): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  if (url.searchParams.get("clear_access_token") !== "true") return false;

  for (const key of TOKEN_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage is blocked (privacy mode, sandboxed frame): nothing was stored.
    }
  }

  // The absolute URL, not `pathname + search + hash`: a path that starts with
  // `//` would read as protocol-relative, name another origin, and make
  // replaceState throw. And this runs at the top of main.jsx, before React, so
  // nothing in it may throw — the wipe is done either way.
  url.searchParams.delete("clear_access_token");
  try {
    window.history.replaceState(window.history.state, "", url.href);
  } catch {
    // The flag stays in the address bar; the tokens are already gone.
  }
  return true;
}
