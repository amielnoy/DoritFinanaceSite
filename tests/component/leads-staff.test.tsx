// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Staff-created leads on /admin/leads, behind VITE_STAFF_LEADS: the "פנייה חדשה"
 * button, the source tag, the chips, Admin's column, duplicate pointer and monthly
 * strip, the CSV columns, and the drawer's line. The hooks are the real ones; the
 * port under them is the fake. The sheet itself is tested in new-lead-sheet.test.tsx.
 */

const A1 = "00000000-0000-0000-0000-000000000001";
const h = vi.hoisted(() => ({
  on: true,
  leads: [] as Record<string, unknown>[],
  sheetMounts: 0,
  leadsAdmin: {
    list: vi.fn(),
    agencyMeetings: vi.fn(),
    meetings: vi.fn(),
    transcriptLeadIds: vi.fn(),
    transcript: vi.fn(),
    assign: vi.fn(),
    setStatus: vi.fn(),
    remove: vi.fn(),
    clearDuplicate: vi.fn(),
  },
  usersList: vi.fn(),
}));

vi.mock("@/config/staff-leads", async (original) => ({
  ...(await original<typeof import("@/config/staff-leads")>()),
  get STAFF_LEADS() {
    return h.on;
  },
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-me" } }) }));
vi.mock("@/config/meetings", () => ({ MEETINGS_STAFF: true, MEETINGS_CLIENT: false }));
vi.mock("@/services", () => ({ services: { leadsAdmin: h.leadsAdmin, usersAdmin: { list: h.usersList } } }));
vi.mock("@/components/dorit/admin/LeadTrackingPanel", () => ({ default: () => <p>מעקב לידים</p> }));
vi.mock("@/components/dorit/admin/NewLeadSheet", () => ({
  default: (p: { canAssign: boolean; onCreated(id: string): void; onSaved?(id: string): void; onOpenExisting(id: string): void }) => {
    React.useEffect(() => {
      h.sheetMounts += 1;
    }, []);
    return (
      <div data-testid="sheet" data-can-assign={String(p.canAssign)}>
        <button onClick={() => p.onCreated("l-new")}>stub-created</button>
        <button onClick={() => p.onSaved?.("l-new")}>stub-saved</button>
        <button onClick={() => p.onOpenExisting("l-1")}>stub-open-existing</button>
      </div>
    );
  },
}));
const role = vi.hoisted(() => ({ role: "owner", isOperator: false }) as import("../helpers/agency-role-mock").RoleState);
vi.mock("@/hooks/useAgency", async () => (await import("../helpers/agency-role-mock")).agencyHookMock(role));

const { default: Leads } = await import("@/pages/Leads");

const NOW = new Date("2026-10-22T06:00:00Z");
const lead = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, name, phone: `05${id.length}0000000`, email: "", source: "quick", status: "new", created_date: "2026-10-10T08:00:00Z",
  agency_id: A1, assigned_user_id: "u-me", ...over,
});
const member = (id: string, email: string, r: string) => ({
  id, email, role: "user", createdAt: "", memberships: [{ orgId: A1, orgName: "דורית", role: r, joinedAt: "" }],
});

const ready = () => screen.findByRole("button", { name: "דן לוי" });
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/admin/leads?agency=${A1}`]}>
        <Leads />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.on = true;
  h.sheetMounts = 0;
  role.role = "owner";
  role.isOperator = false;
  for (const fn of Object.values(h.leadsAdmin)) fn.mockReset();
  h.leads = [
    lead("l-1", "יעל כהן", { phone: "050-1234567" }),
    lead("l-2", "דן לוי", {
      source: "staff", intake: "referral", referrerNote: "רו״ח משה", noticeMethod: "email", broughtBy: "u-two",
      created_date: "2026-10-12T08:00:00Z", phone: "+972501234567", possibleDuplicate: true,
    }),
    lead("l-mine", "מירי מור", { source: "staff", intake: "event", noticeMethod: "whatsapp", broughtBy: "u-me", referrerNote: "=1+1" }),
    lead("l-3", "רונית בר", { source: "staff", intake: "phone", noticeMethod: "verbal", broughtBy: "u-gone", created_date: "2026-09-12T08:00:00Z" }),
  ];
  h.leadsAdmin.list.mockImplementation(async () => h.leads);
  h.leadsAdmin.agencyMeetings.mockResolvedValue([]);
  h.leadsAdmin.meetings.mockResolvedValue([]);
  h.leadsAdmin.transcriptLeadIds.mockResolvedValue([]);
  h.leadsAdmin.clearDuplicate.mockResolvedValue(undefined);
  h.usersList.mockResolvedValue([member("u-me", "me@example.com", "owner"), member("u-two", "two@example.com", "user")]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});


describe("without VITE_STAFF_LEADS", () => {
  it("is the screen as it was: no button, chips, column or strip", async () => {
    h.on = false;
    show();
    await ready();
    expect(screen.queryByRole("button", { name: "פנייה חדשה" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^דרך הצוות/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /כפילות אפשרית/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "הובאה ע״י" })).toBeNull();
    expect(screen.queryByText("הובאו החודש")).toBeNull();
    expect(screen.queryByText("רו״ח משה")).toBeNull();
  });
});

describe("with VITE_STAFF_LEADS, as a User", () => {
  beforeEach(() => {
    role.role = "user";
  });
  it("has the button, the source tag and the chip; no column, duplicate chip or strip", async () => {
    show();
    await ready();
    expect(screen.getByRole("button", { name: "פנייה חדשה" })).toBeInTheDocument();
    expect(screen.getByText("הפניה", { selector: "span" })).toBeInTheDocument(); // the intake tag
    expect(screen.queryByRole("columnheader", { name: "הובאה ע״י" })).toBeNull();
    expect(screen.queryByRole("button", { name: /כפילות אפשרית/ })).toBeNull();
    expect(screen.queryByText("הובאו החודש")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^דרך הצוות/ }));
    expect(screen.queryByText("יעל כהן")).toBeNull();
    expect(screen.getByText("דן לוי")).toBeInTheDocument();
    expect(screen.getByText("רונית בר")).toBeInTheDocument();
  });
});

async function csvText() {
  let blob: Blob | undefined;
  URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), "blob:x")) as never;
  URL.revokeObjectURL = vi.fn();
  fireEvent.click(screen.getByRole("button", { name: "ייצוא הכל ל-CSV" }));
  return new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.readAsText(blob!);
  });
}

describe("who brought a lead, as a User", () => {
  beforeEach(() => {
    role.role = "user";
  });
  it("reads 'אני' for their own in the drawer line and the CSV, and 'חבר/ה בצוות' for another's", async () => {
    show();
    await screen.findByRole("button", { name: "מירי מור" });
    const text = await csvText();
    const mine = text.split("\n").find((r) => r.includes("מירי מור"))!;
    expect(mine).toContain(",אני,");
    expect(text.split("\n").find((r) => r.includes("דן לוי"))!).toContain("חבר/ה בצוות");
    fireEvent.click(screen.getByRole("button", { name: "מירי מור" }));
    expect(await screen.findByText("נוספה ידנית ע״י אני · אירוע · יידוע: בוואטסאפ")).toBeInTheDocument();
  });
  it("escapes a referrer note that starts like a formula", async () => {
    show();
    await screen.findByRole("button", { name: "מירי מור" });
    const mine = (await csvText()).split("\n").find((r) => r.includes("מירי מור"))!;
    expect(mine).toContain("'=1+1");
    expect(mine).not.toMatch(/,=1\+1/);
  });
});

describe("with VITE_STAFF_LEADS, as an Admin", () => {
  it("has the column with the member's address and a gone member named as such", async () => {
    show();
    await ready();
    expect(screen.getByRole("columnheader", { name: "הובאה ע״י" })).toBeInTheDocument();
    const dan = screen.getByText("דן לוי").closest("tr")!;
    const at = screen.getAllByRole("columnheader").findIndex((c) => c.textContent === "הובאה ע״י");
    expect(within(dan).getAllByRole("cell")[at]).toHaveTextContent("two@example.com");
    const ronit = screen.getByText("רונית בר").closest("tr")!;
    expect(within(ronit).getAllByRole("cell")[at]).toHaveTextContent("חבר/ה שכבר לא בסוכנות");
  });

  it("filters to possible duplicates, clears one, and points at the other lead with the same number", async () => {
    show();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /^כפילות אפשרית/ }));
    expect(screen.queryByText("רונית בר")).toBeNull();
    const dan = screen.getByText("דן לוי").closest("tr")!;
    expect(within(dan).getByText(/אותו מספר:/)).toBeInTheDocument();
    fireEvent.click(within(dan).getByRole("button", { name: "לא כפילות" }));
    await waitFor(() => expect(h.leadsAdmin.clearDuplicate).toHaveBeenCalledWith("l-2"));
    fireEvent.click(within(dan).getByRole("button", { name: "יעל כהן" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("יעל כהן");
  });

  it("shows the strip: this month per member, in Israel time", async () => {
    show();
    await ready();
    const strip = screen.getByText("הובאו החודש").parentElement!;
    expect(within(strip).getByText(/two@example.com/).closest("li")).toHaveTextContent(/two@example.com\s*1$/);
    expect(within(strip).queryByText(/חבר\/ה שכבר/)).toBeNull(); // September's lead is not this month
  });

  it("exports who brought it, how they arrived and who referred them, under Hebrew headers", async () => {
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), "blob:x")) as never;
    URL.revokeObjectURL = vi.fn();
    show();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "ייצוא הכל ל-CSV" }));
    const text = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsText(blob!);
    });
    const [head, ...rows] = text.replace("﻿", "").split("\n");
    expect(head.split(",").slice(-3)).toEqual(["הובאה ע״י", "איך הגיע/ה", "מי הפנה"]);
    const dan = rows.find((r) => r.includes("דן לוי"))!;
    expect(dan).toContain("two@example.com");
    expect(dan).toContain("הפניה");
    expect(dan).toContain("רו״ח משה");
  });

  it("opens the drawer with the line under the header", async () => {
    show();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "דן לוי" }));
    expect(await screen.findByText("נוספה ידנית ע״י two@example.com · הפניה · יידוע: במייל")).toBeInTheDocument();
  });

  it("has no line in the drawer of a site lead", async () => {
    show();
    await ready();
    fireEvent.click(screen.getAllByRole("button", { name: "יעל כהן" })[0]);
    await screen.findByRole("dialog");
    expect(screen.queryByText(/נוספה ידנית/)).toBeNull();
  });
});

describe("the new-lead sheet", () => {
  it("mounts fresh on each opening, can assign for an Admin, and after a create refetches and opens the lead", async () => {
    show();
    await ready();
    expect(screen.queryByTestId("sheet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "פנייה חדשה" }));
    expect(screen.getByTestId("sheet")).toHaveAttribute("data-can-assign", "true");
    h.leads = [...h.leads, lead("l-new", "חדש חדש", { source: "staff", intake: "event", noticeMethod: "verbal", broughtBy: "u-me" })];
    const calls = h.leadsAdmin.list.mock.calls.length;
    fireEvent.click(screen.getByText("stub-created"));
    expect(screen.queryByTestId("sheet")).toBeNull();
    await waitFor(() => expect(h.leadsAdmin.list.mock.calls.length).toBeGreaterThan(calls));
    expect(await screen.findByRole("dialog")).toHaveTextContent("חדש חדש");
    fireEvent.click(screen.getByRole("button", { name: "פנייה חדשה", hidden: true }));
    expect(h.sheetMounts).toBe(2);
  });

  it("reads the list again when the sheet stays on its confirmation, before it is closed", async () => {
    show();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "פנייה חדשה" }));
    const calls = h.leadsAdmin.list.mock.calls.length;
    fireEvent.click(screen.getByText("stub-saved"));
    await waitFor(() => expect(h.leadsAdmin.list.mock.calls.length).toBeGreaterThan(calls));
    expect(screen.getByTestId("sheet")).toBeInTheDocument();
  });

  it("is offered in agency 1 only, whose notice the text is", async () => {
    const OTHER = "11111111-2222-4333-8444-555555555555";
    role.agencies = [{ id: OTHER, name: "Trust", role: "owner" }];
    h.leads = h.leads.map((l) => ({ ...l, agency_id: OTHER }));
    try {
      show();
      await ready();
      expect(screen.queryByRole("button", { name: "פנייה חדשה" })).toBeNull();
    } finally {
      role.agencies = undefined;
    }
  });

  it("opens the existing lead from a duplicate", async () => {
    show();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "פנייה חדשה" }));
    fireEvent.click(screen.getByText("stub-open-existing"));
    expect(await screen.findByRole("dialog")).toHaveTextContent("יעל כהן");
  });

  it("is told a User cannot assign", async () => {
    role.role = "user";
    show();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "פנייה חדשה" }));
    expect(screen.getByTestId("sheet")).toHaveAttribute("data-can-assign", "false");
  });
});
