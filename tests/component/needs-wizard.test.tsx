/**
 * @vitest-environment jsdom
 *
 * The questionnaire as a short click-through (the brief of 2026-10-14): three
 * taps — the concern, life stage, urgency — then a name and a mobile, and the
 * lead is saved. Then, optionally, three more questions that fill in that same
 * lead (`stage: "details"`). What matters is what leaves the page: the payloads
 * `submitInterview` receives, the GA4 events, and on the claim route, that
 * nothing is submitted at all.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { base44Mock } from "./base44-mock";

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
const { CONTACT } = await import("@/config/contact");
const { HUMAN_HANDOFF } = await import("@/config/compliance");

const NOW = new Date("2026-10-12T22:30:00Z");
const radio = (name: string) => screen.getByRole("radio", { name });

/** A tap, then the 250 ms beat after which the step moves on by itself. */
async function tap(name: string, next: string) {
  fireEvent.click(radio(name));
  await screen.findByRole("heading", { name: next });
}
async function threeTaps() {
  await tap("דמי ניהול / הפנסיה שלי", "איפה את/ה בחיים כרגע?");
  await tap("זוג בלי ילדים", "עד כמה זה דחוף?");
  await tap("דחוף — אשמח לשיחה השבוע", "איך דורית תחזור אליך?");
}
const fill = (name: string, phone: string) => {
  fireEvent.change(screen.getByLabelText("שם"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("טלפון נייד"), { target: { value: phone } });
};
const send = async () => {
  await act(async () => fireEvent.click(screen.getByRole("button", { name: /שליחה לדורית/ })));
};
async function saveLead() {
  await threeTaps();
  fill("רונית אבני", "050-1234567");
  await send();
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

describe("three taps, then the contact step", () => {
  it("opens on the concern with the short promise and a counter, and no list of steps", () => {
    render(<NeedsWizard />);
    expect(screen.getByRole("heading", { name: "מה הכי מעסיק אותך כרגע?" })).toBeInTheDocument();
    expect(screen.getByText("3 שאלות קצרות — פחות מדקה")).toBeInTheDocument();
    expect(screen.getByText("שאלה 1 מתוך 3")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "שלבי השאלון" })).not.toBeInTheDocument();
  });

  it("each tap moves on by itself, and the contact step says it is nearly done", async () => {
    render(<NeedsWizard />);
    await threeTaps();
    expect(screen.getByText("כמעט סיימנו")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "איך דורית תחזור אליך?" }));
  });

  it("saves the lead with the three answers, and reports it with its topic and urgency only", async () => {
    const completed = vi.spyOn(leadEvents, "wizardCompleted");
    render(<NeedsWizard />);
    await saveLead();
    expect(submitInterview).toHaveBeenCalledTimes(1);
    const sent = submitInterview.mock.calls[0][0];
    expect(sent).toMatchObject({ stage: "complete", name: "רונית אבני", phone: "050-1234567" });
    expect(sent.profile).toMatchObject({ concern: "דמי ניהול / הפנסיה שלי", life_stage: "זוג בלי ילדים", urgency: "דחוף — אשמח לשיחה השבוע" });
    expect(completed).toHaveBeenCalledWith("דמי ניהול / הפנסיה שלי", "דחוף — אשמח לשיחה השבוע");
    expect(screen.getByRole("heading", { name: "תודה רונית! דורית תחזור אליך בקרוב." })).toBeInTheDocument();
  });

  it("reports each step by its number, and a skipped one as a skip", async () => {
    const step = vi.spyOn(leadEvents, "wizardStep");
    const skipped = vi.spyOn(leadEvents, "wizardSkipped");
    render(<NeedsWizard />);
    await tap("מס / החזר מס", "איפה את/ה בחיים כרגע?");
    fireEvent.click(screen.getByRole("button", { name: "דילוג על השאלה" }));
    expect(screen.getByRole("heading", { name: "עד כמה זה דחוף?" })).toBeInTheDocument();
    await tap("בחודשים הקרובים", "איך דורית תחזור אליך?");
    fill("רונית", "0521234567");
    await send();
    expect(skipped).toHaveBeenCalledWith(2);
    expect(step.mock.calls.map((c) => c[0])).toEqual([1, 3, 4]);
  });

  it("goes back with the answer kept", async () => {
    render(<NeedsWizard />);
    await tap("מס / החזר מס", "איפה את/ה בחיים כרגע?");
    fireEvent.click(screen.getByRole("button", { name: "הקודם" }));
    expect(radio("מס / החזר מס")).toBeChecked();
    expect(screen.getByRole("button", { name: "המשך" })).toBeInTheDocument();
  });

  it("an arrow key chooses without moving on; Enter then moves on", async () => {
    render(<NeedsWizard />);
    fireEvent.keyDown(radio("דמי ניהול / הפנסיה שלי"), { key: "ArrowDown" });
    fireEvent.click(radio("ביטוחים והגנה על המשפחה"));
    fireEvent.keyUp(radio("ביטוחים והגנה על המשפחה"), { key: "ArrowDown" });
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.getByRole("heading", { name: "מה הכי מעסיק אותך כרגע?" })).toBeInTheDocument();
    fireEvent.keyDown(radio("ביטוחים והגנה על המשפחה"), { key: "Enter" });
    expect(await screen.findByRole("heading", { name: "איפה את/ה בחיים כרגע?" })).toBeInTheDocument();
  });
});

describe("the contact step", () => {
  beforeEach(async () => {
    render(<NeedsWizard />);
    await threeTaps();
  });

  it("asks for a mobile the way a phone keyboard expects, and a name autofill knows", () => {
    const phone = screen.getByLabelText("טלפון נייד");
    expect(phone).toHaveAttribute("type", "tel");
    expect(phone).toHaveAttribute("inputmode", "tel");
    expect(phone).toHaveAttribute("autocomplete", "tel");
    expect(phone).toHaveAttribute("placeholder", "05X-XXXXXXX");
    expect(screen.getByLabelText("שם")).toHaveAttribute("autocomplete", "name");
  });

  it("answers a wrong number under the field, reports which field, and saves nothing", async () => {
    const formError = vi.spyOn(leadEvents, "formError");
    fill("רונית", "03-1234567");
    await send();
    const phone = screen.getByLabelText("טלפון נייד");
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(phone.getAttribute("aria-describedby")!)).toHaveTextContent("מספר נייד צריך להתחיל ב-05 ולהכיל 10 ספרות");
    expect(formError).toHaveBeenCalledWith("phone");
    expect(submitInterview).not.toHaveBeenCalled();
  });

  it("answers a missing name, and reports it", async () => {
    const formError = vi.spyOn(leadEvents, "formError");
    fill("", "050-1234567");
    await send();
    expect(screen.getByText("נא למלא שם.")).toBeInTheDocument();
    expect(formError).toHaveBeenCalledWith("name");
  });

  it("says when Dorit answers, under the button", () => {
    expect(screen.getByText("דורית חוזרת תוך יום עסקים")).toBeInTheDocument();
  });

  it("offers WhatsApp instead, written from the three answers and tracked as wizard_step4", () => {
    const link = screen.getByRole("link", { name: /כתבו לדורית/ });
    expect(link.getAttribute("href")).toContain(`wa.me/${CONTACT.whatsapp}`);
    const text = new URL(link.getAttribute("href")!).searchParams.get("text")!;
    expect(text).toContain("דמי ניהול / הפנסיה שלי");
    expect(text).toContain("זוג בלי ילדים");
    expect(text).toContain("דחוף — אשמח לשיחה השבוע");
    expect(link.closest("[data-track-location]")).toHaveAttribute("data-track-location", "wizard_step4");
  });
});

describe("the three optional questions", () => {
  it("are offered after the lead, and fill in the same lead", async () => {
    const started = vi.spyOn(leadEvents, "wizardFollowupStarted");
    const completedFollowup = vi.spyOn(leadEvents, "wizardFollowupCompleted");
    const completed = vi.spyOn(leadEvents, "wizardCompleted");
    render(<NeedsWizard />);
    await saveLead();
    expect(screen.getByText("רוצים לעזור לדורית להתכונן? עוד 3 שאלות (לא חובה)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /בטח/ }));
    expect(started).toHaveBeenCalledTimes(1);
    await tap("הורדת עלויות", "יש לך דוח מסלקה פנסיונית?");
    fireEvent.click(radio("לא"));
    fireEvent.click(radio("מעוניין/ת"));
    fireEvent.change(screen.getByLabelText(/אימייל לשליחת הקישור/), { target: { value: "ronit@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    fireEvent.click(radio("ערב"));
    fireEvent.change(screen.getByLabelText(/משהו נוסף/), { target: { value: "עדיף אחרי 19:00" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /שמירת התשובות/ })));

    expect(submitInterview).toHaveBeenCalledTimes(2);
    const details = submitInterview.mock.calls[1][0];
    expect(details).toMatchObject({ stage: "details", name: "רונית אבני", email: "ronit@example.com", timing: "ערב", notes: "עדיף אחרי 19:00" });
    // The details find their lead by this run's reference, which the contact step sent too (review 2026-10-15).
    expect(details.conversationRef).toMatch(/^wizard:[0-9a-f-]{36}$/);
    expect(details.conversationRef).toBe(submitInterview.mock.calls[0][0].conversationRef);
    expect(details.profile).toMatchObject({ goal: "הורדת עלויות", clearinghouse_report: "לא", clearinghouse: "מעוניין/ת", urgency: "דחוף — אשמח לשיחה השבוע" });
    expect(completedFollowup).toHaveBeenCalledWith(3);
    expect(completed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "מעולה, דורית תגיע מוכנה." })).toBeInTheDocument();
  });

  it("offers the clearinghouse pull only to someone without a report", async () => {
    render(<NeedsWizard />);
    await saveLead();
    fireEvent.click(screen.getByRole("button", { name: /בטח/ }));
    await tap("סדר בתיק", "יש לך דוח מסלקה פנסיונית?");
    fireEvent.click(radio("כן"));
    expect(screen.queryByRole("radio", { name: "מעוניין/ת" })).not.toBeInTheDocument();
    fireEvent.click(radio("לא יודע/ת מה זה"));
    expect(radio("מעוניין/ת")).toBeInTheDocument();
  });

  it("'לא עכשיו' leaves the thanks without the offer", async () => {
    render(<NeedsWizard />);
    await saveLead();
    fireEvent.click(screen.getByRole("button", { name: "לא עכשיו" }));
    expect(screen.getByRole("heading", { name: /תודה רונית/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /בטח/ })).not.toBeInTheDocument();
  });

  it("are not offered by a backend that cannot fill a lead in", async () => {
    backend.updatesInterviews = false;
    render(<NeedsWizard />);
    await saveLead();
    expect(screen.queryByRole("button", { name: /בטח/ })).not.toBeInTheDocument();
  });

  it("when their save fails, says the lead itself is already with Dorit", async () => {
    render(<NeedsWizard />);
    await saveLead();
    submitInterview.mockRejectedValueOnce(new Error("down"));
    fireEvent.click(screen.getByRole("button", { name: /בטח/ }));
    fireEvent.click(screen.getByRole("button", { name: "דילוג על השאלה" }));
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: /שמירת התשובות/ })));
    expect(screen.getByRole("heading", { name: "התשובות הנוספות לא נשמרו" })).toBeInTheDocument();
  });
});

describe("failures and the claim route", () => {
  it("a failed save shows Dorit's direct channels and keeps the answers for a retry", async () => {
    submitInterview.mockRejectedValueOnce(new Error("down"));
    render(<NeedsWizard />);
    await saveLead();
    expect(screen.getByText(HUMAN_HANDOFF.failure)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "חזרה לניסיון נוסף" }));
    expect(screen.getByLabelText("שם")).toHaveValue("רונית אבני");
    await send();
    expect(submitInterview).toHaveBeenCalledTimes(2);
  });

  it("the claim option escalates with claim_or_policy and never submits an interview", async () => {
    const handoff = vi.spyOn(leadEvents, "wizardClaimHandoff");
    render(<NeedsWizard />);
    fireEvent.click(radio("תביעה או בעיה בפוליסה קיימת"));
    expect(await screen.findByRole("heading", { name: /תביעה או בעיה בפוליסה/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("שם"), { target: { value: "רונית" } });
    fireEvent.change(screen.getByLabelText("טלפון"), { target: { value: "050-1234567" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "שדורית תחזור אליי" })));
    expect(escalate).toHaveBeenCalledWith(expect.objectContaining({ reason: "claim_or_policy", agent: "needs_wizard" }));
    expect(submitInterview).not.toHaveBeenCalled();
    expect(handoff).toHaveBeenCalledTimes(1);
  });
});

describe("the questions keep a name for assistive tech", () => {
  it("each tap question is a named radio group, though the heading is what shows", async () => {
    render(<NeedsWizard />);
    await tap("מס / החזר מס", "איפה את/ה בחיים כרגע?");
    expect(within(screen.getByRole("group", { name: "איפה את/ה בחיים כרגע?" })).getAllByRole("radio")).toHaveLength(6);
  });
});
