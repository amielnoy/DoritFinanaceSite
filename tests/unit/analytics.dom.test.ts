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
    const names = new Set(LEAD_EVENTS.map((e) => e.name));
    for (const [, event] of w.gtag!.mock.calls) expect(names.has(event)).toBe(true);
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

  it("registers once, however often it is called", () => {
    initClickTracking();
    click('<section id="x"><a href="tel:+972500000000">חייגו</a></section>');
    expect(w.gtag).toHaveBeenCalledTimes(1);
  });
});
