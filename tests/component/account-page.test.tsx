// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { base44Mock } from "./base44-mock";

vi.mock("@/api/base44Client", () => ({ base44: base44Mock }));
// The page imports the composition root, which reads the stored-token flag.
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

const auth = vi.hoisted(() => ({ user: { full_name: "רונית אבני", email: "ronit@example.com" } as Record<string, unknown> }));
const logoutSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: auth.user, isAuthenticated: true, logout: logoutSpy }),
}));

import Account from "@/pages/Account";
import { AccountLoadError, type Enquiry } from "@/services/ports";

const base: Enquiry = {
  createdAt: "2026-10-06T07:55:18Z", source: "interview", track: "pension", trackLabel: "פנסיה, גמל והשתלמות",
  meetingTopic: "גמל, השתלמות ופנסיה", timing: "ראשון 10:00", scheduledAt: "2026-10-11T07:00:00Z",
  summary: "סיכום", profile: [["יעד עיקרי", "פרישה"]], completed: true, inCalendar: true,
};

const NOW = new Date("2026-10-06T12:00:00Z");

const renderWith = (load: () => Promise<Enquiry[]>, client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })) =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<Account loadEnquiries={load} now={NOW} />} />
          <Route path="/login" element={<p>מסך הכניסה</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );

describe("<Account />", () => {
  it("shows who is signed in", async () => {
    renderWith(async () => []);
    expect(await screen.findByText("רונית אבני")).toBeInTheDocument();
    expect(screen.getByText("ronit@example.com")).toBeInTheDocument();
  });

  it("says so when there are no enquiries, and why some may be missing", async () => {
    renderWith(async () => []);
    expect(await screen.findByText("עוד אין כאן פניות")).toBeInTheDocument();
    expect(screen.getByText(/בלי כתובת מייל, או מכתובת אחרת/)).toBeInTheDocument();
  });

  it("shows a meeting with its status", async () => {
    renderWith(async () => [base, { ...base, inCalendar: false, createdAt: "2026-10-05T07:00:00Z" }]);
    expect(await screen.findByText("ביומן")).toBeInTheDocument();
    expect(screen.getByText("ממתינה לאישור דורית")).toBeInTheDocument();
  });

  it("shows the interview's answers with the mail's labels", async () => {
    renderWith(async () => [base]);
    expect(await screen.findByText("יעד עיקרי")).toBeInTheDocument();
    expect(screen.getByText("פרישה")).toBeInTheDocument();
  });

  it("marks a partial interview as not finished", async () => {
    renderWith(async () => [{ ...base, completed: false, summary: undefined, profile: [] }]);
    expect(await screen.findByText("לא הושלם")).toBeInTheDocument();
  });

  it("renders an old enquiry with no stored answers", async () => {
    renderWith(async () => [{ ...base, summary: undefined, profile: [] }]);
    expect(await screen.findByText(/הסיכום לא נשמר/)).toBeInTheDocument();
  });

  it("explains an unverified address instead of an empty list", async () => {
    renderWith(() => Promise.reject(new AccountLoadError("unverified", "r1")));
    expect(await screen.findByText(/כתובת המייל בחשבון עדיין לא אומתה/)).toBeInTheDocument();
  });

  it("shows the rid when loading fails, and keeps the rest of the page", async () => {
    renderWith(() => Promise.reject(new AccountLoadError("failed", "ab12cd34")));
    expect(await screen.findByText(/ab12cd34/)).toBeInTheDocument();
    expect(screen.getByText("רונית אבני")).toBeInTheDocument();
  });

  it("sends a visitor whose session ended back to sign in", async () => {
    renderWith(() => Promise.reject(new AccountLoadError("signed_out", "r2")));
    expect(await screen.findByText("מסך הכניסה")).toBeInTheDocument();
    expect(screen.queryByText("הפרטים שלי")).toBeNull();
  });

  it("renders an enquiry with no stored date without printing an invalid date", async () => {
    renderWith(async () => [{ ...base, createdAt: "" }]);
    expect(await screen.findByText("יעד עיקרי")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Invalid Date/);
  });

  it("gives an interview-only visitor an empty meetings line, not a second empty-page notice", async () => {
    renderWith(async () => [{ ...base, meetingTopic: undefined, scheduledAt: undefined }]);
    expect(await screen.findByText("אין כאן פגישות")).toBeInTheDocument();
    expect(screen.queryByText("עוד אין כאן פניות")).toBeNull();
  });

  it("gives a meeting-only visitor an empty interviews line", async () => {
    renderWith(async () => [{ ...base, source: "contact", summary: undefined, profile: [] }]);
    expect(await screen.findByText("אין כאן סיכומי היכרות")).toBeInTheDocument();
  });

  it("renders a repeated answer label twice without a React key warning", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWith(async () => [{ ...base, profile: [["ילדים", "שניים"], ["ילדים", "שלושה"]] }]);
    expect(await screen.findByText("שניים")).toBeInTheDocument();
    expect(screen.getByText("שלושה")).toBeInTheDocument();
    expect(spy.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
    spy.mockRestore();
  });

  it("says the time is not set when a meeting has neither a date nor a timing", async () => {
    renderWith(async () => [{ ...base, scheduledAt: undefined, timing: undefined }]);
    expect(await screen.findByText("המועד טרם נקבע")).toBeInTheDocument();
  });

  it("offers a retry after a failed load, and shows the enquiries when it succeeds", async () => {
    const load = vi.fn<() => Promise<Enquiry[]>>()
      // a failed load is retried once by the page, so it has to fail twice to reach the button
      .mockRejectedValueOnce(new AccountLoadError("failed", "x1"))
      .mockRejectedValueOnce(new AccountLoadError("failed", "x1"))
      .mockResolvedValueOnce([base]);
    renderWith(load);
    await userEvent.click(await screen.findByRole("button", { name: "ניסיון נוסף" }));
    expect(await screen.findByText("ביומן")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("links to the privacy rights", async () => {
    renderWith(async () => []);
    expect(await screen.findByRole("link", { name: /עיון, תיקון או מחיקה/ })).toHaveAttribute("href", "/privacy");
  });

  it("orders meetings: upcoming soonest first, then past most recent first, then undated", async () => {
    const m = (topic: string, scheduledAt?: string) => ({ ...base, source: "contact", meetingTopic: topic, scheduledAt, timing: undefined });
    renderWith(async () => [
      m("ללא מועד"), m("עבר ישן", "2026-09-01T07:00:00Z"), m("עתיד רחוק", "2026-10-30T07:00:00Z"),
      m("עבר קרוב", "2026-10-05T07:00:00Z"), m("עתיד קרוב", "2026-10-08T07:00:00Z"),
    ]);
    await screen.findByText("עתיד קרוב");
    const titles = screen.getAllByText(/^(עתיד|עבר|ללא)/).map((n) => n.textContent);
    expect(titles).toEqual(["עתיד קרוב", "עתיד רחוק", "עבר קרוב", "עבר ישן", "ללא מועד"]);
  });

  it("lists enquiries that are neither interviews nor meetings, with a source label", async () => {
    const other = (source: string, createdAt: string) => ({ ...base, source, meetingTopic: undefined, scheduledAt: undefined, summary: undefined, profile: [], createdAt });
    renderWith(async () => [
      other("quick", "2026-10-01T07:00:00Z"), other("detailed", "2026-10-02T07:00:00Z"), other("consultation", "2026-10-03T07:00:00Z"),
      other("claim", "2026-10-04T07:00:00Z"), other("escalation", "2026-10-05T07:00:00Z"), other("zzz", "2026-10-05T08:00:00Z"),
    ].map((e) => ({ ...e, source: e.source })) as Enquiry[]);
    expect(await screen.findByRole("heading", { name: "פניות נוספות" })).toBeInTheDocument();
    for (const label of ["טופס יצירת קשר", "פנייה מפורטת", "בקשת פגישה", "דיווח על תביעה", "בקשה לשיחה עם דורית", "פנייה"]) {
      expect(screen.getByText(new RegExp(`^${label} ·`))).toBeInTheDocument();
    }
  });

  it("hides the other-enquiries section when there is nothing for it", async () => {
    renderWith(async () => [base]);
    await screen.findByText("ביומן");
    expect(screen.queryByRole("heading", { name: "פניות נוספות" })).toBeNull();
  });

  it("does not show the previous user's rows after the session changes without a reload", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    const load = vi.fn<() => Promise<Enquiry[]>>().mockResolvedValueOnce([base]).mockResolvedValueOnce([]);
    auth.user = { id: "u1", full_name: "א", email: "a@example.com" };
    const view = renderWith(load, client);
    expect(await screen.findByText("ביומן")).toBeInTheDocument();
    auth.user = { id: "u2", full_name: "ב", email: "b@example.com" };
    view.rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter><Routes><Route path="/" element={<Account loadEnquiries={load} now={NOW} />} /></Routes></MemoryRouter>
      </QueryClientProvider>
    );
    expect(await screen.findByText("עוד אין כאן פניות")).toBeInTheDocument();
    expect(screen.queryByText("ביומן")).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    auth.user = { full_name: "רונית אבני", email: "ronit@example.com" };
  });

  it("does not retry a signed-out load", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    const out = vi.fn<() => Promise<Enquiry[]>>(() => Promise.reject(new AccountLoadError("signed_out")));
    renderWith(out, client);
    await screen.findByText("מסך הכניסה");
    await new Promise((r) => setTimeout(r, 200));
    expect(out).toHaveBeenCalledTimes(1);
  });

  it("announces loading as a status", async () => {
    renderWith(() => new Promise(() => {}));
    expect(await screen.findByRole("status")).toHaveTextContent("טוען");
  });

  it("signs out and goes to sign in again, to switch to another Google account", async () => {
    renderWith(async () => []);
    const button = await screen.findByRole("button", { name: "יציאה והתחברות עם חשבון אחר" });
    button.click();
    expect(logoutSpy).toHaveBeenCalledWith(true, `${window.location.origin}/login?returnTo=/account`);
  });
});
