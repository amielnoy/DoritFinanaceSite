// מעקב אירועי לידים ל-GA4. Lead events for Google Analytics 4.
//
// What a visitor did, never who they are: no name, phone, email, message or
// chat content reaches Google. `track` enforces that by passing on only the
// parameters it knows, so a caller cannot leak a field by adding it. A blocked
// or broken tag must never break the page, so every call is guarded and none
// throws. And the agency's own browsing is marked `traffic_type: internal`, so
// a GA4 filter can drop it.

import { getAttribution } from "./attribution";

const INTERNAL_KEY = "ga_internal_user";

/** The only parameters an event may carry. Anything else is dropped. */
const ALLOWED_PARAMS = ["location", "cta", "method", "channel", "lead_source", "lead_campaign"] as const;
type Param = (typeof ALLOWED_PARAMS)[number];
export type TrackParams = Partial<Record<Param, string>>;

type Gtag = (command: "event", name: string, params: Record<string, string>) => void;
const gtagOf = (): Gtag | null => {
  const g = (window as unknown as { gtag?: unknown }).gtag;
  return typeof g === "function" ? (g as Gtag) : null;
};

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** True when this browser is marked as the agency's own. */
export function isInternalBrowser(): boolean {
  try {
    return storage()?.getItem(INTERNAL_KEY) === "1";
  } catch {
    return false;
  }
}

/** Mark or unmark this browser as the agency's own. */
export function setInternalBrowser(internal: boolean): void {
  try {
    if (internal) storage()?.setItem(INTERNAL_KEY, "1");
    else storage()?.removeItem(INTERNAL_KEY);
  } catch {
    /* storage blocked — the flag simply does not stick */
  }
}

/** `?internal=1` marks this browser once; `?internal=0` clears it. */
export function initInternalFlag(): void {
  try {
    const flag = new URLSearchParams(window.location.search).get("internal");
    if (flag === "1") setInternalBrowser(true);
    if (flag === "0") setInternalBrowser(false);
  } catch {
    /* ignore */
  }
}

/** Send one event to GA4. Never throws; does nothing when the tag is absent. */
export function track(eventName: string, params: Record<string, unknown> = {}): void {
  try {
    const gtag = gtagOf();
    if (!gtag) return;
    const payload: Record<string, string> = {};
    for (const key of ALLOWED_PARAMS) {
      const value = params[key];
      if (typeof value === "string" && value) payload[key] = value;
    }
    // Attached to every event, not just lead events, so any event in GA4 can
    // be sliced by channel — and so no call site has to remember to pass it.
    const attribution = getAttribution();
    if (attribution) {
      payload.lead_source = attribution.channel;
      if (attribution.campaign) payload.lead_campaign = attribution.campaign;
    }
    if (isInternalBrowser()) payload.traffic_type = "internal";
    gtag("event", eventName, payload);
  } catch {
    /* tracking must never break the site */
  }
}

/** Where on the page a click happened: `data-track-location`, else the nearest section's id. */
function locationOf(el: Element): string {
  const tagged = el.closest("[data-track-location]");
  if (tagged) return tagged.getAttribute("data-track-location") || "unknown";
  const section = el.closest("section[id], header, footer, nav");
  if (!section) return "unknown";
  return section.id || section.tagName.toLowerCase();
}

/**
 * One listener for the whole site: phone, WhatsApp, mail, and every
 * "לשיחה קצרה עם דורית" link to `#start`. Capture phase, so it sees a click
 * before a handler that prevents it, and links added after load are covered.
 */
export function initClickTracking(): void {
  const w = window as unknown as { __leadTrackingInit?: boolean };
  if (w.__leadTrackingInit) return;
  w.__leadTrackingInit = true;

  document.addEventListener(
    "click",
    (e) => {
      try {
        const target = e.target as Element | null;
        const link = target?.closest?.("a[href]");
        if (!link) return;
        const href = link.getAttribute("href") || "";
        const location = locationOf(link);
        if (href.startsWith("tel:")) track("click_phone", { location });
        else if (href.includes("wa.me") || href.includes("api.whatsapp.com")) track("click_whatsapp", { location });
        else if (href.startsWith("mailto:")) track("click_email", { location });
        else if (href === "#start" || href.endsWith("/#start")) track("cta_click", { location, cta: "start_conversation" });
      } catch {
        /* ignore */
      }
    },
    { capture: true }
  );
}

/** Which chat an event came from, by agent. */
export type ChatMethod = "ai_interview" | "ai_support" | "ai_procedures" | "ai_blog";

/** Calls made from components, at the moment each thing actually happened. */
export const leadEvents = {
  /** The short contact form, once the lead is saved — not on the click. */
  formSubmitted: () => track("generate_lead", { method: "contact_form" }),
  /** A claim report, once it is saved — ClaimForm fired no GA4 event at all before this. */
  claimSubmitted: () => track("generate_lead", { method: "claim" }),
  /** The interview's summary, once the page has submitted it and it saved. */
  interviewCompleted: () => track("generate_lead", { method: "ai_interview" }),
  chatStarted: (method: ChatMethod) => track("chat_start", { method }),
  /** Opening the hand-off panel — a request, not yet a lead. See `handoffCompleted`. */
  chatHandoff: (method: ChatMethod) => track("chat_handoff", { method }),
  /** The hand-off form, once `escalateToHuman` has actually reached דורית. */
  handoffCompleted: (method: ChatMethod) => track("generate_lead", { method }),
  preferredChannel: (channel: "whatsapp" | "phone") => track("preferred_channel_click", { channel }),
};

/**
 * Every event this site sends, for the admin panel — so what it lists cannot
 * drift from what is sent (`analytics.dom.test.ts` checks the two agree).
 */
export const LEAD_EVENTS: ReadonlyArray<{
  name: string;
  meaning: string;
  when: string;
  keyEvent: boolean;
}> = [
  { name: "generate_lead", meaning: "ליד שנשמר", when: "טופס יצירת קשר, סיכום ראיון או בקשת מעבר לדורית בצ׳אט שנשמרו בהצלחה (method מבחין ביניהם)", keyEvent: true },
  { name: "click_phone", meaning: "לחיצה על טלפון", when: "כל קישור חיוג באתר (location אומר מאיפה)", keyEvent: true },
  { name: "click_whatsapp", meaning: "לחיצה על וואטסאפ", when: "כל קישור וואטסאפ באתר", keyEvent: true },
  { name: "click_email", meaning: "לחיצה על מייל", when: "כל קישור מייל באתר", keyEvent: false },
  { name: "cta_click", meaning: "לחיצה על \"לשיחה קצרה עם דורית\"", when: "כל קישור לראיון ההיכרות", keyEvent: false },
  { name: "chat_start", meaning: "התחלת שיחה עם עוזר", when: "אישור ההסכמה ולחיצה על \"התחלת השיחה\" (method: איזה צ׳אט)", keyEvent: false },
  { name: "chat_handoff", meaning: "בקשה לעבור לדורית", when: "לחיצה על \"מעבר לדורית\" בצ׳אט — ה-key event הוא generate_lead, ברגע שההעברה אכן הושלמה", keyEvent: false },
  { name: "preferred_channel_click", meaning: "בחירת ערוץ מועדף", when: "שמור לכפתור ערוץ שאינו קישור ישיר — כרגע אין כזה", keyEvent: false },
];

/** The GA4 property the site reports to, from the tag in index.html. */
export const GA4_MEASUREMENT_ID = "G-LLSYPMGV58";

/** True when the tag loaded in this browser (an ad blocker stops it). */
export function isTagLoaded(): boolean {
  return gtagOf() !== null;
}
