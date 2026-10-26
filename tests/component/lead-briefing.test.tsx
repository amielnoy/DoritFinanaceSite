// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * "תדריך לפני שיחה" (feature 4): the drawer's tab exists only when the page
 * gives it (VITE_LEAD_BRIEFING); it shows the newest briefing with the AI-draft
 * note, or the button that makes one.
 */
const h = vi.hoisted(() => ({
  briefing: null as Record<string, unknown> | null,
  generate: { mutate: vi.fn(), isPending: false, isError: false, error: null as Error | null },
}));

vi.mock("@/hooks/useAdmin", () => ({
  useLeadBriefing: () => ({ data: h.briefing, isPending: false, isError: false }),
  useGenerateBriefing: () => h.generate,
  useLeadMeetings: () => ({ data: [], isPending: false, isError: false }),
}));

const { default: LeadBriefing, BRIEFING_NOTE } = await import("@/components/dorit/admin/LeadBriefing");
const { default: LeadDrawer } = await import("@/components/dorit/admin/LeadDrawer");

const lead = { id: "l1", name: "רחל לוי", phone: "054-1234567", status: "new", source: "interview" } as never;
const memberLabel = (id: string | null) => (id === "u1" ? "דורית" : "—");

describe("the briefing tab", () => {
  beforeEach(() => {
    h.briefing = null;
    h.generate = { mutate: vi.fn(), isPending: false, isError: false, error: null };
  });

  it("offers to make a briefing, with the note on what it is", () => {
    render(<LeadBriefing lead={lead} memberLabel={memberLabel} />);
    expect(screen.getByText(BRIEFING_NOTE)).toBeTruthy();
    expect(BRIEFING_NOTE).toContain("אינה ייעוץ");
    fireEvent.click(screen.getByRole("button", { name: /תדריך לפני שיחה/ }));
    expect(h.generate.mutate).toHaveBeenCalledWith("l1");
  });

  it("shows the four parts of the newest briefing, who made it, and remaking it", () => {
    h.briefing = {
      id: "7",
      summary: ["הורה לילדים קטנים", "רוצה להבין את מצב הפנסיה"],
      concern: "חוסר ודאות לגבי החיסכון",
      questions: ["מתי בדקת לאחרונה?", "כמה קופות יש לך?", "מה חשוב לך?"],
      talkingPoints: ["בדיקת הכספים במסלקה"],
      createdAt: "2026-10-26T09:00:00Z",
      createdBy: "u1",
    };
    render(<LeadBriefing lead={lead} memberLabel={memberLabel} />);
    for (const heading of ["תקציר הראיון", "הדאגה המרכזית", "שאלות מוצעות לשיחה", "נושאים לשיחה"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText("חוסר ודאות לגבי החיסכון")).toBeTruthy();
    expect(screen.getByText(/דורית/)).toBeTruthy();
    expect(screen.getByText(BRIEFING_NOTE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /יצירה מחדש/ }));
    expect(h.generate.mutate).toHaveBeenCalledWith("l1");
  });

  it("says when a briefing is being made, and why one was not", () => {
    h.generate = { mutate: vi.fn(), isPending: true, isError: true, error: new Error("הגעתם לתקרת התקציב החודשית לתדריכים.") };
    render(<LeadBriefing lead={lead} memberLabel={memberLabel} />);
    const button = screen.getByRole("button", { name: /מכין תדריך/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("תקרת התקציב");
  });
});

describe("the drawer", () => {
  const drawer = (briefing: React.ReactNode) =>
    render(
      <LeadDrawer lead={lead} subtitle="" details={<p>פרטים</p>} activity={<p>פעילות</p>} briefing={briefing} showMeetings={false} onClose={() => {}} />,
    );

  it("has no briefing tab when the page gives none (the flag off)", () => {
    drawer(null);
    expect(screen.queryByRole("tab", { name: "תדריך" })).toBeNull();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["פרטים", "פעילות"]);
  });

  it("opens the briefing tab when given", () => {
    drawer(<p>התדריך כאן</p>);
    fireEvent.click(screen.getByRole("tab", { name: "תדריך" }));
    expect(screen.getByText("התדריך כאן")).toBeTruthy();
  });
});
