// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/services", async (importOriginal) => (await import("./services-mock")).servicesModule(importOriginal));
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: { full_name: "יעל כהן", email: "yael@example.com", id: "u-1" }, isAuthenticated: true, logout: vi.fn() }),
}));

import Account from "@/pages/Account";
import type { ClientMeeting } from "@/lib/meetings";

/*
 * "הפגישות שלי" in /account (docs/superpowers/specs/2026-10-17-client-meetings-design.md,
 * rollout 4; the canvas "הפגישות שלי — לקוח"), behind VITE_MEETINGS_CLIENT.
 */
const NOW = new Date("2026-10-20T09:00:00Z");
const meeting = (over: Partial<ClientMeeting> = {}): ClientMeeting => ({
  id: "m-next", scheduledAt: "2026-11-04T08:00:00.000Z", durationMin: 45, topic: "סקירה שנתית — פנסיה וגמל", kind: "annual_review",
  status: "scheduled", mode: "office", location: "[כתובת המשרד]", clientSummary: null, summaryPublishedAt: null, inCalendar: true,
  openRequest: null, ...over,
});
const LIST: ClientMeeting[] = [
  meeting(),
  meeting({ id: "m-later", scheduledAt: "2026-12-14T15:30:00.000Z", topic: "ביטוח בריאות וחיים — בדיקת כפלים", kind: "follow_up", mode: "video", openRequest: "reschedule" }),
  meeting({ id: "m-past", scheduledAt: "2026-09-22T08:00:00.000Z", status: "done", topic: "ניתוח המסלקה הפנסיונית", clientSummary: "עברנו על כל החשבונות.", summaryPublishedAt: "2026-09-23T06:12:00.000Z" }),
  meeting({ id: "m-first", scheduledAt: "2026-09-03T06:30:00.000Z", status: "done", topic: "פגישת היכרות", kind: "first", mode: "phone" }),
  meeting({ id: "m-cancel", scheduledAt: "2026-08-10T08:00:00.000Z", status: "cancelled", topic: "שיחה" }),
];

function renderAccount(props: Partial<React.ComponentProps<typeof Account>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Account loadEnquiries={async () => []} loadMeetings={async () => LIST} snapshotEnabled={false} meetingsEnabled now={NOW} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the meetings tab", () => {
  it("is absent, and the page as it was, when the switch is off", async () => {
    renderAccount({ meetingsEnabled: false });
    expect(screen.queryByRole("tab", { name: "הפגישות שלי" })).toBeNull();
    expect(await screen.findByText("עוד אין כאן פניות")).toBeTruthy();
  });

  it("opens first, with the next meeting on its own card, on Israel's clock", async () => {
    renderAccount();
    expect(screen.getByRole("tab", { name: "הפגישות שלי", selected: true })).toBeTruthy();
    const next = (await screen.findByRole("heading", { name: "סקירה שנתית — פנסיה וגמל" })).closest("article")!;
    expect(within(next).getByText(/10:00–10:45 · 45 דקות/)).toBeTruthy();
    expect(within(next).getByText("ביומן של דורית")).toBeTruthy();
    expect(within(next).getByRole("button", { name: /הוספה ליומן שלי/ })).toBeTruthy();
  });

  it("shows a published summary under 'מה סיכמנו', and nothing for a meeting without one", async () => {
    renderAccount();
    const past = (await screen.findByRole("heading", { name: "ניתוח המסלקה הפנסיונית" })).closest("li")!;
    expect(within(past).getByText("מה סיכמנו")).toBeTruthy();
    expect(within(past).getByText("עברנו על כל החשבונות.")).toBeTruthy();
    const first = screen.getByRole("heading", { name: "פגישת היכרות" }).closest("li")!;
    expect(within(first).queryByText("מה סיכמנו")).toBeNull();
  });

  it("keeps cancelled meetings collapsed, and the pension-marketing line under the summaries", async () => {
    renderAccount();
    expect(await screen.findByText("פגישה אחת בוטלה")).toBeTruthy();
    expect(screen.getByText(/שיווק פנסיוני ולא ייעוץ פנסיוני אובייקטיבי/)).toBeTruthy();
  });

  it("shows an open request as waiting for Dorit, with no button to ask again", async () => {
    renderAccount();
    const later = (await screen.findByRole("heading", { name: "ביטוח בריאות וחיים — בדיקת כפלים" })).closest("li")!;
    const waiting = within(later).getByRole("button", { name: /ביקשת מועד אחר — דורית תחזור אליך/ }) as HTMLButtonElement;
    expect(waiting.disabled).toBe(true);
  });

  it("sends a change request from the sheet, and says the meeting stays until Dorit confirms", async () => {
    const requestChange = vi.fn(async () => {});
    renderAccount({ requestChange });
    fireEvent.click(await screen.findByRole("button", { name: /בקשה לשינוי מועד או ביטול/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByText("הפגישה נשארת ביומן כפי שהיא עד שדורית תאשר את השינוי.")).toBeTruthy();
    fireEvent.click(within(sheet).getByLabelText(/ביטול הפגישה/));
    fireEvent.change(within(sheet).getByLabelText(/הערה לדורית/), { target: { value: "  נסיעה לחו״ל  " } });
    fireEvent.click(within(sheet).getByRole("button", { name: "שליחת הבקשה לדורית" }));
    await waitFor(() => expect(requestChange).toHaveBeenCalledWith("m-next", "cancel", "נסיעה לחו״ל"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the sheet open with the refusal in its own words", async () => {
    const requestChange = vi.fn(async () => {
      throw new Error("כבר נשלחה בקשה לפגישה הזו. דורית תחזור אליך.");
    });
    renderAccount({ requestChange });
    fireEvent.click(await screen.findByRole("button", { name: /בקשה לשינוי מועד או ביטול/ }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "שליחת הבקשה לדורית" }));
    expect(await within(sheet).findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("כבר נשלחה בקשה"));
  });

  it("renders a summary as text, never as markup", async () => {
    renderAccount({ loadMeetings: async () => [meeting({ id: "x", status: "done", scheduledAt: "2026-09-01T08:00:00Z", clientSummary: "<b>מודגש</b> **כוכבים**", summaryPublishedAt: "2026-09-02T08:00:00Z" })] });
    expect(await screen.findByText("<b>מודגש</b> **כוכבים**")).toBeTruthy();
    expect(document.querySelector("b")).toBeNull();
  });

  it("offers a booking when there is no meeting yet", async () => {
    renderAccount({ loadMeetings: async () => [] });
    expect(await screen.findByText("עוד אין כאן פגישות")).toBeTruthy();
    expect(screen.getByRole("link", { name: "לתיאום פגישה עם דורית" }).getAttribute("href")).toBe("/#start");
  });
});
