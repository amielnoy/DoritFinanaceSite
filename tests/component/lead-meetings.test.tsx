// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The lead drawer and its "פגישות" tab on /admin/leads
 * (docs/superpowers/specs/2026-10-17-client-meetings-design.md, rollout 2;
 * behind VITE_MEETINGS_STAFF). The meeting hooks are the real ones; the
 * service under them is the fake, so what each button sends is what is checked.
 */
const h = vi.hoisted(() => ({
  staff: true,
  leads: [
    { id: "l-1", name: "יעל כהן", phone: "0521234567", email: "yael@example.com", source: "consultation", status: "client",
      topic: "פנסיה", created_date: "2026-09-03T06:30:00Z", agency_id: "00000000-0000-0000-0000-000000000001", assigned_user_id: "u-user" },
  ] as Record<string, unknown>[],
  meetings: [] as Record<string, unknown>[],
  service: {
    meetings: vi.fn(),
    addMeeting: vi.fn(),
    updateMeeting: vi.fn(),
    handleMeetingRequest: vi.fn(),
    documentLink: vi.fn(),
  },
}));

vi.mock("@/config/meetings", () => ({
  get MEETINGS_STAFF() {
    return h.staff;
  },
  MEETINGS_CLIENT: false,
}));
vi.mock("@/hooks/useAdmin", async (importActual) => ({
  ...(await importActual<typeof import("@/hooks/useAdmin")>()),
  useLeads: () => ({ data: h.leads, isPending: false, isError: false }),
  useSetLeadStatus: () => ({ mutate: vi.fn(), isError: false }),
  useRemoveLead: () => ({ mutate: vi.fn(), isError: false }),
  useMergeLeads: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useUnmergeLead: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useLeadEvents: () => ({ data: [], isPending: false, isError: false }),
  useAddLeadNote: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useSetFollowUp: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useAssignLead: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useAdminUsers: () => ({ data: [] }),
  useTranscriptLeadIds: () => ({ data: [] }),
  useLeadTranscript: () => ({ data: undefined, isLoading: false, error: null }),
}));
vi.mock("@/services", () => ({ services: { leadsAdmin: h.service } }));
// Rendered without an AuthProvider: nobody is signed in (useCurrentUserId reads useAuth).
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/components/dorit/admin/LeadTrackingPanel", () => ({ default: () => null }));
const role = vi.hoisted(() => ({ role: "owner", isOperator: false }) as import("../helpers/agency-role-mock").RoleState);
vi.mock("@/hooks/useAgency", async () => (await import("../helpers/agency-role-mock")).agencyHookMock(role));

const { default: Leads } = await import("@/pages/Leads");

const meeting = (over: Record<string, unknown> = {}) => ({
  id: "m-1", scheduledAt: "2026-09-22T08:00:00.000Z", durationMin: 60, topic: "ניתוח המסלקה הפנסיונית", kind: "follow_up",
  status: "done", mode: "office", location: "", notes: "שתי קופות ישנות", clientSummary: "", summaryPublishedAt: null,
  source: null, openRequest: null, ...over,
});

function renderLeads() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Leads /></MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Open the drawer on the lead, and its meetings tab. */
async function openMeetings() {
  renderLeads();
  fireEvent.click(screen.getByRole("button", { name: "יעל כהן" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByRole("tab", { name: /פגישות/ }));
  return dialog;
}

beforeEach(() => {
  h.staff = true;
  role.role = "owner";
  for (const fn of Object.values(h.service)) fn.mockReset();
  h.service.meetings.mockImplementation(async () => h.meetings);
  h.service.addMeeting.mockResolvedValue(undefined);
  h.service.updateMeeting.mockResolvedValue(undefined);
  h.service.handleMeetingRequest.mockResolvedValue(undefined);
  h.meetings = [meeting()];
});

describe("the lead drawer, behind VITE_MEETINGS_STAFF", () => {
  it("opens the drawer without its meetings tab when the switch is off, and reads no meetings", async () => {
    h.staff = false;
    renderLeads();
    fireEvent.click(screen.getByRole("button", { name: "יעל כהן" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("tab", { name: "פרטים" })).toBeTruthy();
    expect(within(dialog).getByRole("tab", { name: "פעילות" })).toBeTruthy();
    expect(within(dialog).queryByRole("tab", { name: /^פגישות/ })).toBeNull();
    expect(h.service.meetings).not.toHaveBeenCalled();
  });

  it("opens on the lead's name, with its details and a meetings tab that counts them", async () => {
    h.meetings = [meeting(), meeting({ id: "m-2" })];
    renderLeads();
    fireEvent.click(screen.getByRole("button", { name: "יעל כהן" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("tab", { name: "פרטים", selected: true })).toBeTruthy();
    expect(within(dialog).getByText("yael@example.com")).toBeTruthy();
    expect(await within(dialog).findByRole("tab", { name: "פגישות · 2" })).toBeTruthy();
    expect(h.service.meetings).toHaveBeenCalledWith("l-1");
  });
});

describe("the meetings tab", () => {
  it("publishes the client summary, with the time it was published", async () => {
    const dialog = await openMeetings();
    fireEvent.click(await within(dialog).findByRole("button", { name: /ניתוח המסלקה/ }));
    fireEvent.change(within(dialog).getByLabelText(/סיכום ללקוח/), { target: { value: "  עברנו על החשבונות  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "פרסום ללקוח" }));
    await waitFor(() => expect(h.service.updateMeeting).toHaveBeenCalled());
    const [id, update] = h.service.updateMeeting.mock.calls[0];
    expect(id).toBe("m-1");
    expect(update.clientSummary).toBe("עברנו על החשבונות");
    expect(Number.isNaN(Date.parse(update.summaryPublishedAt))).toBe(false);
  });

  it("does not offer to publish an empty summary", async () => {
    const dialog = await openMeetings();
    fireEvent.click(await within(dialog).findByRole("button", { name: /ניתוח המסלקה/ }));
    expect((within(dialog).getByRole("button", { name: "פרסום ללקוח" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("unpublishes a published summary, and says when it was published", async () => {
    h.meetings = [meeting({ clientSummary: "סיכמנו", summaryPublishedAt: "2026-09-23T06:12:00.000Z" })];
    const dialog = await openMeetings();
    fireEvent.click(await within(dialog).findByRole("button", { name: /ניתוח המסלקה/ }));
    // 06:12Z is 09:12 in Israel.
    expect(within(dialog).getByText(/פורסם ללקוח · 23.9, 09:12/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "ביטול פרסום" }));
    await waitFor(() => expect(h.service.updateMeeting).toHaveBeenCalledWith("m-1", { summaryPublishedAt: null }));
  });

  it("keeps Dorit's notes labelled as staff-only, apart from the client's summary", async () => {
    const dialog = await openMeetings();
    fireEvent.click(await within(dialog).findByRole("button", { name: /ניתוח המסלקה/ }));
    const notes = within(dialog).getByLabelText(/הערות פנימיות/) as HTMLTextAreaElement;
    expect(notes.value).toBe("שתי קופות ישנות");
    expect(within(dialog).getByText("— רק הצוות רואה")).toBeTruthy();
    expect((within(dialog).getByLabelText(/סיכום ללקוח/) as HTMLTextAreaElement).value).toBe("");
  });

  it("shows the client's open request and marks it handled", async () => {
    h.meetings = [meeting({ status: "scheduled", openRequest: { id: "r-1", kind: "reschedule", note: "אחר הצהריים" } })];
    const dialog = await openMeetings();
    const banner = await within(dialog).findByRole("status");
    expect(within(banner).getByText("הלקוח ביקש מועד אחר")).toBeTruthy();
    expect(banner.textContent).toContain("אחר הצהריים");
    fireEvent.click(within(banner).getByRole("button", { name: "טופל" }));
    await waitFor(() => expect(h.service.handleMeetingRequest).toHaveBeenCalledWith("r-1"));
    expect(h.service.updateMeeting).not.toHaveBeenCalled();
  });

  it("adds a meeting in the lead's agency, on Israel's clock", async () => {
    const dialog = await openMeetings();
    fireEvent.click(within(dialog).getByRole("button", { name: /פגישה חדשה/ }));
    const form = within(dialog).getByRole("form", { name: "פגישה חדשה" });
    fireEvent.change(within(form).getByLabelText("תאריך"), { target: { value: "2026-12-14" } });
    fireEvent.change(within(form).getByLabelText("שעה"), { target: { value: "17:30" } });
    fireEvent.change(within(form).getByLabelText("סוג"), { target: { value: "annual_review" } });
    fireEvent.click(within(form).getByRole("button", { name: "שמירת הפגישה" }));
    await waitFor(() => expect(h.service.addMeeting).toHaveBeenCalled());
    expect(h.service.addMeeting.mock.calls[0][0]).toMatchObject({
      leadId: "l-1", agencyId: "00000000-0000-0000-0000-000000000001", scheduledAt: "2026-12-14T15:30:00.000Z", kind: "annual_review",
    });
  });

  it("says why a meeting was not added, in the service's words", async () => {
    h.service.addMeeting.mockRejectedValue(new Error("הפעולה לא בוצעה — אין הרשאה או שהפנייה כבר לא קיימת"));
    const dialog = await openMeetings();
    fireEvent.click(within(dialog).getByRole("button", { name: /פגישה חדשה/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "שמירת הפגישה" }));
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("לא בוצעה"));
  });
});

describe("a User", () => {
  it("opens only the leads the table holds — their assigned ones — and reads only that lead's meetings", async () => {
    // Row-level security decides the list: a User's holds only their assigned leads.
    role.role = "user";
    renderLeads();
    expect(screen.getAllByRole("button", { name: /כהן/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "יעל כהן" }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(h.service.meetings).toHaveBeenCalled());
    expect(h.service.meetings.mock.calls.every(([id]) => id === "l-1")).toBe(true);
  });

  it("is told when a write is refused, rather than shown it saved", async () => {
    role.role = "user";
    h.service.updateMeeting.mockRejectedValue(new Error("הפעולה לא בוצעה — אין הרשאה או שהפנייה כבר לא קיימת"));
    const dialog = await openMeetings();
    fireEvent.click(await within(dialog).findByRole("button", { name: /ניתוח המסלקה/ }));
    fireEvent.change(within(dialog).getByLabelText("סטטוס"), { target: { value: "no_show" } });
    expect(await within(dialog).findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("לא בוצעה"));
  });
});
