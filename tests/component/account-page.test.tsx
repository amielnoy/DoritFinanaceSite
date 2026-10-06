// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { base44Mock } from "./base44-mock";

vi.mock("@/api/base44Client", () => ({ base44: base44Mock }));
// The page imports the composition root, which reads the stored-token flag.
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: { full_name: "רונית אבני", email: "ronit@example.com" }, isAuthenticated: true }),
}));

import Account from "@/pages/Account";
import { AccountLoadError, type Enquiry } from "@/services/ports";

const base: Enquiry = {
  createdAt: "2026-10-06T07:55:18Z", source: "interview", track: "pension", trackLabel: "פנסיה, גמל והשתלמות",
  meetingTopic: "גמל, השתלמות ופנסיה", timing: "ראשון 10:00", scheduledAt: "2026-10-11T07:00:00Z",
  summary: "סיכום", profile: [["יעד עיקרי", "פרישה"]], completed: true, inCalendar: true,
};

const renderWith = (load: () => Promise<Enquiry[]>) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<Account loadEnquiries={load} />} />
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

  it("links to the privacy rights", async () => {
    renderWith(async () => []);
    expect(await screen.findByRole("link", { name: /עיון, תיקון או מחיקה/ })).toHaveAttribute("href", "/privacy");
  });
});
