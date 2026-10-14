/**
 * @vitest-environment jsdom
 *
 * The needs wizard, driven the way a visitor drives it: chips, "המשך", the
 * contact form, "אישור ושליחה". What matters is what leaves the page — the
 * payload `submitInterview` receives, and on the claim route, that it never
 * receives anything at all.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { base44Mock } from "./base44-mock";

// The real SDK would make network calls of its own from a test.
vi.mock("@/api/base44Client", () => ({ base44: base44Mock }));
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

const submitInterview = vi.hoisted(() => vi.fn());
const escalate = vi.hoisted(() => vi.fn());

vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  return {
    ...actual,
    services: {
      ...actual.services,
      leads: { ...actual.services.leads, submitInterview },
      support: { escalate },
    },
  };
});

const { default: NeedsWizard } = await import("@/components/dorit/forms/NeedsWizard");
const { leadEvents } = await import("@/lib/analytics");
const { UNKNOWN, TRANSPARENCY } = await import("@/config/needs-wizard");

/** 01:30 on Tuesday 13 October in Israel — so "השבוע הבא" is Sunday the 18th. */
const NOW = new Date("2026-10-12T22:30:00Z");

const next = () => fireEvent.click(screen.getByRole("button", { name: "המשך" }));
const pick = (name: string, group?: string) => {
  const scope = group ? within(screen.getByRole("group", { name: group })) : screen;
  const input = scope.queryByRole("radio", { name }) ?? scope.getByRole("checkbox", { name });
  fireEvent.click(input);
};

async function fillContact() {
  fireEvent.change(screen.getByLabelText("שם"), { target: { value: "רונית אבני" } });
  fireEvent.change(screen.getByLabelText("טלפון"), { target: { value: "050-1234567" } });
  await act(async () => next());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  submitInterview.mockReset().mockResolvedValue({ ok: true, rid: "r1" });
  escalate.mockReset().mockResolvedValue({ ok: true, contact: { phoneDisplay: "050", phoneE164: "+97250", whatsapp: "97250", email: "d@x.co" }, acknowledgement: "" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the pension path, end to end", () => {
  it("submits exactly what was answered, with 'לא יודע/ת' recorded and skips omitted", async () => {
    const completed = vi.spyOn(leadEvents, "wizardCompleted");
    render(<NeedsWizard />);

    pick("זוג בלי ילדים");
    next();
    pick("דמי ניהול / הפנסיה שלי");
    next();
    next(); // goal skipped
    pick("שכיר/ה", "מה המעמד התעסוקתי שלך?");
    pick("לא יודע/ת", "כמה שנות ותק, בערך?");
    pick("פנסיה", "אילו מוצרים יש לך היום?");
    pick("גמל", "אילו מוצרים יש לך היום?");
    next(); // fees skipped
    next(); // clearinghouse skipped
    pick("השבוע הבא", "יום");
    pick("בוקר 09:00–12:00", "שעות");
    next();
    await fillContact();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "אישור ושליחה" })));

    expect(submitInterview).toHaveBeenCalledTimes(1);
    const payload = submitInterview.mock.calls[0][0];
    expect(payload).toMatchObject({
      name: "רונית אבני",
      phone: "050-1234567",
      track: "pension",
      meetingTopic: "גמל, השתלמות ופנסיה",
      timing: "השבוע הבא, בוקר 09:00–12:00",
      scheduledAt: "2026-10-18T09:00:00",
      landingPath: "/",
    });
    expect(payload.profile).toEqual({
      life_stage: "זוג בלי ילדים",
      concern: "דמי ניהול / הפנסיה שלי",
      employer: "שכיר/ה",
      seniority: UNKNOWN,
      products: "פנסיה, גמל",
    });
    expect(completed).toHaveBeenCalledTimes(1);

    expect(screen.getByText(/השאלון נשמר ונשלח לדורית/)).toBeInTheDocument();
    expect(screen.getByText(TRANSPARENCY)).toBeInTheDocument();
  });
});

describe("questions are real form controls", () => {
  it("renders chips as radios inside a named group, and moves focus to each new step's heading", () => {
    render(<NeedsWizard />);
    const group = screen.getByRole("group", { name: "איפה את/ה בחיים כרגע?" });
    expect(within(group).getAllByRole("radio").length).toBeGreaterThanOrEqual(6);
    next();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "מה מביא אותך" }));
  });

  it("shows the track's questions, as checkboxes where several can apply", () => {
    render(<NeedsWizard />);
    next();
    pick("ביטוחים והגנה על המשפחה");
    next();
    next();
    expect(within(screen.getByRole("group", { name: "מי תלוי בך כלכלית?" })).getAllByRole("checkbox").length).toBeGreaterThan(1);
    expect(screen.getByRole("group", { name: "יש משכנתא פעילה?" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "מה המעמד התעסוקתי שלך?" })).not.toBeInTheDocument();
  });

  it("acknowledges a don't-know warmly, without judging anything", () => {
    render(<NeedsWizard />);
    next();
    pick("רוצה תמונה כללית");
    next();
    next();
    pick("לא יודע/ת", "אילו מוצרים יש לך היום?");
    next();
    expect(screen.getByText("זה בסדר גמור — בדיוק את זה בודקים בפגישה.")).toBeInTheDocument();
  });
});

describe("the stepper and the buttons", () => {
  it("marks the current stage, and a finished stage leads back to it", () => {
    render(<NeedsWizard />);
    const steps = () => within(screen.getByRole("list", { name: "שלבי השאלון" })).getAllByRole("listitem");
    expect(steps()).toHaveLength(8);
    expect(steps()[0]).toHaveAttribute("aria-current", "step");

    next();
    next();
    expect(steps()[2]).toHaveAttribute("aria-current", "step");
    fireEvent.click(screen.getByRole("button", { name: "חזרה לשלב 1: שלב חיים" }));
    expect(screen.getByRole("heading", { name: "נכיר קצת" })).toBeInTheDocument();
    expect(steps()[0]).toHaveAttribute("aria-current", "step");
  });

  it("has no back button on the first screen, and a real one after it", () => {
    render(<NeedsWizard />);
    expect(screen.queryByRole("button", { name: "הקודם" })).not.toBeInTheDocument();
    next();
    fireEvent.click(screen.getByRole("button", { name: "הקודם" }));
    expect(screen.getByRole("heading", { name: "נכיר קצת" })).toBeInTheDocument();
  });
});

describe("the claim option leaves the wizard for a person", () => {
  it("escalates with reason claim_or_policy and never submits an interview", async () => {
    render(<NeedsWizard />);
    next();
    pick("תביעה או בעיה בפוליסה קיימת");
    next();

    expect(screen.getByRole("heading", { name: /תביעה או בעיה בפוליסה/ })).toBeInTheDocument();
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href")?.startsWith("tel:"))).toBe(true);

    const form = screen.getByRole("form", { name: "בקשה שדורית תחזור אליך" });
    fireEvent.change(within(form).getByLabelText("טלפון"), { target: { value: "0521234567" } });
    await act(async () => fireEvent.click(within(form).getByRole("button", { name: "שדורית תחזור אליי" })));

    expect(escalate).toHaveBeenCalledTimes(1);
    expect(escalate.mock.calls[0][0]).toMatchObject({ reason: "claim_or_policy", phone: "0521234567", agent: "needs_wizard" });
    expect(submitInterview).not.toHaveBeenCalled();
  });
});

describe("contact details", () => {
  async function toContact() {
    render(<NeedsWizard />);
    for (let i = 0; i < 6; i++) next();
  }

  it("refuses a phone that is not an Israeli number, and stays on the step", async () => {
    await toContact();
    fireEvent.change(screen.getByLabelText("שם"), { target: { value: "רונית" } });
    fireEvent.change(screen.getByLabelText("טלפון"), { target: { value: "12345" } });
    next();
    expect(screen.getByRole("alert")).toHaveTextContent(/טלפון ישראלי/);
    expect(screen.getByRole("heading", { name: "איך דורית תחזור אליך" })).toBeInTheDocument();
  });

  it("validates an email only when one was given", async () => {
    await toContact();
    fireEvent.change(screen.getByLabelText("שם"), { target: { value: "רונית" } });
    fireEvent.change(screen.getByLabelText("טלפון"), { target: { value: "0501234567" } });
    fireEvent.change(screen.getByLabelText("אימייל — לבחירתך"), { target: { value: "not-an-address" } });
    next();
    expect(screen.getByRole("alert")).toHaveTextContent(/מייל/);
  });
});

describe("a failed save", () => {
  it("shows Dorit's direct channels and keeps every answer for a retry", async () => {
    submitInterview.mockReset().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ ok: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<NeedsWizard />);
    pick("ילדים בוגרים");
    for (let i = 0; i < 6; i++) next();
    await fillContact();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "אישור ושליחה" })));

    expect(screen.getByRole("heading", { name: "השליחה לא הצליחה" })).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[wizard]"), expect.anything());
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href")?.startsWith("tel:"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "חזרה לסיכום ולניסיון נוסף" }));
    expect(screen.getByText("ילדים בוגרים")).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "אישור ושליחה" })));
    expect(submitInterview).toHaveBeenCalledTimes(2);
    expect(submitInterview.mock.calls[1][0].profile.life_stage).toBe("ילדים בוגרים");
  });
});


/**
 * Below md (stage 3): a single-choice step moves on when an answer is chosen by
 * a tap, Space or Enter — never by an arrow key, which in a radio group moves
 * the choice and fires a click as it goes. `matchMedia` is stubbed to a width;
 * without it (jsdom's default, every case above) the wizard is the desktop's.
 */
describe("on a phone, a single-choice answer moves on by itself", () => {
  function phone(width = 390) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => {
        const min = /min-width:\s*(\d+)px/.exec(query);
        return {
          matches: min ? width >= Number(min[1]) : false,
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        };
      },
    });
  }
  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });
  const radio = (name: string) => screen.getByRole("radio", { name });

  it("a tap moves to the next step through the same path as המשך: wizard_step, focus on the new heading", async () => {
    phone();
    const step = vi.spyOn(leadEvents, "wizardStep");
    const started = vi.spyOn(leadEvents, "wizardStarted");
    render(<NeedsWizard />);
    expect(screen.queryByRole("button", { name: "המשך" })).not.toBeInTheDocument();
    fireEvent.click(radio("זוג בלי ילדים"));
    expect(radio("זוג בלי ילדים")).toBeChecked();
    const heading = await screen.findByRole("heading", { name: "מה מביא אותך" });
    expect(document.activeElement).toBe(heading);
    expect(step).toHaveBeenCalledTimes(1);
    expect(step).toHaveBeenCalledWith(1);
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("an arrow key chooses without moving on; Enter then moves on", async () => {
    phone();
    const step = vi.spyOn(leadEvents, "wizardStep");
    render(<NeedsWizard />);
    // What a browser does for ArrowDown in a radio group: keydown on the
    // focused radio, then a click (and the change) on the next one, keyup there.
    fireEvent.keyDown(radio("רווק/ה"), { key: "ArrowDown" });
    fireEvent.click(radio("זוג בלי ילדים"));
    fireEvent.keyUp(radio("זוג בלי ילדים"), { key: "ArrowDown" });
    await new Promise((r) => setTimeout(r, 400));
    expect(radio("זוג בלי ילדים")).toBeChecked();
    expect(screen.getByRole("heading", { name: "נכיר קצת" })).toBeInTheDocument();
    expect(step).not.toHaveBeenCalled();

    fireEvent.keyDown(radio("זוג בלי ילדים"), { key: "Enter" });
    expect(await screen.findByRole("heading", { name: "מה מביא אותך" })).toBeInTheDocument();
    expect(step).toHaveBeenCalledWith(1);
  });

  it("the concern's claim option still leaves for a person, with no interview", async () => {
    phone();
    render(<NeedsWizard />);
    fireEvent.click(screen.getByRole("button", { name: "דילוג על השאלה" }));
    fireEvent.click(radio("תביעה או בעיה בפוליסה קיימת"));
    expect(await screen.findByRole("heading", { name: /תביעה או בעיה בפוליסה/ })).toBeInTheDocument();
    expect(submitInterview).not.toHaveBeenCalled();
  });

  it("every question can still be skipped, and an answered one shows המשך on the way back", async () => {
    phone();
    render(<NeedsWizard />);
    fireEvent.click(screen.getByRole("button", { name: "דילוג על השאלה" }));
    expect(screen.getByRole("heading", { name: "מה מביא אותך" })).toBeInTheDocument();
    fireEvent.click(radio("מס / החזר מס"));
    await screen.findByRole("heading", { name: "מה היית רוצה לקחת מהפגישה" });
    fireEvent.click(screen.getByRole("button", { name: "הקודם" }));
    expect(radio("מס / החזר מס")).toBeChecked();
    expect(screen.queryByRole("button", { name: "דילוג על השאלה" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    expect(screen.getByRole("heading", { name: "מה היית רוצה לקחת מהפגישה" })).toBeInTheDocument();
  });

  it("a step of several questions keeps המשך, and choosing in it stays put", async () => {
    phone();
    render(<NeedsWizard />);
    fireEvent.click(screen.getByRole("button", { name: "דילוג על השאלה" }));
    fireEvent.click(radio("דמי ניהול / הפנסיה שלי"));
    await screen.findByRole("heading", { name: "מה היית רוצה לקחת מהפגישה" });
    fireEvent.click(screen.getByRole("button", { name: "דילוג על השאלה" }));
    expect(screen.getByRole("heading", { name: "כמה פרטים, כדי שדורית תגיע מוכנה" })).toBeInTheDocument();
    pick("שכיר/ה", "מה המעמד התעסוקתי שלך?");
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByRole("heading", { name: "כמה פרטים, כדי שדורית תגיע מוכנה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "המשך" })).toBeInTheDocument();
  });

  it("leaving the step before the beat is up cancels the move", async () => {
    phone();
    render(<NeedsWizard />);
    fireEvent.click(screen.getByRole("button", { name: "דילוג על השאלה" }));
    fireEvent.click(radio("מס / החזר מס"));
    fireEvent.click(screen.getByRole("button", { name: "הקודם" }));
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByRole("heading", { name: "נכיר קצת" })).toBeInTheDocument();
  });

  it("from md up nothing moves until המשך", async () => {
    phone(1440);
    render(<NeedsWizard />);
    fireEvent.click(radio("זוג בלי ילדים"));
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByRole("heading", { name: "נכיר קצת" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "המשך" })).toBeInTheDocument();
  });
});
