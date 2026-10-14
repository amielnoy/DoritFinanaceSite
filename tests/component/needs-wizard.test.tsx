/**
 * @vitest-environment jsdom
 *
 * The questionnaire, short first (the lead-generation brief of 2026-10-14):
 * what is on the visitor's mind, then a name and a mobile — and the lead is
 * saved. Then, optionally, four more questions that fill in that same lead
 * (`stage: "details"`). What matters is what leaves the page: the payloads
 * `submitInterview` receives, and on the claim route, that it receives nothing.
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
const backend = vi.hoisted(() => ({ updatesInterviews: true }));

vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  return {
    ...actual,
    services: {
      ...actual.services,
      leads: {
        ...actual.services.leads,
        submitInterview,
        get updatesInterviews() {
          return backend.updatesInterviews;
        },
      },
      support: { escalate },
    },
  };
});

const { default: NeedsWizard } = await import("@/components/dorit/forms/NeedsWizard");
const { leadEvents } = await import("@/lib/analytics");
const { TRANSPARENCY } = await import("@/config/needs-wizard");
const { HUMAN_HANDOFF } = await import("@/config/compliance");

/** 01:30 on Tuesday 13 October in Israel — so "השבוע הבא" is Sunday the 18th. */
const NOW = new Date("2026-10-12T22:30:00Z");

const next = () => fireEvent.click(screen.getByRole("button", { name: "המשך" }));
const pick = (name: string, group?: string) => {
  const scope = group ? within(screen.getByRole("group", { name: group })) : screen;
  fireEvent.click(scope.getByRole("radio", { name }));
};
const sendToDorit = async () => {
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /שליחה לדורית/ })));
};
const fill = (name: string, phone: string) => {
  fireEvent.change(screen.getByLabelText("שם"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("טלפון נייד"), { target: { value: phone } });
};
/** Concern, then contact, then sent: the two required steps. */
async function saveLead(concern = "דמי ניהול / הפנסיה שלי") {
  pick(concern);
  next();
  fill("רונית אבני", "050-1234567");
  await sendToDorit();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  backend.updatesInterviews = true;
  submitInterview.mockReset().mockResolvedValue({ ok: true, rid: "r1" });
  escalate.mockReset().mockResolvedValue({ ok: true, contact: { phoneDisplay: "050", phoneE164: "+97250", whatsapp: "97250", email: "d@x.co" }, acknowledgement: "" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("two steps, and the lead is saved", () => {
  it("asks what is on the visitor's mind first", () => {
    render(<NeedsWizard />);
    expect(screen.getByRole("heading", { name: "מה מעסיק אותך?" })).toBeInTheDocument();
    expect(screen.getByText(/שלב 1 מתוך 2/)).toBeInTheDocument();
  });

  it("saves the lead when the second step is sent — the topic, the name, the mobile — and counts it once", async () => {
    const completed = vi.spyOn(leadEvents, "wizardCompleted");
    render(<NeedsWizard />);
    await saveLead();
    expect(submitInterview).toHaveBeenCalledTimes(1);
    const sent = submitInterview.mock.calls[0][0];
    expect(sent).toMatchObject({ stage: "complete", name: "רונית אבני", phone: "050-1234567", landingPath: "/" });
    expect(sent.profile).toMatchObject({ concern: "דמי ניהול / הפנסיה שלי" });
    expect(completed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "נשמר — תודה" })).toBeInTheDocument();
  });

  it("reports each required step to GA4 by its number only", async () => {
    const step = vi.spyOn(leadEvents, "wizardStep");
    render(<NeedsWizard />);
    await saveLead();
    expect(step.mock.calls).toEqual([[1], [2]]);
  });

  it("has no back button on the first step, and a real one on the second", () => {
    render(<NeedsWizard />);
    expect(screen.queryByRole("button", { name: "הקודם" })).not.toBeInTheDocument();
    pick("מס / החזר מס");
    next();
    fireEvent.click(screen.getByRole("button", { name: "הקודם" }));
    expect(screen.getByRole("radio", { name: "מס / החזר מס" })).toBeChecked();
  });

  it("marks the current stage for assistive tech", () => {
    render(<NeedsWizard />);
    const stages = within(screen.getByRole("list", { name: "שלבי השאלון" })).getAllByRole("listitem");
    expect(stages).toHaveLength(2);
    expect(stages[0]).toHaveAttribute("aria-current", "step");
  });
});

describe("the contact step", () => {
  beforeEach(() => {
    render(<NeedsWizard />);
    pick("מס / החזר מס");
    next();
  });

  it("asks for a mobile the way a phone keyboard expects, and a name autofill knows", () => {
    const phone = screen.getByLabelText("טלפון נייד");
    expect(phone).toHaveAttribute("type", "tel");
    expect(phone).toHaveAttribute("inputmode", "tel");
    expect(phone).toHaveAttribute("autocomplete", "tel");
    expect(phone).toHaveAttribute("placeholder", "05X-XXXXXXX");
    expect(screen.getByLabelText("שם")).toHaveAttribute("autocomplete", "name");
  });

  it("says under the field what is wrong with the phone, linked to it, and saves nothing", async () => {
    fill("רונית", "03-1234567"); // a landline: not a mobile
    await sendToDorit();
    const phone = screen.getByLabelText("טלפון נייד");
    expect(phone).toHaveAttribute("aria-invalid", "true");
    const message = document.getElementById(phone.getAttribute("aria-describedby")!);
    expect(message).toHaveTextContent("נא להזין מספר נייד ישראלי");
    expect(submitInterview).not.toHaveBeenCalled();
    // the button is not merely disabled: it answers with the message
    expect(screen.getByRole("button", { name: /שליחה לדורית/ })).toBeEnabled();
  });

  it("says when the name is missing", async () => {
    fill("", "050-1234567");
    await sendToDorit();
    expect(screen.getByText("נא למלא שם.")).toBeInTheDocument();
    expect(submitInterview).not.toHaveBeenCalled();
  });

  it("accepts a +972 mobile", async () => {
    fill("רונית", "+972 50 123 4567");
    await sendToDorit();
    expect(submitInterview).toHaveBeenCalledTimes(1);
  });

  it("shows where the details go before they are sent", () => {
    expect(screen.getByText(TRANSPARENCY)).toBeInTheDocument();
  });
});

describe("the four optional questions", () => {
  it("offers them once the lead is saved, and they fill in the same lead", async () => {
    const completed = vi.spyOn(leadEvents, "wizardCompleted");
    const step = vi.spyOn(leadEvents, "wizardStep");
    render(<NeedsWizard />);
    await saveLead();
    fireEvent.click(screen.getByRole("button", { name: /עוד 4 שאלות קצרות/ }));
    expect(screen.getByText(/שאלה 1 מתוך 4/)).toBeInTheDocument();
    pick("זוג בלי ילדים");
    next();
    pick("להוריד עלויות");
    next();
    pick("מעוניין/ת");
    fireEvent.change(screen.getByLabelText(/אימייל לשליחת הקישור/), { target: { value: "ronit@example.com" } });
    next();
    pick("השבוע הבא", "יום");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /שמירת התשובות/ })));

    expect(submitInterview).toHaveBeenCalledTimes(2);
    const details = submitInterview.mock.calls[1][0];
    expect(details).toMatchObject({ stage: "details", name: "רונית אבני", phone: "050-1234567", email: "ronit@example.com" });
    expect(details.profile).toMatchObject({ concern: "דמי ניהול / הפנסיה שלי", life_stage: "זוג בלי ילדים", goal: "להוריד עלויות" });
    expect(details.timing).toMatch(/השבוע הבא/);
    // the lead was counted when it was saved, not again
    expect(completed).toHaveBeenCalledTimes(1);
    expect(step.mock.calls.map((c) => c[0])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(screen.getByRole("heading", { name: "תודה — דורית תגיע מוכנה" })).toBeInTheDocument();
  });

  it("asks for an email only when the visitor wants the clearinghouse link", async () => {
    render(<NeedsWizard />);
    await saveLead();
    fireEvent.click(screen.getByRole("button", { name: /עוד 4 שאלות קצרות/ }));
    next();
    next();
    expect(screen.queryByLabelText(/אימייל לשליחת הקישור/)).not.toBeInTheDocument();
    pick("לא כרגע");
    expect(screen.queryByLabelText(/אימייל לשליחת הקישור/)).not.toBeInTheDocument();
    pick("מעוניין/ת");
    fireEvent.change(screen.getByLabelText(/אימייל לשליחת הקישור/), { target: { value: "not-an-email" } });
    next();
    expect(screen.getByText("כתובת המייל לא נראית תקינה.")).toBeInTheDocument();
  });

  it("are not offered by a backend that cannot fill a lead in", async () => {
    backend.updatesInterviews = false;
    render(<NeedsWizard />);
    await saveLead();
    expect(screen.getByRole("heading", { name: "נשמר — תודה" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /עוד 4 שאלות קצרות/ })).not.toBeInTheDocument();
  });

  it("when their save fails, says the lead itself is already with Dorit", async () => {
    render(<NeedsWizard />);
    await saveLead();
    submitInterview.mockRejectedValueOnce(new Error("down"));
    fireEvent.click(screen.getByRole("button", { name: /עוד 4 שאלות קצרות/ }));
    next();
    next();
    next();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /שמירת התשובות/ })));
    expect(screen.getByRole("heading", { name: "התשובות הנוספות לא נשמרו" })).toBeInTheDocument();
    expect(screen.getByText(/הפרטים שלך כבר אצל דורית/)).toBeInTheDocument();
  });
});

describe("a failed save", () => {
  it("shows Dorit's direct channels and keeps the answers for a retry", async () => {
    submitInterview.mockRejectedValueOnce(new Error("down"));
    render(<NeedsWizard />);
    await saveLead();
    expect(screen.getByText(HUMAN_HANDOFF.failure)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "חזרה לניסיון נוסף" }));
    expect(screen.getByLabelText("שם")).toHaveValue("רונית אבני");
    await sendToDorit();
    expect(submitInterview).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "נשמר — תודה" })).toBeInTheDocument();
  });
});

describe("the claim option leaves the questionnaire for a person", () => {
  it("escalates with reason claim_or_policy and never submits an interview", async () => {
    const handoff = vi.spyOn(leadEvents, "wizardClaimHandoff");
    render(<NeedsWizard />);
    pick("תביעה או בעיה בפוליסה קיימת");
    next();
    expect(screen.getByRole("heading", { name: /תביעה או בעיה בפוליסה/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("שם"), { target: { value: "רונית" } });
    fireEvent.change(screen.getByLabelText("טלפון"), { target: { value: "050-1234567" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "שדורית תחזור אליי" })));
    expect(escalate).toHaveBeenCalledWith(expect.objectContaining({ reason: "claim_or_policy", agent: "needs_wizard" }));
    expect(submitInterview).not.toHaveBeenCalled();
    expect(handoff).toHaveBeenCalledTimes(1);
  });
});

/**
 * Below md: a single-choice step moves on when an answer is chosen by a tap,
 * Space or Enter — never by an arrow key, which in a radio group moves the
 * choice and fires a click as it goes. `matchMedia` is stubbed to a width;
 * without it (jsdom's default, every case above) the questionnaire is the desktop's.
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

  it("a tap on the concern moves to the contact step through the same path as המשך", async () => {
    phone();
    const step = vi.spyOn(leadEvents, "wizardStep");
    render(<NeedsWizard />);
    expect(screen.queryByRole("button", { name: "המשך" })).not.toBeInTheDocument();
    fireEvent.click(radio("מס / החזר מס"));
    const heading = await screen.findByRole("heading", { name: "איך דורית תחזור אליך" });
    expect(document.activeElement).toBe(heading);
    expect(step).toHaveBeenCalledWith(1);
  });

  it("an arrow key chooses without moving on; Enter then moves on", async () => {
    phone();
    render(<NeedsWizard />);
    fireEvent.keyDown(radio("דמי ניהול / הפנסיה שלי"), { key: "ArrowDown" });
    fireEvent.click(radio("ביטוחים והגנה על המשפחה"));
    fireEvent.keyUp(radio("ביטוחים והגנה על המשפחה"), { key: "ArrowDown" });
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByRole("heading", { name: "מה מעסיק אותך?" })).toBeInTheDocument();
    fireEvent.keyDown(radio("ביטוחים והגנה על המשפחה"), { key: "Enter" });
    expect(await screen.findByRole("heading", { name: "איך דורית תחזור אליך" })).toBeInTheDocument();
  });

  it("the claim option still leaves for a person, with no interview", async () => {
    phone();
    render(<NeedsWizard />);
    fireEvent.click(radio("תביעה או בעיה בפוליסה קיימת"));
    expect(await screen.findByRole("heading", { name: /תביעה או בעיה בפוליסה/ })).toBeInTheDocument();
    expect(submitInterview).not.toHaveBeenCalled();
  });

  it("in the optional part a tap moves on, but the clearinghouse step waits — it may ask for an email", async () => {
    phone();
    render(<NeedsWizard />);
    fireEvent.click(radio("מס / החזר מס"));
    await screen.findByRole("heading", { name: "איך דורית תחזור אליך" });
    fill("רונית אבני", "050-1234567");
    await sendToDorit();
    fireEvent.click(screen.getByRole("button", { name: /עוד 4 שאלות קצרות/ }));
    fireEvent.click(radio("זוג בלי ילדים"));
    await screen.findByRole("heading", { name: "מה היית רוצה לקחת מהפגישה" });
    fireEvent.click(radio("להוריד עלויות"));
    await screen.findByRole("heading", { name: "תמונת מצב מהמסלקה" });
    fireEvent.click(radio("מעוניין/ת"));
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByRole("heading", { name: "תמונת מצב מהמסלקה" })).toBeInTheDocument();
    expect(screen.getByLabelText(/אימייל לשליחת הקישור/)).toBeInTheDocument();
  });

  it("from md up nothing moves until המשך", async () => {
    phone(1440);
    render(<NeedsWizard />);
    fireEvent.click(radio("מס / החזר מס"));
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByRole("heading", { name: "מה מעסיק אותך?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "המשך" })).toBeInTheDocument();
  });
});
