// The id from the profile, not from analytics.ts: that module imports this one (measureRoute).
import { AGENCY_PROFILE } from "@/config/agencyProfile";

const GA4_MEASUREMENT_ID = AGENCY_PROFILE.ga4MeasurementId;

/**
 * Consent for Google Analytics (docs/COMPLIANCE.md §8), behind
 * VITE_GA_CONSENT. Off, GA4 loads on every page as it always has: the inline
 * script in index.html loads it. On, that script loads it only for a browser
 * that already agreed, and the banner (ConsentBanner) asks everyone else;
 * until then `gtag` does not exist, so track() sends nothing and nothing is
 * queued for later.
 *
 * The flag reaches index.html through `<meta name="ga-consent">`, not through
 * the inline script's text, so that script — and its CSP hash in vercel.json —
 * is the same with the flag on or off.
 */
export const isGaConsentOn = (value: string | undefined): boolean => (value ?? "").trim() === "true";
export const GA_CONSENT: boolean = isGaConsentOn(import.meta.env.VITE_GA_CONSENT);

/** The localStorage key index.html's inline script reads too. Keep the two equal. */
export const CONSENT_KEY = "ga-consent";
export type ConsentChoice = "granted" | "denied";

/** Fired when the footer's "הגדרות עוגיות" asks for the banner again. */
export const CONSENT_REOPEN_EVENT = "ga-consent:reopen";

export function readConsent(): ConsentChoice | null {
  try {
    const v = window.localStorage.getItem(CONSENT_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

function store(choice: ConsentChoice | null): void {
  try {
    if (choice) window.localStorage.setItem(CONSENT_KEY, choice);
    else window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Private mode or blocked storage: the choice holds for this page only.
  }
}

/**
 * Whether GA4 must stay off for want of a "yes": the flag is on and the stored
 * choice is not "granted". measureRoute (analytics.ts) keeps Google's opt-out
 * set while this holds, so a route change can never switch a declined GA4 back on.
 */
export function analyticsWithheld(enabled: boolean = GA_CONSENT): boolean {
  return enabled && readConsent() !== "granted";
}

/**
 * Every domain a GA cookie may sit on for this host: none (host-only), the
 * host itself and each parent down to two labels. GA4 sets `_ga` on the
 * registrable domain, `.govari-fin.co.il` — three labels — so the last two
 * labels alone (`.co.il`) would miss it.
 */
export function cookieDomains(hostname: string): string[] {
  const labels = hostname.split(".").filter(Boolean);
  const out = [""];
  for (let i = 0; i <= labels.length - 2; i += 1) out.push(`.${labels.slice(i).join(".")}`);
  return out;
}

type Win = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void } & Record<string, unknown>;

const TAG_SRC = (id: string) => `https://www.googletagmanager.com/gtag/js?id=${id}`;

/**
 * What index.html's inline script does for a browser that agreed: define
 * gtag, configure GA4, add the library once. Idempotent.
 */
export function loadAnalytics(id: string = GA4_MEASUREMENT_ID): void {
  const w = window as unknown as Win;
  w.dataLayer = w.dataLayer || [];
  if (!w.gtag) {
    w.gtag = function gtag() {
      // gtag.js reads the arguments object itself, not an array.
      // eslint-disable-next-line prefer-rest-params
      (w.dataLayer as unknown[]).push(arguments);
    };
    if (/^\/admin(\/|$)/.test(window.location.pathname)) w[`ga-disable-${id}`] = true;
    w.gtag("js", new Date());
    w.gtag("config", id);
  }
  if (!document.querySelector(`script[src^="https://www.googletagmanager.com/gtag/js"]`)) {
    const s = document.createElement("script");
    s.async = true;
    s.src = TAG_SRC(id);
    document.head.appendChild(s);
  }
}

/** "אישור": remember it, lift a pause from an earlier "no" or reopen, and load GA4 now. */
export function grantConsent(id: string = GA4_MEASUREMENT_ID): void {
  store("granted");
  (window as unknown as Win)[`ga-disable-${id}`] = /^\/admin(\/|$)/.test(window.location.pathname);
  loadAnalytics(id);
}

/**
 * "לא, תודה": remember it. If GA4 was already running on this page (an earlier
 * "yes", changed from the footer), stop it sending and remove its cookies.
 */
export function declineConsent(id: string = GA4_MEASUREMENT_ID): void {
  store("denied");
  const w = window as unknown as Win;
  w[`ga-disable-${id}`] = true;
  if (typeof w.gtag === "function") {
    w.gtag("consent", "update", { analytics_storage: "denied" });
    // track() sends only through gtag: without it nothing more is sent or queued.
    delete w.gtag;
  }
  const domains = cookieDomains(window.location.hostname);
  for (const name of document.cookie.split(";").map((c) => c.split("=")[0].trim())) {
    if (name === "_ga" || name.startsWith("_ga_")) {
      for (const domain of domains) {
        document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ""}`;
      }
    }
  }
}

/** The footer's link: forget the choice and show the banner again. */
export function reopenConsent(id: string = GA4_MEASUREMENT_ID): void {
  store(null);
  // No choice is not a "yes": GA4 pauses until the visitor answers again.
  (window as unknown as Win)[`ga-disable-${id}`] = true;
  window.dispatchEvent(new Event(CONSENT_REOPEN_EVENT));
}
