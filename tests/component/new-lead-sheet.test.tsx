// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * "פנייה חדשה": the side sheet a member fills in right after a call. The port
 * under it (`@/services`) is the fake, so what the sheet sends is checked.
 */

const A1 = "00000000-0000-0000-0000-000000000001";
const h = vi.hoisted(() => ({
  createLead: vi.fn(),
  addMeeting: vi.fn(),
  toast: vi.fn(),
  meetingsStaff: true,
}));
vi.mock("@/services", () => ({ services: { leadsAdmin: { createLead: h.createLead, addMeeting: h.addMeeting } } }));
vi.mock("@/components/ui/use-toast", () => ({ toast: h.toast }));
vi.mock("@/config/meetings", async (original) => ({
  ...(await original<typeof import("@/config/meetings")>()),
  get MEETINGS_STAFF() {
    return h.meetingsStaff;
  },
}));

const { default: NewLeadSheet } = await import("@/components/dorit/admin/NewLeadSheet");
const { STAFF_INTAKE_NOTICE } = await import("@/config/staff-leads");

const onClose = vi.fn();
const onCreated = vi.fn();
const onSaved = vi.fn();
const onOpenExisting = vi.fn();

function show(over: Record<string, unknown> = {}) {
  return render(
    <NewLeadSheet
      open
      onClose={onClose}
      agencyId={A1}
      canAssign={false}
      assignees={[{ id: "u-2", label: "נועה" }]}
      onCreated={onCreated}
      onSaved={onSaved}
      onOpenExisting={onOpenExisting}
      {...over}
    />,
  );
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = () => screen.getByRole("button", { name: "שמירה" });

function fillRequired(method: "verbal" | "email" | "whatsapp" = "verbal") {
  type("שם", "דנה כהן");
  type("טלפון", "050-123 4567");
  fireEvent.click(screen.getByRole("button", { name: "שיחת טלפון" }));
  fireEvent.click(screen.getByLabelText("יידעתי את הפונה איך ישמשו הפרטים שלו/ה"));
  fireEvent.click(screen.getByLabelText({ verbal: "בעל פה", email: "במייל", whatsapp: "בוואטסאפ" }[method]));
}

beforeEach(() => {
  h.meetingsStaff = true;
  h.createLead.mockResolvedValue({ leadId: "L1", duplicate: null, noticeSent: null });
  h.addMeeting.mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NewLeadSheet", () => {
  it("keeps שמירה disabled until name, a valid phone, an intake and the notice are set", () => {
    show();
    expect(save()).toBeDisabled();
    type("שם", "דנה כהן");
    type("טלפון", "12");
    fireEvent.click(screen.getByRole("button", { name: "שיחת טלפון" }));
    fireEvent.click(screen.getByLabelText("יידעתי את הפונה איך ישמשו הפרטים שלו/ה"));
    fireEvent.click(screen.getByLabelText("בעל פה"));
    expect(save()).toBeDisabled();
    type("טלפון", "050-123 4567");
    expect(save()).toBeEnabled();
    fireEvent.click(screen.getByLabelText("יידעתי את הפונה איך ישמשו הפרטים שלו/ה"));
    expect(save()).toBeDisabled();
  });

  it("shows no assignee field for a User, and defaults to אני for an Admin", () => {
    const first = show();
    expect(screen.queryByLabelText("שיוך")).toBeNull();
    first.unmount();
    show({ canAssign: true });
    const select = screen.getByLabelText("שיוך") as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe("אני");
    expect([...select.options].map((o) => o.textContent)).toEqual(["אני", "ללא שיוך", "נועה"]);
  });

  it("sends no assignee for אני (the server assigns the caller), and \"none\" for ללא שיוך", async () => {
    show({ canAssign: true });
    fillRequired();
    fireEvent.click(save());
    await waitFor(() => expect(h.createLead).toHaveBeenCalledTimes(1));
    expect(h.createLead.mock.calls[0][0].assignee).toBeUndefined();
    cleanup();
    show({ canAssign: true });
    fillRequired();
    type("שיוך", "none");
    fireEvent.click(save());
    await waitFor(() => expect(h.createLead).toHaveBeenCalledTimes(2));
    expect(h.createLead.mock.calls[1][0]).toEqual(expect.objectContaining({ assignee: "none" }));
  });

  it("caps the name at 80, as the server does", () => {
    show();
    expect(screen.getByLabelText("שם")).toHaveAttribute("maxlength", "80");
  });

  it("asks מי הפנה (max 120) only for הפניה", () => {
    show();
    expect(screen.queryByLabelText("מי הפנה")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "הפניה" }));
    expect(screen.getByLabelText("מי הפנה")).toHaveAttribute("maxlength", "120");
  });

  it("disables במייל without an email, and shows the notice with a copy button for וואטסאפ", async () => {
    show();
    expect(screen.getByLabelText("במייל")).toBeDisabled();
    type("אימייל", "d@example.com");
    expect(screen.getByLabelText("במייל")).toBeEnabled();
    fireEvent.click(screen.getByLabelText("בוואטסאפ"));
    fireEvent.click(screen.getByRole("button", { name: "העתקת הנוסח" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(STAFF_INTAKE_NOTICE);
  });

  it("sends contacted by default, with the notes in notes", async () => {
    show();
    fillRequired();
    type("הערות פנימיות", "ביקשה לחזור אחרי החגים");
    expect(screen.getByText("לא מוצגות ללקוח")).toBeInTheDocument();
    fireEvent.click(save());
    await waitFor(() => expect(h.createLead).toHaveBeenCalledTimes(1));
    expect(h.createLead).toHaveBeenCalledWith(
      expect.objectContaining({
        agencyId: A1, name: "דנה כהן", phone: "050-123 4567", intake: "phone", status: "contacted",
        notice: "verbal", notes: "ביקשה לחזור אחרי החגים",
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("L1"));
  });

  it("sends the chosen assignee and the referrer", async () => {
    show({ canAssign: true });
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "הפניה" }));
    type("מי הפנה", "רו״ח משה");
    type("שיוך", "u-2");
    fireEvent.click(save());
    await waitFor(() => expect(h.createLead).toHaveBeenCalled());
    expect(h.createLead).toHaveBeenCalledWith(expect.objectContaining({ intake: "referral", referrer: "רו״ח משה", assignee: "u-2" }));
  });

  it("for a visible duplicate offers to open it or to create anyway", async () => {
    h.createLead.mockResolvedValueOnce({ leadId: "OLD", duplicate: "visible", noticeSent: null });
    show({ leads: [{ id: "OLD", name: "דנה כהן", phone: "0501234567", source: "quick", status: "new", created_date: "2026-10-10T08:00:00Z" }] });
    fillRequired();
    fireEvent.click(save());
    expect(await screen.findByText(/דנה כהן/, { selector: "p, strong, span" })).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "פתיחת הפנייה הקיימת" }));
    expect(onOpenExisting).toHaveBeenCalledWith("OLD");
    fireEvent.click(screen.getByRole("button", { name: "פנייה חדשה לאותו אדם" }));
    await waitFor(() => expect(h.createLead).toHaveBeenCalledTimes(2));
    expect(h.createLead.mock.calls[1][0]).toEqual(expect.objectContaining({ duplicateOk: true }));
  });

  it("for a visible duplicate it cannot find shows just the two buttons", async () => {
    h.createLead.mockResolvedValueOnce({ leadId: "OLD", duplicate: "visible", noticeSent: null });
    show();
    fillRequired();
    fireEvent.click(save());
    expect(await screen.findByText("הפנייה כבר קיימת אצלך")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פתיחת הפנייה הקיימת" })).toBeInTheDocument();
  });

  it("for a hidden duplicate says so in the confirmation", async () => {
    h.createLead.mockResolvedValueOnce({ leadId: "L2", duplicate: "hidden", noticeSent: null });
    show();
    fillRequired();
    fireEvent.click(save());
    expect(await screen.findByText(/המספר כבר קיים בסוכנות — מנהל\/ת יבדוק\/תבדוק/)).toBeInTheDocument();
    // The list is read again now: closing the confirmation with ✕ calls only onClose.
    expect(onSaved).toHaveBeenCalledWith("L2");
    expect(onCreated).not.toHaveBeenCalled();
    expect(h.toast).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "פתיחת הפנייה" }));
    expect(onCreated).toHaveBeenCalledWith("L2");
  });

  it("tells the member when the notice mail was not sent", async () => {
    h.createLead.mockResolvedValueOnce({ leadId: "L3", duplicate: null, noticeSent: false });
    show();
    type("אימייל", "d@example.com");
    fillRequired("email");
    fireEvent.click(save());
    expect(await screen.findByText(/הנוסח לא נשלח/)).toBeInTheDocument();
    expect(screen.getByText(/שלח/, { selector: "p" })).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith("L3");
  });

  it("does not call onSaved on a plain create: onCreated reads the list again", async () => {
    show();
    fillRequired();
    fireEvent.click(save());
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("L1"));
    expect(onSaved).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledTimes(1);
  });

  it("offers קבענו כבר פגישה only with VITE_MEETINGS_STAFF", () => {
    h.meetingsStaff = false;
    show();
    expect(screen.queryByLabelText("קבענו כבר פגישה")).toBeNull();
    cleanup();
    h.meetingsStaff = true;
    show();
    expect(screen.getByLabelText("קבענו כבר פגישה")).toBeInTheDocument();
  });

  it("writes the first meeting after the lead, in Israel time", async () => {
    show();
    fillRequired();
    fireEvent.click(screen.getByLabelText("קבענו כבר פגישה"));
    type("תאריך", "2026-10-22");
    type("שעה", "10:30");
    type("אופן", "phone");
    type("מקום", "משרד");
    fireEvent.click(save());
    await waitFor(() => expect(h.addMeeting).toHaveBeenCalledTimes(1));
    expect(h.addMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: "L1", agencyId: A1, kind: "first", mode: "phone", durationMin: 45, scheduledAt: "2026-10-22T07:30:00.000Z", location: "משרד" }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("L1"));
  });

  it("keeps the created lead when the meeting fails, and says so", async () => {
    h.addMeeting.mockRejectedValueOnce(new Error("x"));
    show();
    fillRequired();
    fireEvent.click(screen.getByLabelText("קבענו כבר פגישה"));
    type("תאריך", "2026-10-22");
    fireEvent.click(save());
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("L1"));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining("הפגישה לא נשמרה") }));
  });

  it("shows the server's Hebrew message when the save fails, and stays open", async () => {
    h.createLead.mockRejectedValueOnce(new Error("יותר מדי פניות"));
    show();
    fillRequired();
    fireEvent.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("יותר מדי פניות");
    expect(onCreated).not.toHaveBeenCalled();
  });
});
