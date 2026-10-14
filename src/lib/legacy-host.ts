/**
 * The old Base44 address, and what a page does when it finds itself served there.
 *
 * Base44 goes on publishing a complete copy of the site at
 * `safe-arch-plan.base44.app` after production moved to `govari-fin.co.il`, and
 * that copy competes with the real site for the same content. A server-side
 * `301` would be the right answer, and Base44's hosting cannot give one: its
 * site config has four fields (install, build, serve and output directory), and
 * the CLI's deploy says of a `_redirects` or `_headers` file that it is "not
 * supported yet" and ignores it. So the page does it itself: on that host it
 * declares the production URL canonical, asks not to be indexed, and moves the
 * visitor to the same address on the production domain.
 *
 * That same host is also the backend: Vercel rewrites `/api/*` and
 * `/ws-user-apps/*` to it, and the agents' socket opens there. Nothing here can
 * reach any of that. This runs only inside a page the app's own HTML booted —
 * never for an API call, an asset, a socket or anything else the host serves —
 * and even then it refuses the backend paths, in case one is ever opened in a
 * tab.
 *
 * Pure: no DOM, no `window`. `legacy-host-boot.ts` does the wiring.
 */

type Env = Record<string, string | undefined> | undefined;

// Read the same way `seo.ts` reads its env: `seo.ts` imports this module, and
// the Vercel functions under api/ import `seo.ts` in a Node runtime that has no
// `import.meta.env`.
const viteEnv = (import.meta as unknown as { env?: Env }).env;

/** The production host Base44 still serves a copy of the site on. */
export const DEFAULT_LEGACY_HOSTS: readonly string[] = ["safe-arch-plan.base44.app"];

/** A hostname as `location.hostname` gives it: lower case, no trailing dot. */
export function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase();
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return "";
    }
  }
  return host.replace(/\.+$/, "");
}

/**
 * `VITE_LEGACY_HOSTS`, a comma-separated list of exact hostnames, replaces the
 * default. `none` turns the whole behaviour off — the switch to reach for if it
 * ever misbehaves, set in the Base44 Builder's environment and published.
 * Exact names only: the Builder's own preview runs on other hosts, and a
 * pattern that matched them would move the editor's preview off the editor.
 */
export function parseLegacyHosts(value: string | undefined): string[] {
  const raw = value?.trim();
  if (!raw) return [...DEFAULT_LEGACY_HOSTS];
  if (raw.toLowerCase() === "none") return [];
  return raw.split(",").map(normalizeHost).filter(Boolean);
}

export const LEGACY_HOSTS: readonly string[] = parseLegacyHosts(viteEnv?.VITE_LEGACY_HOSTS);

export function isLegacyHost(hostname: string, hosts: readonly string[] = LEGACY_HOSTS): boolean {
  const host = normalizeHost(hostname);
  return host !== "" && hosts.includes(host);
}

/**
 * Paths that belong to the backend on that host. A page never boots there in
 * normal use, so this is a second lock, not the first.
 */
export const BACKEND_PATH_PREFIXES: readonly string[] = ["/api", "/ws-user-apps"];

/**
 * Pages the Base44 platform itself sends people to on the app's own host
 * (`Register.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx` and
 * `OAuthConsent.jsx` are its templates — see AGENTS.md). Their flows carry
 * state that belongs to the host they started on, so they stay there.
 */
export const PLATFORM_AUTH_PATH_PREFIXES: readonly string[] = [
  "/register",
  "/forgot-password",
  "/reset-password",
  "/oauth",
];

/**
 * Query or fragment parameters that mean a sign-in is in flight. Each belongs
 * to the origin it arrived on: Supabase's PKCE `code` can only be exchanged
 * with the verifier this origin's storage holds, an implicit-flow
 * `#access_token` would be handed to another origin in the URL, and Base44's
 * hand-off parameters (`access_token`, `from_url`, …) are read by app-params
 * on the host they were sent to. Moving any of them breaks the sign-in.
 */
export const AUTH_PARAMS: readonly string[] = [
  "access_token",
  "refresh_token",
  "provider_token",
  "code",
  "error",
  "error_code",
  "error_description",
  "token",
  "token_hash",
  "from_url",
  "clear_access_token",
  "app_id",
  "app_base_url",
  "functions_version",
];

export interface LegacyLocation {
  hostname: string;
  pathname: string;
  search: string;
  hash: string;
}

export interface LegacyHostOptions {
  /** The canonical origin (`SITE_URL`). */
  siteUrl: string;
  /** `window.self === window.top`. */
  topLevel: boolean;
  hosts?: readonly string[];
}

export type StayReason =
  | "framed"
  | "backend-path"
  | "platform-auth-page"
  | "auth-in-flight"
  | "no-other-origin";

export type LegacyHostPlan =
  /** Not the old host: nothing changes. */
  | { kind: "none" }
  /** The old host, but this page must stay: still noindex, still canonical elsewhere. */
  | { kind: "stay"; reason: StayReason }
  /** The old host: go to `target`. */
  | { kind: "redirect"; target: string };

const underPrefix = (pathname: string, prefixes: readonly string[]) =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

function carriesAuth(search: string, hash: string): boolean {
  const query = new URLSearchParams(search);
  // A fragment is a query string only by convention (`#access_token=…&type=…`),
  // so it is read that way and nothing worse happens to `#about`.
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  return AUTH_PARAMS.some((p) => query.has(p) || fragment.has(p));
}

/** The canonical origin, or null when it is unusable or is itself the old host. */
function targetOrigin(siteUrl: string, hostname: string, hosts: readonly string[]): string | null {
  let url: URL;
  try {
    url = new URL(siteUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  // The loop guard: never send a visitor to the host they are on, or to
  // another one this list also moves away from.
  if (normalizeHost(url.hostname) === normalizeHost(hostname) || isLegacyHost(url.hostname, hosts)) return null;
  return url.origin;
}

/**
 * What this page should do about the host it was served on.
 *
 * The redirect keeps the path, the query (UTM tags reach the attribution code on
 * the other side) and the fragment (`/#about`). It runs once, at boot: a
 * conversation in progress in an open tab is never cut off by it.
 */
export function legacyHostPlan(loc: LegacyLocation, options: LegacyHostOptions): LegacyHostPlan {
  const hosts = options.hosts ?? LEGACY_HOSTS;
  if (!isLegacyHost(loc.hostname, hosts)) return { kind: "none" };

  // In a frame — the Base44 dashboard showing the published app — a redirect
  // would only blank the frame: production refuses to be framed
  // (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`).
  if (!options.topLevel) return { kind: "stay", reason: "framed" };
  if (underPrefix(loc.pathname, BACKEND_PATH_PREFIXES)) return { kind: "stay", reason: "backend-path" };
  if (underPrefix(loc.pathname, PLATFORM_AUTH_PATH_PREFIXES)) {
    return { kind: "stay", reason: "platform-auth-page" };
  }
  if (carriesAuth(loc.search, loc.hash)) return { kind: "stay", reason: "auth-in-flight" };

  const origin = targetOrigin(options.siteUrl, loc.hostname, hosts);
  if (!origin) return { kind: "stay", reason: "no-other-origin" };

  // Built from the parts, never by handing the path to `new URL(path, origin)`:
  // a path that begins `//` would read as another host.
  const path = loc.pathname.startsWith("/") ? loc.pathname.replace(/^\/+/, "/") : `/${loc.pathname}`;
  return { kind: "redirect", target: `${origin}${path}${loc.search}${loc.hash}` };
}
