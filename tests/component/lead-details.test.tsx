// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it } from "vitest";
import LeadDetails, { parseLeadDetails } from "@/components/dorit/admin/LeadDetails";
import type { LeadRecord } from "@/services";

/**
 * The details cell on /admin/leads: an interview's "label: value" profile as a
 * narrow card, top to bottom, folded after three answers in the table.
 */
const interview = {
  id: "l-1",
  topic: "גמל, השתלמות ופנסיה",
  timing: "יום שני, 19.10, צהריים 12:00–15:00",
  message: [
    "שלב חיים: ילדים בוגרים",
    "יעד עיקרי: להוריד עלויות",
    "דאגה מרכזית: דמי ניהול / הפנסיה שלי",
    "שליפת נתוני מסלקה — מעוניין/ת: מעוניין/ת",
    "מוצרים קיימים: פנסיה, גמל, השתלמות",
    "דחיפות: דחוף — אשמח לשיחה השבוע",
  ].join("\n"),
} as unknown as LeadRecord;

const quick = { id: "l-2", topic: "", timing: "", message: "רוצה לשפר את ביצועי החיסכון לטווח ארוך" } as unknown as LeadRecord;

describe("parseLeadDetails", () => {
  it("splits an interview profile into rows, and lifts the urgency out", () => {
    const d = parseLeadDetails(interview);
    expect(d.rows.map((r) => r.label)).toEqual([
      "שלב חיים", "יעד עיקרי", "דאגה מרכזית", "שליפת נתוני מסלקה — מעוניין/ת", "מוצרים קיימים",
    ]);
    expect(d.urgency).toBe("דחוף — אשמח לשיחה השבוע");
    expect(d.prose).toBe("");
  });

  it("keeps a free-text message as prose, even when it holds a colon", () => {
    const note = "[הועבר לטיפול אנושי — המבקר ביקש לדבר עם אדם] עמיאל, שכיר. ביקש פגישה למחר בשעה 14:00, כי יש לו שאלה על מסלולי ההשקעה שלו ועל דמי הניהול: מה כדאי לבדוק קודם.";
    const d = parseLeadDetails({ topic: "", timing: "", message: note } as unknown as LeadRecord);
    expect(d.rows).toEqual([]);
    expect(d.prose).toBe(note);
  });
});

describe("<LeadDetails />", () => {
  it("shows the topic, the time and the urgency, then three answers and 'עוד'", () => {
    render(<LeadDetails lead={interview} />);
    expect(screen.getByText("גמל, השתלמות ופנסיה")).toBeInTheDocument();
    expect(screen.getByText(/יום שני, 19\.10/)).toBeInTheDocument();
    expect(screen.getByText("דחוף — אשמח לשיחה השבוע")).toBeInTheDocument();
    expect(screen.getByText("ילדים בוגרים")).toBeInTheDocument();
    expect(screen.getByText("דמי ניהול / הפנסיה שלי")).toBeInTheDocument();
    expect(screen.queryByText("פנסיה, גמל, השתלמות")).toBeNull();
    expect(screen.getByRole("button", { name: /עוד 2 פרטים/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("unfolds the rest in place, and folds it back", async () => {
    const user = userEvent.setup();
    render(<LeadDetails lead={interview} />);
    await user.click(screen.getByRole("button", { name: /עוד 2 פרטים/ }));
    expect(screen.getByText("פנסיה, גמל, השתלמות")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /פחות/ }));
    expect(screen.queryByText("פנסיה, גמל, השתלמות")).toBeNull();
  });

  it("shows everything, with no fold, in the drawer", () => {
    render(<LeadDetails lead={interview} compact={false} />);
    expect(screen.getByText("פנסיה, גמל, השתלמות")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a short quick-form message as it is, with no fold", () => {
    render(<LeadDetails lead={quick} />);
    expect(screen.getByText("רוצה לשפר את ביצועי החיסכון לטווח ארוך")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps a time range in reading order inside the Hebrew", () => {
    const { container } = render(<LeadDetails lead={interview} />);
    const range = container.querySelector("bdi[dir=ltr]");
    expect(range?.textContent).toBe("12:00–15:00");
  });

  it("shows a dash for a lead with no details", () => {
    render(<LeadDetails lead={{ id: "l-3", topic: "", timing: "", message: "" } as unknown as LeadRecord} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("turns a stored claim document into a button, not a link", () => {
    const claim = { id: "l-4", topic: "", timing: "", message: "מסמכים: storage:claim-documents/a/b.pdf" } as unknown as LeadRecord;
    render(<LeadDetails lead={claim} />);
    expect(screen.getByRole("button", { name: "מסמך 1" })).toBeInTheDocument();
    expect(screen.queryByText(/storage:claim-documents/)).toBeNull();
  });
});
