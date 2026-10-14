import { describe, expect, it } from "vitest";
import {
  DEFAULT_LEGACY_HOSTS,
  isLegacyHost,
  legacyHostPlan,
  parseLegacyHosts,
  type LegacyLocation,
} from "@/lib/legacy-host";

// The old Base44 host is also the backend: Vercel rewrites /api and
// /ws-user-apps to it, and the agents' socket opens there. These pin what a
// page booted on it does, and that nothing else is touched.

const OLD = "safe-arch-plan.base44.app";
const PROD = "https://govari-fin.co.il";
const opts = { siteUrl: PROD, topLevel: true, hosts: DEFAULT_LEGACY_HOSTS };

const at = (url: string): LegacyLocation => {
  const u = new URL(url);
  return { hostname: u.hostname, pathname: u.pathname, search: u.search, hash: u.hash };
};

describe("which hosts count as the old one", () => {
  it("defaults to exactly the old production host", () => {
    expect(DEFAULT_LEGACY_HOSTS).toEqual([OLD]);
    expect(parseLegacyHosts(undefined)).toEqual([OLD]);
    expect(parseLegacyHosts("  ")).toEqual([OLD]);
  });

  it("is configurable, and `none` turns it off", () => {
    expect(parseLegacyHosts("a.example, B.Example.")).toEqual(["a.example", "b.example"]);
    expect(parseLegacyHosts("https://a.example/")).toEqual(["a.example"]);
    expect(parseLegacyHosts("none")).toEqual([]);
  });

  it("matches the exact host only — never the Builder's preview hosts or other base44.app apps", () => {
    expect(isLegacyHost(OLD, [OLD])).toBe(true);
    expect(isLegacyHost("SAFE-ARCH-PLAN.base44.app.", [OLD])).toBe(true);
    for (const other of [
      "preview--safe-arch-plan.base44.app",
      "preview-sandbox--68d1.base44.app",
      "safe-arch-plan.base44.app.evil.example",
      "base44.app",
      "app.base44.com",
      "68d1abc.modal.host",
      "govari-fin.co.il",
      "www.govari-fin.co.il",
      "localhost",
      "127.0.0.1",
      "",
    ]) {
      expect(isLegacyHost(other, [OLD]), other).toBe(false);
    }
  });
});

describe("legacyHostPlan — a page on the old host", () => {
  it("redirects to the same path, query and fragment on the production domain", () => {
    expect(legacyHostPlan(at(`https://${OLD}/faq?utm_source=wa&x=1#q3`), opts)).toEqual({
      kind: "redirect",
      target: `${PROD}/faq?utm_source=wa&x=1#q3`,
    });
    expect(legacyHostPlan(at(`https://${OLD}/`), opts)).toEqual({ kind: "redirect", target: `${PROD}/` });
    expect(legacyHostPlan(at(`https://${OLD}/blog/horadat-dmei-nihul`), opts)).toEqual({
      kind: "redirect",
      target: `${PROD}/blog/horadat-dmei-nihul`,
    });
    expect(legacyHostPlan(at(`https://${OLD}/#about`), opts)).toEqual({
      kind: "redirect",
      target: `${PROD}/#about`,
    });
  });

  it("moves sign-in and admin pages too, when no sign-in is in flight", () => {
    for (const path of ["/login", "/login?returnTo=%2Fadmin%2Fleads", "/admin/leads", "/account"]) {
      expect(legacyHostPlan(at(`https://${OLD}${path}`), opts)).toEqual({
        kind: "redirect",
        target: `${PROD}${path}`,
      });
    }
  });

  it("cannot be turned into a redirect to another host by the path", () => {
    const plan = legacyHostPlan({ hostname: OLD, pathname: "//evil.example/x", search: "", hash: "" }, opts);
    expect(plan).toEqual({ kind: "redirect", target: `${PROD}/evil.example/x` });
  });

  it("never touches the backend paths that share the host", () => {
    for (const path of ["/api", "/api/apps/abc/functions/submitLead", "/ws-user-apps", "/ws-user-apps/socket.io/"]) {
      expect(legacyHostPlan(at(`https://${OLD}${path}`), opts)).toEqual({ kind: "stay", reason: "backend-path" });
    }
    // A prefix is a path segment, not a string prefix.
    expect(legacyHostPlan(at(`https://${OLD}/apiary`), opts).kind).toBe("redirect");
  });

  it("leaves a sign-in in flight on the origin that holds its state", () => {
    for (const url of [
      `https://${OLD}/login?code=abc`,
      `https://${OLD}/?code=abc&state=x`,
      `https://${OLD}/?error=access_denied&error_description=nope`,
      `https://${OLD}/#access_token=t&refresh_token=r&type=recovery`,
      `https://${OLD}/?access_token=t`,
      `https://${OLD}/login?from_url=https%3A%2F%2F${OLD}%2F`,
      `https://${OLD}/?clear_access_token=true`,
      `https://${OLD}/confirm?token_hash=h&type=signup`,
    ]) {
      expect(legacyHostPlan(at(url), opts), url).toEqual({ kind: "stay", reason: "auth-in-flight" });
    }
  });

  it("leaves the platform's own auth pages where the platform sent them", () => {
    for (const path of ["/register", "/forgot-password", "/reset-password", "/oauth/consent"]) {
      expect(legacyHostPlan(at(`https://${OLD}${path}`), opts)).toEqual({
        kind: "stay",
        reason: "platform-auth-page",
      });
    }
  });

  it("stays inside a frame, which production refuses to be shown in", () => {
    expect(legacyHostPlan(at(`https://${OLD}/faq`), { ...opts, topLevel: false })).toEqual({
      kind: "stay",
      reason: "framed",
    });
  });

  it("never redirects to itself, to another old host, or to a non-https origin", () => {
    for (const siteUrl of [`https://${OLD}`, "https://other-old.example", "http://govari-fin.co.il", "not a url"]) {
      expect(
        legacyHostPlan(at(`https://${OLD}/faq`), { ...opts, siteUrl, hosts: [OLD, "other-old.example"] }),
        siteUrl,
      ).toEqual({ kind: "stay", reason: "no-other-origin" });
    }
  });

  it("does nothing when the switch is off", () => {
    expect(legacyHostPlan(at(`https://${OLD}/faq`), { ...opts, hosts: parseLegacyHosts("none") })).toEqual({
      kind: "none",
    });
  });
});

describe("legacyHostPlan — every other host is left alone", () => {
  it("production, its www alias, a Vercel preview, the Builder preview and localhost", () => {
    for (const url of [
      `${PROD}/faq?code=abc`,
      "https://www.govari-fin.co.il/",
      "https://dorit-finance-site-git-x.vercel.app/faq",
      "https://preview-sandbox--68d1.base44.app/faq",
      "https://68d1abc.modal.host/",
      "http://127.0.0.1:4173/faq",
      "http://localhost:5173/",
    ]) {
      expect(legacyHostPlan(at(url), opts), url).toEqual({ kind: "none" });
      expect(legacyHostPlan(at(url), { ...opts, topLevel: false }), url).toEqual({ kind: "none" });
    }
  });
});
