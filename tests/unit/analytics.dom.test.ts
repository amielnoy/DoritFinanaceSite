// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEAD_EVENTS,
  initClickTracking,
  initInternalFlag,
  isInternalBrowser,
  leadEvents,
  setInternalBrowser,
  track,
} from "@/lib/analytics";

/**
 * Lead events for GA4: what a visitor did, never who they are.
 *
 * The four rules this pins come from the brief: no name, phone, email or chat
 * content reaches Google; a blocked or broken tag never breaks the page; a
 * form counts as a lead only once it has been saved; and the agency's own
 * browsing is marked so it can be filtered out.
 */
type Gtag = ReturnType<typeof vi.fn>;
const w = window as unknown as { gtag?: Gtag; __leadTrackingInit?: boolean };

// This jsdom build has no localStorage (see supabase-auth.test.ts), so a
// Map-backed stand-in plays it.
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  w.gtag = vi.fn();
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
});

afterEach(() => {
  delete w.gtag;
  document.body.innerHTML = "";
});

describe("track", () => {
  it("sends the event and its parameters to gtag", () => {
    track("click_phone", { location: "hero" });
    expect(w.gtag).toHaveBeenCalledWith("event", "click_phone", { location: "hero" });
  });

  it("drops any parameter it does not know, so personal data cannot ride along", () => {
    track("generate_lead", { method: "contact_form", email: "a@b.co", phone: "0501234567", name: "רונית" });
    expect(w.gtag).toHaveBeenCalledWith("event", "generate_lead", { method: "contact_form" });
  });

  it("does nothing when the tag is blocked", () => {
    delete w.gtag;
    expect(() => track("click_phone", { location: "hero" })).not.toThrow();
  });

  it("never throws, even when gtag does", () => {
    w.gtag = vi.fn(() => {
      throw new Error("blocked");
    });
    expect(() => track("click_phone", { location: "hero" })).not.toThrow();
  });

  it("marks the agency's own browsing as internal", () => {
    setInternalBrowser(true);
    track("click_phone", { location: "hero" });
    expect(w.gtag).toHaveBeenCalledWith("event", "click_phone", { location: "hero", traffic_type: "internal" });
  });

  it("attaches lead_source and lead_campaign when an attribution is on record", async () => {
    const { captureAttribution } = await import("@/lib/attribution");
    window.history.replaceState(null, "", "/?utm_source=linkedin&utm_campaign=autumn_push");
    captureAttribution();
    track("click_phone", { location: "hero" });
    expect(w.gtag).toHaveBeenCalledWith("event", "click_phone", {
      location: "hero",
      lead_source: "linkedin",
      lead_campaign: "autumn_push",
    });
    window.history.replaceState(null, "", "/");
  });

  it("omits lead_source/lead_campaign entirely when no attribution is on record", () => {
    track("click_phone", { location: "hero" });
    expect(w.gtag).toHaveBeenCalledWith("event", "click_phone", { location: "hero" });
  });
});

describe("the internal flag", () => {
  it("is set by ?internal=1 and cleared by ?internal=0", () => {
    window.history.replaceState(null, "", "/?internal=1");
    initInternalFlag();
    expect(isInternalBrowser()).toBe(true);
    window.history.replaceState(null, "", "/?internal=0");
    initInternalFlag();
    expect(isInternalBrowser()).toBe(false);
    window.history.replaceState(null, "", "/");
  });
});

describe("leadEvents", () => {
  it("counts a submitted form as a lead", () => {
    leadEvents.formSubmitted();
    expect(w.gtag).toHaveBeenCalledWith("event", "generate_lead", { method: "contact_form" });
  });

  it("counts the pension check as a lead of its own method, with where its form sat", () => {
    leadEvents.pensionCheckSubmitted("calculator");
    expect(w.gtag).toHaveBeenCalledWith("event", "generate_lead", { method: "pension_check", location: "calculator" });
  });

  it("counts a submitted claim as a lead", () => {
    leadEvents.claimSubmitted();
    expect(w.gtag).toHaveBeenCalledWith("event", "generate_lead", { method: "claim" });
  });

  it("names the chat that started and the one that asked for a person", () => {
    leadEvents.chatStarted("ai_interview");
    leadEvents.chatHandoff("ai_support");
    expect(w.gtag).toHaveBeenCalledWith("event", "chat_start", { method: "ai_interview" });
    expect(w.gtag).toHaveBeenCalledWith("event", "chat_handoff", { method: "ai_support" });
  });

  it("counts a completed hand-off as a lead, distinctly from opening the panel", () => {
    leadEvents.handoffCompleted("ai_support");
    expect(w.gtag).toHaveBeenCalledWith("event", "generate_lead", { method: "ai_support" });
    expect(w.gtag).not.toHaveBeenCalledWith("event", "chat_handoff", expect.anything());
  });

  it("every event it sends is in the catalogue the admin panel shows", () => {
    leadEvents.formSubmitted();
    leadEvents.interviewCompleted();
    leadEvents.chatStarted("ai_interview");
    leadEvents.chatHandoff("ai_interview");
    leadEvents.handoffCompleted("ai_interview");
    leadEvents.preferredChannel("whatsapp");
    leadEvents.wizardStarted();
    leadEvents.wizardStep(3);
    leadEvents.wizardCompleted();
    leadEvents.wizardClaimHandoff();
    const names = new Set(LEAD_EVENTS.map((e) => e.name));
    for (const [, event] of w.gtag!.mock.calls) expect(names.has(event)).toBe(true);
  });
});

describe("the needs wizard's events", () => {
  it("sends the step by number only, and a lead only as generate_lead", () => {
    leadEvents.wizardStep(4);
    expect(w.gtag).toHaveBeenCalledWith("event", "wizard_step", { method: "needs_wizard", location: "step_4" });
    leadEvents.wizardCompleted();
    expect(w.gtag).toHaveBeenCalledWith("event", "generate_lead", { method: "needs_wizard" });
  });
});

describe("LEAD_EVENTS catalogue", () => {
  // The user's decision of 2026-10-14: every lead-intent event is a key event,
  // the hand-off request too (it is counted again as generate_lead once it is
  // done — the panel says so). The wizard's progress events stay plain events.
  it.each(["generate_lead", "click_phone", "click_whatsapp", "click_email", "cta_click", "chat_start", "chat_handoff"])(
    "marks %s a key event",
    (name) => {
      expect(LEAD_EVENTS.find((e) => e.name === name)?.keyEvent).toBe(true);
    },
  );

  it.each(["wizard_start", "wizard_step", "preferred_channel_click"])("leaves %s a plain event", (name) => {
    expect(LEAD_EVENTS.find((e) => e.name === name)?.keyEvent).toBe(false);
  });

  it("includes claim as a generate_lead method, same catalogue entry as the others", () => {
    leadEvents.claimSubmitted();
    const names = new Set(LEAD_EVENTS.map((e) => e.name));
    expect(names.has("generate_lead")).toBe(true);
  });
});

describe("initClickTracking", () => {
  // Once for the block: a listener added per test would stay on `document`
  // and count every later click again.
  beforeAll(() => {
    delete w.__leadTrackingInit;
    initClickTracking();
  });

  const click = (html: string) => {
    document.body.innerHTML = html;
    document.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  };

  it("reports a phone link with the section it sits in", () => {
    click('<section id="about"><a href="tel:+972500000000">חייגו</a></section>');
    expect(w.gtag).toHaveBeenCalledWith("event", "click_phone", { location: "about" });
  });

  it("prefers an explicit data-track-location", () => {
    click('<div data-track-location="mobile_sticky_bar"><a href="https://wa.me/972500000000">וואטסאפ</a></div>');
    expect(w.gtag).toHaveBeenCalledWith("event", "click_whatsapp", { location: "mobile_sticky_bar" });
  });

  it("reports mail links and the start-conversation call to action", () => {
    click('<footer><a href="mailto:x@example.com">מייל</a></footer>');
    expect(w.gtag).toHaveBeenCalledWith("event", "click_email", { location: "footer" });
    click('<header><a href="/#start">לשיחה קצרה</a></header>');
    expect(w.gtag).toHaveBeenCalledWith("event", "cta_click", { location: "header", cta: "start_conversation" });
  });

  it("ignores every other link", () => {
    click('<nav><a href="/blog">בלוג</a></nav>');
    expect(w.gtag).not.toHaveBeenCalled();
  });

  it("reports a Cal.com booking link, the flagship check and the WhatsApp channel by name", () => {
    click('<section id="start"><div data-track-location="start_booking"><a href="https://cal.com/dorit/15min">לבחירת מועד</a></div></section>');
    expect(w.gtag).toHaveBeenCalledWith("event", "click_booking", { location: "start_booking" });
    click('<section id="top"><a href="/pension-check">בדיקת תיק פנסיוני</a></section>');
    expect(w.gtag).toHaveBeenCalledWith("event", "cta_click", { location: "top", cta: "pension_check" });
    click('<footer><p data-track-location="footer_channel"><a href="https://whatsapp.com/channel/abc">ערוץ</a></p></footer>');
    expect(w.gtag).toHaveBeenCalledWith("event", "join_channel", { location: "footer_channel" });
  });

  it("registers once, however often it is called", () => {
    initClickTracking();
    click('<section id="x"><a href="tel:+972500000000">חייגו</a></section>');
    expect(w.gtag).toHaveBeenCalledTimes(1);
  });
});

/*
 * The calculator → lead box and the ways into the chat (feat/calc-lead-analytics).
 * Kept in a block of their own, below the catalogue cases, so the key-event
 * decisions above can change without touching these lines.
 */
describe("calculator_result and click_chat", () => {
  beforeAll(() => {
    // Idempotent: the block above may already have registered the listener.
    initClickTracking();
  });

  const click = (html: string) => {
    document.body.innerHTML = html;
    document.querySelector("a")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  };

  it("sends calculator_result with the tool's name and nothing else", () => {
    leadEvents.calculatorResult("fee_calculator");
    leadEvents.calculatorResult("insurance_assessment");
    expect(w.gtag).toHaveBeenCalledWith("event", "calculator_result", { tool: "fee_calculator" });
    expect(w.gtag).toHaveBeenCalledWith("event", "calculator_result", { tool: "insurance_assessment" });
  });

  it("drops a tool value that is not one of the calculators, so a figure cannot ride in it", () => {
    track("calculator_result", { tool: "12000" });
    track("calculator_result", { tool: "₪12,000" });
    track("calculator_result", { tool: "fee_calculator 12000" });
    for (const [, , params] of w.gtag!.mock.calls) expect(params).toEqual({});
  });

  it("counts a link to the support chat as click_chat, with where it was", () => {
    click('<div data-track-location="mobile_sticky_bar"><a href="/faq#support-chat">תמיכה</a></div>');
    expect(w.gtag).toHaveBeenCalledWith("event", "click_chat", { location: "mobile_sticky_bar" });
    click('<div data-track-location="header_menu"><a href="/faq#support-chat">תמיכה — שאלה לעוזר</a></div>');
    expect(w.gtag).toHaveBeenCalledWith("event", "click_chat", { location: "header_menu" });
    click('<section id="faq"><a href="#support-chat">לצ׳אט</a></section>');
    expect(w.gtag).toHaveBeenCalledWith("event", "click_chat", { location: "faq" });
  });

  it("does not count a link to /faq itself as click_chat", () => {
    click('<nav><a href="/faq">שאלות ותשובות</a></nav>');
    expect(w.gtag).not.toHaveBeenCalled();
  });

  it("counts a chat opened on the page as click_chat, naming the chat and where", () => {
    leadEvents.chatOpened("ai_support", "support-chat");
    expect(w.gtag).toHaveBeenCalledWith("event", "click_chat", { method: "ai_support", location: "support-chat" });
  });

  it("watches the support agent's own section id", async () => {
    const { SUPPORT_CHAT_HASH } = await import("@/lib/analytics");
    const { AGENTS } = await import("@/config/agents");
    expect(SUPPORT_CHAT_HASH).toBe(`#${AGENTS.support.sectionId}`);
  });

  it("every event it sends is in the catalogue the admin panel shows", () => {
    leadEvents.calculatorResult("fee_calculator");
    leadEvents.chatOpened("ai_support", "support-chat");
    click('<div data-track-location="floating_dock"><a href="/faq#support-chat">תמיכה</a></div>');
    const names = new Set(LEAD_EVENTS.map((e) => e.name));
    expect(w.gtag).toHaveBeenCalledTimes(3);
    for (const [, event] of w.gtag!.mock.calls) expect(names.has(event)).toBe(true);
  });

  it("marks click_chat a key event and calculator_result a plain one", () => {
    expect(LEAD_EVENTS.find((e) => e.name === "click_chat")?.keyEvent).toBe(true);
    expect(LEAD_EVENTS.find((e) => e.name === "calculator_result")?.keyEvent).toBe(false);
  });
});
