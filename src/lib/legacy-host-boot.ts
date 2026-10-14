/**
 * The boot-time half of `legacy-host.ts`: reads where this page is, fixes its
 * head, and moves it to the production domain when it may.
 *
 * Called first thing in main.jsx, before React, the SDK or any request the app
 * makes. Returns true when the page is leaving, and main.jsx then renders
 * nothing: no analytics beacon, no backend call, no chat — the visitor is on
 * the way to the copy that does all of that. A short notice with a link is put
 * in the page meanwhile, in case the navigation is slow or refused.
 */

import { legacyHostPlan, type LegacyHostPlan } from "./legacy-host";
import { SITE_URL, applyLegacyHostHead } from "./seo";

type BootWindow = Pick<Window, "location" | "self" | "top" | "document">;

export function leaveLegacyHost(win: BootWindow = window, siteUrl: string = SITE_URL): boolean {
  let plan: LegacyHostPlan;
  try {
    plan = legacyHostPlan(win.location, {
      siteUrl,
      // Reading `top` across origins is allowed; comparing it is all this does.
      topLevel: win.self === win.top,
    });
  } catch {
    // Nothing here may stop the site from booting.
    return false;
  }
  if (plan.kind === "none") return false;

  applyLegacyHostHead(win.location.pathname);
  if (plan.kind === "stay") return false;

  showMovedNotice(win.document, plan.target);
  try {
    // `replace`, not `assign`: the old address should not sit in the history
    // for Back to return to, and bounce forward again.
    win.location.replace(plan.target);
  } catch {
    // The notice's link still works.
  }
  return true;
}

/** Built with DOM calls, never markup: the target carries the visitor's query. */
function showMovedNotice(doc: Document, target: string): void {
  const root = doc.getElementById("root");
  if (!root) return;
  const p = doc.createElement("p");
  p.setAttribute("dir", "rtl");
  p.style.cssText = "font: 18px/1.6 system-ui, sans-serif; text-align: center; padding: 3rem 1rem;";
  p.append("האתר עבר לכתובת ");
  const a = doc.createElement("a");
  a.href = target;
  a.textContent = new URL(target).host;
  p.append(a);
  root.replaceChildren(p);
}
