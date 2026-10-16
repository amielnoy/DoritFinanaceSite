// מעקב אירועי לידים ל-GA4. Lead events for Google Analytics 4.
//
// What a visitor did, never who they are: no name, phone, email, message or
// chat content reaches Google. `track` enforces that by passing on only the
// parameters it knows, so a caller cannot leak a field by adding it. A blocked
// or broken tag must never break the page, so every call is guarded and none
// throws. And the agency's own browsing is marked `traffic_type: internal`, so
// a GA4 filter can drop it.

import { getAttribution } from "./attribution";
import { AGENCY_PROFILE } from "@/config/agencyProfile";
import { CONCERNS, URGENCY } from "@/config/needs-wizard";

const INTERNAL_KEY = "ga_internal_user";

/** The only parameters an event may carry. Anything else is dropped. */
const ALLOWED_PARAMS = ["location", "cta", "method", "channel", "lead_source", "lead_campaign", "tool", "topic", "urgency", "field", "answered"] as const;
type Param = (typeof ALLOWED_PARAMS)[number];
export type TrackParams = Partial<Record<Param, string>>;

/**
 * The calculators on /tools, by the name `calculator_result` reports. `tool`
 * may carry only one of these: anything else is dropped, so a figure the
 * calculator showed cannot reach Google in it.
 */
export const CALCULATOR_TOOLS = ["fee_calculator", "insurance_assessment", "retirement_projection", "coverage_check"] as const;
export type CalculatorTool = (typeof CALCULATOR_TOOLS)[number];

/** Parameters whose value must come from a closed list. */
const CLOSED_VALUES: Partial<Record<Param, readonly string[]>> = {
  tool: CALCULATOR_TOOLS,
  // The questionnaire's lead carries its topic and urgency (the user's choice of
  // 2026-10-14) — only these labels, never another answer, a name or a phone.
  topic: CONCERNS.map((c) => c.label),
  urgency: URGENCY.options,
  field: ["name", "phone"],
  answered: ["0", "1", "2", "3"],
};

/**
 * The support chat's anchor (`AGENTS.support.sectionId`; a unit test holds the
 * two together). Spelled here rather than imported, so this module does not
 * pull the agents' config — icons and all — into every page.
 */
export const SUPPORT_CHAT_HASH = "#support-chat";

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

/** The screens GA4 never measures: the admin area, whose URLs carry searches and record ids. */
export const isUnmeasuredPath = (pathname: string): boolean => /^\/admin(\/|$)/.test(pathname);

/**
 * Google's own opt-out, set for the route on screen (review 2026-10-15). The
 * history page views GA4 sends by itself ignore `send_page_view: false` and
 * any `page_location` override, so on /admin the tag is switched off whole:
 * no page view, no query string, no event. index.html sets the same flag for
 * a page that loads on /admin, before the tag is configured.
 */
export function measureRoute(pathname: string): void {
  try {
    (window as unknown as Record<string, unknown>)[`ga-disable-${GA4_MEASUREMENT_ID}`] = isUnmeasuredPath(pathname);
  } catch {
    /* ignore */
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
      if (typeof value !== "string" || !value) continue;
      const closed = CLOSED_VALUES[key];
      if (closed && !closed.includes(value)) continue;
      payload[key] = value;
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
 * One listener for the whole site: phone, WhatsApp, mail, every
 * "לשיחה קצרה עם דורית" link to `#start`, and every link to the support chat
 * (`/faq#support-chat` — the header menu, the sticky bar, the desktop dock).
 * Capture phase, so it sees a click before a handler that prevents it, and
 * links added after load are covered.
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
        else if (/^(https:\/\/[^/]+)?(\/(en|fr))?\/pension-check\/?$/.test(href)) track("cta_click", { location, cta: "pension_check" });
        else if (href.endsWith(SUPPORT_CHAT_HASH)) track("click_chat", { location });
        else if (/^https:\/\/([a-z0-9-]+\.)*cal\.com\//i.test(href)) track("click_booking", { location });
        else if (/^https:\/\/(www\.)?whatsapp\.com\/channel\//i.test(href)) track("join_channel", { location });
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
  /** The Har HaBituach check's summary sent to Dorit, once it is saved (/tools, בדיקת כפל ביטוחים). */
  coverageCheckSubmitted: () => track("generate_lead", { method: "coverage_check" }),
  /** "בדיקת תיק פנסיוני", once saved — the flagship's own method, from wherever its form sat. */
  pensionCheckSubmitted: (location: string) => track("generate_lead", { method: "pension_check", location }),
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
  /** The needs wizard's first answer — the visitor started, not yet a lead. */
  wizardStarted: () => track("wizard_start", { method: "needs_wizard" }),
  /**
   * A wizard screen completed, by its number and nothing else. `location`
   * carries the step because it is already on the allow-list; the answers never
   * travel, and the list is not widened for them.
   */
  wizardStep: (step: number) => track("wizard_step", { method: "needs_wizard", location: `step_${step}` }),
  /** The wizard's summary, once `submitInterview` saved it — not on the click. */
  wizardCompleted: (topic?: string, urgency?: string) =>
    track("generate_lead", { method: "needs_wizard", ...(topic ? { topic } : {}), ...(urgency ? { urgency } : {}) }),
  /** A tap question passed by "דילוג על השאלה", by its number. */
  wizardSkipped: (step: number) => track("wizard_skip", { method: "needs_wizard", location: `step_${step}` }),
  /** The contact step refused a field — which one, never its value. */
  formError: (field: "name" | "phone") => track("form_error", { method: "needs_wizard", field }),
  /** "בטח" on the optional questions after the lead. */
  wizardFollowupStarted: () => track("wizard_followup_start", { method: "needs_wizard" }),
  /** The optional questions sent, and how many of the three were answered. */
  wizardFollowupCompleted: (answered: number) =>
    track("wizard_followup_complete", { method: "needs_wizard", answered: String(Math.max(0, Math.min(3, answered))) }),
  /** The wizard's claim route, once `escalateToHuman` actually reached דורית. */
  wizardClaimHandoff: () => track("generate_lead", { method: "needs_wizard_claim" }),
  /**
   * A chat opened on the page — the phone's card on /faq opening the support
   * layer. A link to the chat from elsewhere is `click_chat` too, sent by
   * `initClickTracking` without a `method`.
   */
  chatOpened: (method: ChatMethod, location: string) => track("click_chat", { method, location }),
  /**
   * A result the visitor produced on /tools: the tool's name, never a figure.
   * When it counts is the component's rule — see `useCalculatorResultEvent`.
   */
  calculatorResult: (tool: CalculatorTool) => track("calculator_result", { tool }),
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
  { name: "generate_lead", meaning: "ליד שנשמר", when: "טופס יצירת קשר, סיכום ראיון, שאלון ההיכרות, בדיקת תיק פנסיוני, בדיקת כפל ביטוחים או בקשת מעבר לדורית שנשמרו בהצלחה (method מבחין ביניהם; מהשאלון גם topic ו-urgency)", keyEvent: true },
  { name: "click_phone", meaning: "לחיצה על טלפון", when: "כל קישור חיוג באתר (location אומר מאיפה)", keyEvent: true },
  { name: "click_whatsapp", meaning: "לחיצה על וואטסאפ", when: "כל קישור וואטסאפ באתר", keyEvent: true },
  { name: "click_booking", meaning: "לחיצה על קביעת שיחה ביומן", when: "כל קישור ל-Cal.com (שיחת טלפון של 15 דקות) — location אומר מאיפה", keyEvent: true },
  { name: "join_channel", meaning: "הצטרפות לערוץ הוואטסאפ", when: "קישור ערוץ התזכורות החודשיות בכותרת התחתונה", keyEvent: false },
  { name: "click_email", meaning: "לחיצה על מייל", when: "כל קישור מייל באתר", keyEvent: true },
  { name: "cta_click", meaning: "לחיצה על \"לשיחה קצרה עם דורית\"", when: "כל קישור לראיון ההיכרות", keyEvent: true },
  { name: "chat_start", meaning: "התחלת שיחה עם עוזר", when: "אישור ההסכמה ולחיצה על \"התחלת השיחה\" (method: איזה צ׳אט)", keyEvent: true },
  { name: "chat_handoff", meaning: "בקשה לעבור לדורית", when: "לחיצה על \"מעבר לדורית\" בצ׳אט — כשההעברה אכן הושלמה נשלח גם generate_lead, כך שהעברה אחת נספרת פעמיים בסך ה-key events", keyEvent: true },
  { name: "wizard_start", meaning: "התחלת שאלון ההיכרות", when: "התשובה הראשונה בשאלון — עוד לא ליד", keyEvent: false },
  { name: "wizard_step", meaning: "שלב בשאלון ההיכרות", when: "מעבר מסך בשאלון (location: מספר השלב בלבד, בלי התשובות)", keyEvent: false },
  { name: "wizard_skip", meaning: "דילוג על שאלה בשאלון", when: "\"דילוג על השאלה\" באחת משלוש שאלות הלחיצה (location: מספר השאלה)", keyEvent: false },
  { name: "form_error", meaning: "שדה שנדחה בשאלון", when: "שם חסר או נייד לא תקין בשלב פרטי הקשר (field: name או phone, בלי הערך)", keyEvent: false },
  { name: "wizard_followup_start", meaning: "התחלת השאלות הנוספות", when: "לחיצה על \"בטח\" אחרי שהליד נשמר", keyEvent: false },
  { name: "wizard_followup_complete", meaning: "השאלות הנוספות נשלחו", when: "שליחת השאלות הנוספות (answered: כמה מתוך שלוש נענו)", keyEvent: false },
  { name: "preferred_channel_click", meaning: "בחירת ערוץ מועדף", when: "שמור לכפתור ערוץ שאינו קישור ישיר — כרגע אין כזה", keyEvent: false },
  { name: "click_chat", meaning: "כניסה לצ׳אט התמיכה", when: "כל קישור לצ׳אט התמיכה (תפריט, הסרגל התחתון, כפתור התמיכה) ופתיחת הצ׳אט בכרטיס שבטלפון (location: מאיפה; method: כשהצ׳אט עצמו נפתח)", keyEvent: true },
  { name: "calculator_result", meaning: "תוצאת מחשבון", when: "פעם אחת לכל תוצאה שהמבקר הפיק ב-/tools: בבדיקה העצמית — בסיום; במחשבון דמי הניהול — אחרי שינוי ו-1.5 שניות בלי הקלדה (tool: שם הכלי בלבד, בלי סכומים)", keyEvent: false },
];

/** The GA4 property the site reports to, from the tag in index.html. */
export const GA4_MEASUREMENT_ID = AGENCY_PROFILE.ga4MeasurementId;

/** True when the tag loaded in this browser (an ad blocker stops it). */
export function isTagLoaded(): boolean {
  return gtagOf() !== null;
}
