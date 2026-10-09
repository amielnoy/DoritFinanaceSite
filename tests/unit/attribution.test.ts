// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { captureAttribution, getAttribution } from "@/lib/attribution";

// This jsdom build has no localStorage (see tests/unit/supabase-auth.test.ts),
// so a Map-backed stand-in plays it — same pattern as analytics.dom.test.ts.
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

function setPage(search: string, referrer: string) {
  window.history.replaceState(null, "", `/${search}`);
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  setPage("", "");
});

describe("captureAttribution / getAttribution", () => {
  it("returns null before anything is captured", () => {
    expect(getAttribution()).toBeNull();
  });

  it("classifies a known utm_source directly", () => {
    setPage("?utm_source=linkedin&utm_campaign=autumn_push", "");
    captureAttribution();
    expect(getAttribution()).toEqual({ channel: "linkedin", campaign: "autumn_push" });
  });

  it("strips anything unsafe out of utm_campaign", () => {
    setPage("?utm_source=linkedin&utm_campaign=<script>alert(1)</script>", "");
    captureAttribution();
    expect(getAttribution()?.campaign).toBe("scriptalert1script");
  });

  it("falls back to the referrer when utm_source is absent or unrecognised", () => {
    setPage("", "https://www.facebook.com/somepage");
    captureAttribution();
    expect(getAttribution()).toEqual({ channel: "facebook", campaign: null });
  });

  it("classifies known AI-assistant referrers", () => {
    for (const referrer of [
      "https://chat.openai.com/",
      "https://chatgpt.com/",
      "https://claude.ai/chat/abc",
      "https://www.perplexity.ai/search/abc",
      "https://gemini.google.com/app",
    ]) {
      setPage("", referrer);
      captureAttribution();
      expect(getAttribution(), referrer).toEqual({ channel: "ai_assistant", campaign: null });
      window.localStorage.clear();
    }
  });

  it("classifies a real Google search referrer as google, not ai_assistant", () => {
    // Gemini's own referrer host contains "google." too — this is the case
    // that would misclassify if the AI-assistant hosts were not checked first.
    setPage("", "https://www.google.com/search?q=pension");
    captureAttribution();
    expect(getAttribution()).toEqual({ channel: "google", campaign: null });
  });

  it("classifies an unrecognised external referrer as referral", () => {
    setPage("", "https://some-other-blog.example.com/post");
    captureAttribution();
    expect(getAttribution()).toEqual({ channel: "referral", campaign: null });
  });

  it("classifies no referrer and no utm_source as direct", () => {
    setPage("", "");
    captureAttribution();
    expect(getAttribution()).toEqual({ channel: "direct", campaign: null });
  });

  it("never overwrites an existing, unexpired first-touch channel", () => {
    setPage("?utm_source=google", "");
    captureAttribution();
    expect(getAttribution()?.channel).toBe("google");

    setPage("?utm_source=linkedin", "");
    captureAttribution();
    expect(getAttribution()?.channel).toBe("google");
  });

  it("captures again once the stored value has expired", () => {
    setPage("?utm_source=google", "");
    captureAttribution();
    const raw = JSON.parse(window.localStorage.getItem("lead_attribution")!);
    // 91 days ago — one day past the 90-day window.
    raw.capturedAt = Date.now() - 91 * 24 * 60 * 60 * 1000;
    window.localStorage.setItem("lead_attribution", JSON.stringify(raw));

    setPage("?utm_source=linkedin", "");
    captureAttribution();
    expect(getAttribution()?.channel).toBe("linkedin");
  });

  it("does not throw and resolves to null when localStorage is blocked", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new Error("blocked"); },
    });
    expect(() => captureAttribution()).not.toThrow();
    expect(getAttribution()).toBeNull();
  });

  it("does not throw on a corrupted stored value", () => {
    window.localStorage.setItem("lead_attribution", "{not json");
    expect(() => captureAttribution()).not.toThrow();
    expect(getAttribution()).toBeNull();
  });

  it("classifies utm_source=email and utm_source=sms directly", () => {
    setPage("?utm_source=email", "");
    captureAttribution();
    expect(getAttribution()?.channel).toBe("email");
    window.localStorage.clear();

    setPage("?utm_source=sms", "");
    captureAttribution();
    expect(getAttribution()?.channel).toBe("sms");
  });

  it("rejects a stored channel outside the known taxonomy", () => {
    window.localStorage.setItem("lead_attribution", JSON.stringify({ channel: "not_a_real_channel", campaign: null, capturedAt: Date.now() }));
    expect(getAttribution()).toBeNull();
  });

  it("does not misclassify a referrer host that merely starts with google.", () => {
    setPage("", "https://google.com.evil.com/");
    captureAttribution();
    expect(getAttribution()?.channel).toBe("referral");
  });
});
