// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * "פניות ופגישות" on /admin/leads, behind VITE_MEETINGS_STAFF: the leads and the
 * agency's agenda as two tabs, the tab in the URL, and the leads table's
 * "הפגישה הבאה". The hooks are the real ones; the port under them
 * (`@/services`) is the fake, so what each screen reads and sends is checked.
 * Row-level security decides which meetings arrive — the fake hands back what
 * a role's session would.
 */

const A1 = "00000000-0000-0000-0000-000000000001";
const h = vi.hoisted(() => ({
  staff: true,
  leads: [] as Record<string, unknown>[],
  agenda: [] as Record<string, unknown>[],
  leadMeetings: [] as Record<string, unknown>[],
  leadsAdmin: {
    list: vi.fn(),
    agencyMeetings: vi.fn(),
    meetings: vi.fn(),
    addMeeting: vi.fn(),
    updateMeeting: vi.fn(),
    handleMeetingRequest: vi.fn(),
    transcriptLeadIds: vi.fn(),
    transcript: vi.fn(),
    documentLink: vi.fn(),
    assign: vi.fn(),
    setStatus: vi.fn(),
    remove: vi.fn(),
  },
  usersList: vi.fn(),
}));

vi.mock("@/config/meetings", () => ({
  get MEETINGS_STAFF() {
    return h.staff;
  },
  MEETINGS_CLIENT: false,
}));
vi.mock("@/services", () => ({ services: { leadsAdmin: h.leadsAdmin, usersAdmin: { list: h.usersList } } }));
vi.mock("@/components/dorit/admin/LeadTrackingPanel", () => ({ default: () => <p>מעקב לידים</p> }));
const role = vi.hoisted(() => ({ role: "owner", isOperator: false }) as import("../helpers/agency-role-mock").RoleState);
vi.mock("@/hooks/useAgency", async () => (await import("../helpers/agency-role-mock")).agencyHookMock(role));

const { default: Leads } = await import("@/pages/Leads");

// Thursday 22 October 2026, 09:00 in Israel (+03:00). Summer time ends on Sunday the 25th.
const NOW = new Date("2026-10-22T06:00:00Z");

const lead = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, phone: `05${id.length}0000000`, email: "", source: "quick", status: "new", created_date: "2026-10-10T08:00:00Z",
  agency_id: A1, assigned_user_id: "u-me", ...over,
});
const agendaMeeting = (id: string, leadId: string, scheduledAt: string | null, over: Record<string, unknown> = {}) => ({
  id, leadId, leadName: (h.leads.find((l) => l.id === leadId)?.name as string) ?? "", assignedUserId: "u-me", scheduledAt,
  durationMin: 45, topic: "", kind: "follow_up", status: "scheduled", mode: "office", location: "", summaryPublishedAt: null,
  source: null, openRequest: null, ...over,
});
const member = (id: string, email: string, r: string) => ({
  id, email, role: "user", createdAt: "", memberships: [{ orgId: A1, orgName: "דורית", role: r, joinedAt: "" }],
});

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function show(path = `/admin/leads?agency=${A1}`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Leads />
        <Search />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const search = () => new URLSearchParams(screen.getByTestId("search").textContent ?? "");
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const toMeetings = async () => {
  fireEvent.click(tab(/^פגישות/));
  return screen.findByRole("tabpanel", { name: /^פגישות/ });
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.staff = true;
  role.role = "owner";
  role.isOperator = false;
  for (const fn of Object.values(h.leadsAdmin)) fn.mockReset();
  h.leads = [
    lead("l-1", "יעל כהן"),
    lead("l-2", "דן לוי", { status: "contacted" }),
    lead("l-3", "רונית בר", { assigned_user_id: null }),
    lead("l-4", "אבי שמש", { status: "escalated" }),
  ];
  h.agenda = [];
  h.leadMeetings = [];
  h.leadsAdmin.list.mockImplementation(async () => h.leads);
  h.leadsAdmin.agencyMeetings.mockImplementation(async () => h.agenda);
  h.leadsAdmin.meetings.mockImplementation(async () => h.leadMeetings);
  h.leadsAdmin.transcriptLeadIds.mockResolvedValue([]);
  h.leadsAdmin.handleMeetingRequest.mockResolvedValue(undefined);
  h.leadsAdmin.addMeeting.mockResolvedValue(undefined);
  h.usersList.mockResolvedValue([member("u-me", "me@example.com", "owner"), member("u-2", "two@example.com", "user")]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("without VITE_MEETINGS_STAFF", () => {
  it("is the leads screen as it was: no tabs, no next-meeting column, no meetings read", async () => {
    h.staff = false;
    show();
    expect(await screen.findByRole("heading", { name: "ניהול פניות" })).toBeInTheDocument();
    await screen.findByText("יעל כהן");
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "הפגישה הבאה" })).toBeNull();
    expect(h.leadsAdmin.agencyMeetings).not.toHaveBeenCalled();
  });
});

describe("the tabs", () => {
  it("are a tablist of two, under the heading 'פניות ופגישות', with the leads first", async () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "פניות ופגישות" })).toBeInTheDocument();
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("id"))).toEqual(["leads-tab-leads", "leads-tab-meetings"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-selected", "false");
    for (const t of tabs) expect(document.getElementById(t.getAttribute("aria-controls")!)).not.toBeNull();
    expect(screen.getByRole("tabpanel", { name: /^פניות/ })).toHaveAttribute("id", "leads-panel-leads");
    // Only the selected tab is in the tab order.
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1]);
  });

  it("count the leads and the meetings, the unassigned for Admin+", async () => {
    h.agenda = [
      agendaMeeting("m-today", "l-1", "2026-10-22T09:00:00Z"),
      agendaMeeting("m-sat", "l-2", "2026-10-24T08:00:00Z", { openRequest: { id: "r-1", kind: "reschedule", note: "" } }),
      agendaMeeting("m-held", "l-3", "2026-10-21T08:00:00Z", { status: "done" }),
    ];
    show();
    await waitFor(() => expect(tab(/^פניות/).textContent).toContain("4"));
    // New (l-1, l-3) and escalated (l-4); l-3 nobody's.
    expect(tab(/^פניות/).textContent).toContain("3 דורשות טיפול · 1 לא שויכו");
    await waitFor(() => expect(tab(/^פגישות/).textContent).toContain("2 השבוע"));
    expect(tab(/^פגישות/).textContent).toContain("1 היום · 1 בקשות שינוי · 1 בלי סיכום");
  });

  it("switch on a click and keep the choice in the URL, beside ?agency=", async () => {
    show();
    const panel = await toMeetings();
    expect(tab(/^פגישות/)).toHaveAttribute("aria-selected", "true");
    expect(panel).toHaveAttribute("id", "leads-panel-meetings");
    expect(search().get("tab")).toBe("meetings");
    expect(search().get("agency")).toBe(A1);
    fireEvent.click(tab(/^פניות/));
    expect(search().get("tab")).toBe("leads");
    expect(search().get("agency")).toBe(A1);
  });

  it("open on the tab the URL names", async () => {
    show(`/admin/leads?agency=${A1}&tab=meetings`);
    expect(tab(/^פגישות/)).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("button", { name: "פגישה חדשה" })).toBeInTheDocument();
  });

  it("move with the arrow keys — left to 'פגישות' in a right-to-left page — and Home and End", async () => {
    show();
    const leads = tab(/^פניות/);
    leads.focus();
    fireEvent.keyDown(leads, { key: "ArrowLeft" });
    expect(tab(/^פגישות/)).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tab(/^פגישות/));
    fireEvent.keyDown(tab(/^פגישות/), { key: "ArrowRight" });
    expect(tab(/^פניות/)).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tab(/^פניות/));
    fireEvent.keyDown(tab(/^פניות/), { key: "End" });
    expect(tab(/^פגישות/)).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tab(/^פגישות/), { key: "Home" });
    expect(tab(/^פניות/)).toHaveAttribute("aria-selected", "true");
    expect(search().get("tab")).toBe("leads");
  });
});

describe("the leads tab, by role", () => {
  it.each([
    ["user", false],
    ["admin", true],
    ["owner", true],
  ] as const)("offers a %s what the leads screen offered it", async (r, adminPlus) => {
    role.role = r;
    show();
    await screen.findByText("יעל כהן");
    expect(screen.queryAllByRole("combobox", { name: /שיוך הפנייה/ }).length > 0).toBe(adminPlus);
    expect(screen.queryAllByRole("button", { name: "מחיקה" }).length > 0).toBe(adminPlus);
    expect(screen.queryByText("מעקב לידים") !== null).toBe(adminPlus);
    expect(screen.queryByRole("button", { name: /לא שויכו/ }) !== null).toBe(adminPlus);
    // Every role may change a status and export.
    expect(screen.getAllByRole("combobox", { name: /סטטוס הפנייה/ })).toHaveLength(4);
    expect(screen.getByRole("button", { name: /ייצוא הכל/ })).toBeInTheDocument();
    // A User's tab keeps the screen's old name, without the unassigned count.
    expect(tab(adminPlus ? /^פניות/ : /^הפניות שלי/).textContent).toContain(adminPlus ? "לא שויכו" : "דורשות טיפול");
    if (!adminPlus) expect(tab(/^הפניות שלי/).textContent).not.toContain("לא שויכו");
  });
});

describe("deleting a lead", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    h.leadsAdmin.remove.mockImplementation(async (id: string) => {
      // As the database does: the lead goes, and its meetings with it.
      h.leads = h.leads.filter((l) => l.id !== id);
      h.agenda = h.agenda.filter((m) => m.leadId !== id);
    });
  });
  afterEach(() => vi.mocked(window.confirm).mockRestore());

  it("from the agenda's drawer, removes the lead from both tabs, after saying its meetings go too", async () => {
    h.agenda = [agendaMeeting("m-1", "l-2", "2026-10-23T07:00:00Z", { topic: "סקירה" })];
    show();
    const panel = await toMeetings();
    fireEvent.click(await within(panel).findByRole("button", { name: "דן לוי" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "מחיקת הפנייה" }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/דן לוי.*הפגישות/));
    await waitFor(() => expect(h.leadsAdmin.remove).toHaveBeenCalledWith("l-2"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(within(panel).queryByRole("button", { name: "דן לוי" })).toBeNull());
    fireEvent.click(tab(/^פניות/));
    await screen.findByText("יעל כהן");
    expect(screen.queryByText("דן לוי")).toBeNull();
  });

  it("does nothing when the confirmation is declined", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    show();
    await screen.findByText("יעל כהן");
    fireEvent.click(within(screen.getByText("יעל כהן").closest("tr")!).getByRole("button", { name: "מחיקה" }));
    expect(h.leadsAdmin.remove).not.toHaveBeenCalled();
  });

  it("keeps the drawer open and says so when the delete fails", async () => {
    h.leadsAdmin.remove.mockRejectedValue(new Error("rls"));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "יעל כהן" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "מחיקת הפנייה" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("הפנייה לא נמחקה");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("is not offered to a User, in the table or the drawer", async () => {
    role.role = "user";
    show();
    fireEvent.click(await screen.findByRole("button", { name: "יעל כהן" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "מחיקת הפנייה" })).toBeNull();
    expect(screen.queryAllByRole("button", { name: "מחיקה" })).toHaveLength(0);
  });

  it("keeps the row's actions pinned in view when the table scrolls sideways", async () => {
    show();
    await screen.findByText("יעל כהן");
    const cell = within(screen.getByText("יעל כהן").closest("tr")!).getByRole("button", { name: "מחיקה" }).closest("td")!;
    expect(cell.className).toMatch(/\bsticky\b/);
    expect(cell.className).toMatch(/\bleft-0\b/);
  });
});

describe("הפגישה הבאה", () => {
  beforeEach(() => {
    h.agenda = [
      agendaMeeting("m-1", "l-1", "2026-10-22T07:00:00Z"), // today 10:00
      agendaMeeting("m-1b", "l-1", "2026-10-23T07:00:00Z"), // a later one: not the next
      agendaMeeting("m-2", "l-2", "2026-10-23T14:30:00Z"), // tomorrow 17:30
      agendaMeeting("m-3", "l-3", "2026-10-28T10:00:00Z"), // Wednesday 12:00, winter time
      agendaMeeting("m-4", "l-4", "2026-10-20T07:00:00Z", { status: "done" }), // past: no next meeting
    ];
  });

  const row = (name: string) => screen.getByText(name).closest("tr")!;

  it("names each lead's next meeting on Israel's clock, and offers one where there is none", async () => {
    show();
    expect(await screen.findByRole("columnheader", { name: "הפגישה הבאה" })).toBeInTheDocument();
    await screen.findByText("יעל כהן");
    expect(await within(row("יעל כהן")).findByRole("button", { name: "היום 10:00" })).toBeInTheDocument();
    expect(within(row("דן לוי")).getByRole("button", { name: "מחר 17:30" })).toBeInTheDocument();
    expect(within(row("רונית בר")).getByRole("button", { name: "רביעי 12:00" })).toBeInTheDocument();
    expect(within(row("אבי שמש")).getByRole("button", { name: "+ קביעת פגישה" })).toBeInTheDocument();
  });

  it("goes to the meetings tab", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "היום 10:00" }));
    expect(tab(/^פגישות/)).toHaveAttribute("aria-selected", "true");
    expect(search().get("tab")).toBe("meetings");
  });

  it("'+ קביעת פגישה' opens the lead's drawer on its meetings, with the new-meeting form open", async () => {
    show();
    await screen.findByText("אבי שמש");
    fireEvent.click(await within(row("אבי שמש")).findByRole("button", { name: "+ קביעת פגישה" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("tab", { name: /פגישות/, selected: true })).toBeInTheDocument();
    expect(within(dialog).getByRole("form", { name: "פגישה חדשה" })).toBeInTheDocument();
    await waitFor(() => expect(h.leadsAdmin.meetings).toHaveBeenCalledWith("l-4"));
  });

  it("shows '—' rather than '+ קביעת פגישה' while the meetings cannot be read", async () => {
    h.leadsAdmin.agencyMeetings.mockRejectedValue(new Error("meetings read failed"));
    show();
    await screen.findByText("יעל כהן");
    await waitFor(() => expect(h.leadsAdmin.agencyMeetings).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "+ קביעת פגישה" })).toBeNull();
  });
});

describe("the agenda", () => {
  const section = (panel: HTMLElement, label: string) => within(panel).getByRole("heading", { level: 2, name: new RegExp(`^${label}`) }).closest("section")!;

  it("groups by Israel's day across midnight and across the change from summer time", async () => {
    h.agenda = [
      agendaMeeting("m-late", "l-1", "2026-10-22T20:30:00Z"), // Thu 23:30
      agendaMeeting("m-midnight", "l-2", "2026-10-22T21:15:00Z"), // Fri 00:15 — the 22nd in UTC
      agendaMeeting("m-sun-early", "l-3", "2026-10-24T21:30:00Z"), // Sun 00:30 (+03) — the 24th in UTC
      agendaMeeting("m-sun-late", "l-4", "2026-10-25T21:30:00Z"), // Sun 23:30 (+02)
    ];
    show();
    const panel = await toMeetings();
    await within(panel).findByRole("heading", { level: 2, name: /^היום/ });
    expect(within(panel).getAllByRole("heading", { level: 2 }).map((x) => x.firstChild?.textContent)).toEqual([
      "היום", "מחר", "יום ראשון, 25.10",
    ]);
    expect(within(section(panel, "היום")).getByRole("article").textContent).toContain("23:30");
    expect(within(section(panel, "מחר")).getByRole("article").textContent).toContain("00:15");
    const sunday = within(section(panel, "יום ראשון")).getAllByRole("article");
    expect(sunday.map((a) => a.getAttribute("aria-label"))).toEqual(["00:30 · רונית בר", "23:30 · אבי שמש"]);
  });

  it("shows a client's open request on top of its meeting, as plain text, and marks it handled", async () => {
    h.agenda = [
      agendaMeeting("m-1", "l-1", "2026-10-23T07:00:00Z", { openRequest: { id: "r-1", kind: "reschedule", note: "<b>אחר הצהריים</b>" } }),
    ];
    show();
    const panel = await toMeetings();
    const strip = await within(panel).findByRole("group", { name: "הלקוח ביקש מועד אחר" });
    expect(strip.textContent).toContain("<b>אחר הצהריים</b>");
    expect(strip.querySelector("b")).toBeNull();
    const calls = h.leadsAdmin.agencyMeetings.mock.calls.length;
    fireEvent.click(within(strip).getByRole("button", { name: "טופל" }));
    await waitFor(() => expect(h.leadsAdmin.handleMeetingRequest).toHaveBeenCalledWith("r-1"));
    // The agenda reads again, so the strip goes once the request is handled.
    await waitFor(() => expect(h.leadsAdmin.agencyMeetings.mock.calls.length).toBeGreaterThan(calls));
    expect(h.leadsAdmin.updateMeeting).not.toHaveBeenCalled();
  });

  it("narrows to held meetings without a summary, from the chip and from the card", async () => {
    h.agenda = [
      agendaMeeting("m-held", "l-1", "2026-10-21T08:00:00Z", { status: "done" }),
      agendaMeeting("m-published", "l-2", "2026-10-20T08:00:00Z", { status: "done", summaryPublishedAt: "2026-10-20T12:00:00Z" }),
      agendaMeeting("m-ahead", "l-3", "2026-10-23T08:00:00Z"),
    ];
    show();
    const panel = await toMeetings();
    await within(panel).findAllByRole("article");
    fireEvent.click(within(panel).getByRole("button", { name: "בלי סיכום" }));
    expect(within(panel).getByRole("button", { name: "בלי סיכום" })).toHaveAttribute("aria-pressed", "true");
    const cards = within(panel).getAllByRole("article");
    expect(cards).toHaveLength(1);
    expect(within(cards[0]).getByRole("button", { name: "כתיבת סיכום: יעל כהן" })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "קרובות" }));
    expect(within(panel).getAllByRole("article")).toHaveLength(2); // the meeting ahead, and the one waiting for a summary
    fireEvent.click(within(panel).getByRole("button", { name: /^התקיימו, בלי סיכום/ }));
    expect(within(panel).getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["11:00 · יעל כהן"]);
  });

  it("opens the client's name in the lead's drawer, on its meetings, with that meeting expanded", async () => {
    h.agenda = [agendaMeeting("m-1", "l-2", "2026-10-23T07:00:00Z", { topic: "סקירה" })];
    h.leadMeetings = [
      { id: "m-0", scheduledAt: "2026-09-01T07:00:00Z", durationMin: 45, topic: "ישנה", kind: "first", status: "done", mode: "office",
        location: "", notes: "", clientSummary: "", summaryPublishedAt: null, source: null, openRequest: null },
      { id: "m-1", scheduledAt: "2026-10-23T07:00:00Z", durationMin: 45, topic: "סקירה", kind: "follow_up", status: "scheduled",
        mode: "office", location: "", notes: "להביא דוחות", clientSummary: "", summaryPublishedAt: null, source: null, openRequest: null },
    ];
    show();
    const panel = await toMeetings();
    fireEvent.click(await within(panel).findByRole("button", { name: "דן לוי" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("tab", { name: /פגישות/, selected: true })).toBeInTheDocument();
    expect(((await within(dialog).findByLabelText(/הערות פנימיות/)) as HTMLTextAreaElement).value).toBe("להביא דוחות");
    expect(within(dialog).getByRole("button", { name: /סקירה/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByRole("button", { name: /ישנה/ })).toHaveAttribute("aria-expanded", "false");
    expect(h.leadsAdmin.meetings).toHaveBeenCalledWith("l-2");
  });

  it("shows a name, topic and place as typed, never as markup", async () => {
    h.leads = [lead("l-1", "<img src=x onerror=alert(1)>")];
    h.agenda = [agendaMeeting("m-1", "l-1", "2026-10-23T07:00:00Z", { topic: "<i>נושא</i>", location: "<a href='x'>כאן</a>" })];
    show();
    const panel = await toMeetings();
    const card = await within(panel).findByRole("article");
    expect(card.querySelector("img, i, a")).toBeNull();
    expect(card.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(card.textContent).toContain("<i>נושא</i>");
  });

  it("lets Admin+ narrow to one member, and does not offer a User the select", async () => {
    h.agenda = [
      agendaMeeting("m-mine", "l-1", "2026-10-23T07:00:00Z", { assignedUserId: "u-me" }),
      agendaMeeting("m-two", "l-2", "2026-10-23T08:00:00Z", { assignedUserId: "u-2" }),
    ];
    show();
    let panel = await toMeetings();
    await within(panel).findAllByRole("article");
    const select = await within(panel).findByRole("combobox", { name: "צוות" });
    await within(select).findByRole("option", { name: "two@example.com" });
    fireEvent.change(select, { target: { value: "u-2" } });
    expect(within(panel).getAllByRole("article").map((a) => a.getAttribute("aria-label"))).toEqual(["11:00 · דן לוי"]);
    expect(within(panel).getByRole("article").textContent).toContain("two@example.com");

    role.role = "user";
    cleanup();
    show();
    panel = await toMeetings();
    await within(panel).findAllByRole("article");
    expect(within(panel).queryByRole("combobox", { name: "צוות" })).toBeNull();
    // A User's agenda is whatever their session reads: both rows here, unfiltered by the screen.
    expect(within(panel).getAllByRole("article")).toHaveLength(2);
  });

  it("adds a meeting from 'פגישה חדשה': a lead picked by search, then the drawer's form", async () => {
    show();
    const panel = await toMeetings();
    fireEvent.click(within(panel).getByRole("button", { name: "פגישה חדשה" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("חיפוש פנייה"), { target: { value: "רונית" } });
    const picks = within(within(dialog).getByRole("list", { name: "פניות" })).getAllByRole("button");
    expect(picks).toHaveLength(1);
    fireEvent.click(picks[0]);
    const form = within(dialog).getByRole("form", { name: "פגישה חדשה" });
    fireEvent.change(within(form).getByLabelText("תאריך"), { target: { value: "2026-12-14" } });
    fireEvent.change(within(form).getByLabelText("שעה"), { target: { value: "17:30" } });
    fireEvent.click(within(form).getByRole("button", { name: "שמירת הפגישה" }));
    await waitFor(() => expect(h.leadsAdmin.addMeeting).toHaveBeenCalled());
    expect(h.leadsAdmin.addMeeting.mock.calls[0][0]).toMatchObject({ leadId: "l-3", agencyId: A1, scheduledAt: "2026-12-14T15:30:00.000Z" });
  });

  it("says when there is nothing to show, and when the meetings cannot be read", async () => {
    show();
    let panel = await toMeetings();
    expect(await within(panel).findByText("אין פגישות להצגה.")).toBeInTheDocument();

    h.leadsAdmin.agencyMeetings.mockRejectedValue(new Error("meetings read failed"));
    cleanup();
    show();
    panel = await toMeetings();
    expect(await within(panel).findByRole("alert")).toHaveTextContent("לא הצלחנו לטעון את הפגישות");
  });
});
