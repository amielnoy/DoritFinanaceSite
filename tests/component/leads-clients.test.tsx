// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Staff-added clients on /admin/leads, behind VITE_STAFF_CLIENTS (with
 * VITE_STAFF_LEADS): "הוספה", the product tags, the "נפתחו כלקוחות" chip, the
 * strip's "פניות · לקוחות", the CSV's three columns, the drawer's line and its
 * editable client fields. Off, the screen is as it was. The sheet is tested in
 * new-client-sheet.test.tsx.
 */

const A1 = "00000000-0000-0000-0000-000000000001";
const h = vi.hoisted(() => ({
  clients: true,
  leads: [] as Record<string, unknown>[],
  canAddClient: [] as boolean[],
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
    convertToClient: vi.fn(),
  },
  usersList: vi.fn(),
}));

vi.mock("@/config/staff-leads", async (original) => ({
  ...(await original<typeof import("@/config/staff-leads")>()),
  STAFF_LEADS: true,
}));
vi.mock("@/config/staff-clients", async (original) => ({
  ...(await original<typeof import("@/config/staff-clients")>()),
  get STAFF_CLIENTS() {
    return h.clients;
  },
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-me" } }) }));
vi.mock("@/config/meetings", () => ({ MEETINGS_STAFF: true, MEETINGS_CLIENT: false }));
vi.mock("@/services", () => ({ services: { leadsAdmin: h.leadsAdmin, usersAdmin: { list: h.usersList } } }));
vi.mock("@/components/dorit/admin/LeadTrackingPanel", () => ({ default: () => <p>מעקב לידים</p> }));
vi.mock("@/components/dorit/admin/NewLeadSheet", () => ({
  default: (p: { canAddClient?: boolean }) => {
    h.canAddClient.push(Boolean(p.canAddClient));
    return <div data-testid="sheet" />;
  },
}));
const role = vi.hoisted(() => ({ role: "owner", isOperator: false }) as import("../helpers/agency-role-mock").RoleState);
vi.mock("@/hooks/useAgency", async () => (await import("../helpers/agency-role-mock")).agencyHookMock(role));

const { default: Leads } = await import("@/pages/Leads");

const NOW = new Date("2026-10-22T06:00:00Z");
const lead = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  // Each its own number: leads that share one are grouped as duplicates.
  id, name, phone: `05${[...id].reduce((n, c) => n + c.charCodeAt(0), 0)}00000`.slice(0, 10), email: "", source: "quick", status: "new", created_date: "2026-10-10T08:00:00Z",
  agency_id: A1, assigned_user_id: "u-me", openedAs: "lead", clientSince: null, products: null, ...over,
});
const member = (id: string, email: string, r: string) => ({
  id, email, role: "user", createdAt: "", memberships: [{ orgId: A1, orgName: "דורית", role: r, joinedAt: "" }],
});

const ready = () => screen.findByRole("button", { name: "רחל לוי" });
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
async function csv(): Promise<{ head: string[]; rows: string[] }> {
  let blob: Blob | undefined;
  URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), "blob:x")) as never;
  URL.revokeObjectURL = vi.fn();
  fireEvent.click(screen.getByRole("button", { name: "ייצוא הכל ל-CSV" }));
  const text = await new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.readAsText(blob!);
  });
  const [head, ...rows] = text.replace("﻿", "").split("\n");
  return { head: head.split(","), rows };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.clients = true;
  h.canAddClient = [];
  role.role = "owner";
  role.isOperator = false;
  for (const fn of Object.values(h.leadsAdmin)) fn.mockReset();
  h.leads = [
    lead("c-1", "רחל לוי", {
      source: "staff", status: "client", intake: "existing_client", noticeMethod: "agreement", broughtBy: "u-two",
      openedAs: "client", clientSince: "2019-03", products: ["pension", "health"], created_date: "2026-10-12T08:00:00Z",
    }),
    lead("l-2", "דן כהן", { source: "staff", intake: "phone", noticeMethod: "verbal", broughtBy: "u-two", created_date: "2026-10-13T08:00:00Z" }),
    lead("old-client", "יעל בר", { status: "client" }),
  ];
  h.leadsAdmin.list.mockImplementation(async () => h.leads);
  h.leadsAdmin.agencyMeetings.mockResolvedValue([]);
  h.leadsAdmin.meetings.mockResolvedValue([]);
  h.leadsAdmin.transcriptLeadIds.mockResolvedValue([]);
  h.leadsAdmin.convertToClient.mockResolvedValue("old-client");
  h.usersList.mockResolvedValue([member("u-me", "me@example.com", "owner"), member("u-two", "two@example.com", "user")]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("without VITE_STAFF_CLIENTS", () => {
  it("is the staff-lead screen as it was: 'פנייה חדשה', no chip, tags, split or client columns", async () => {
    h.clients = false;
    show();
    await ready();
    expect(screen.getByRole("button", { name: "פנייה חדשה" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^נפתחו כלקוחות/ })).toBeNull();
    expect(screen.queryByLabelText(/^תחומים:/)).toBeNull();
    const strip = screen.getByText("הובאו החודש").parentElement!;
    expect(within(strip).getByText(/two@example.com/).closest("li")).toHaveTextContent(/two@example.com\s*2$/);
    const { head } = await csv();
    expect(head.slice(-3)).toEqual(["הובאה ע״י", "איך הגיע/ה", "מי הפנה"]);
    fireEvent.click(screen.getByRole("button", { name: "פנייה חדשה" }));
    expect(h.canAddClient.at(-1)).toBe(false);
  });
});

describe("with VITE_STAFF_CLIENTS", () => {
  it("names the button הוספה and opens the sheet able to add a client", async () => {
    show();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "הוספה" }));
    expect(await screen.findByTestId("sheet")).toBeInTheDocument();
    expect(h.canAddClient.at(-1)).toBe(true);
  });

  it("tags a client row with its service lines", async () => {
    show();
    await ready();
    const tags = screen.getByLabelText("תחומים: פנסיה, בריאות וסיעוד");
    expect(within(tags).getByText("פנסיה")).toBeInTheDocument();
    expect(within(tags).getByText("בריאות וסיעוד")).toBeInTheDocument();
  });

  it("filters to the clients added by hand (Admin+)", async () => {
    show();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /^נפתחו כלקוחות/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "דן כהן" })).toBeNull());
    expect(screen.getByRole("button", { name: "רחל לוי" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "יעל בר" })).toBeNull();
  });

  it("hides the chip from a User", async () => {
    role.role = "user";
    show();
    await ready();
    expect(screen.queryByRole("button", { name: /^נפתחו כלקוחות/ })).toBeNull();
  });

  it("splits the strip into פניות · לקוחות per member", async () => {
    show();
    await ready();
    const strip = screen.getByText("הובאו החודש").parentElement!;
    expect(within(strip).getByText(/two@example.com/).closest("li")).toHaveTextContent(/two@example.com\s*פניות 1 · לקוחות 1$/);
  });

  it("exports opened-as, since (MM/YYYY) and the lines (;-joined) under Hebrew headers", async () => {
    show();
    await ready();
    const { head, rows } = await csv();
    expect(head.slice(-3)).toEqual(["נפתח/ה כ", "לקוח/ה מאז", "תחומים"]);
    expect(rows.find((r) => r.includes("רחל לוי"))!.split(",").slice(-3)).toEqual(["לקוח/ה", "03/2019", "פנסיה;בריאות וסיעוד"]);
    expect(rows.find((r) => r.includes("דן כהן"))!.split(",").slice(-3)).toEqual(["פנייה", "", ""]);
  });

  it("says in the drawer who opened the client, since when and what we handle", async () => {
    show();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "רחל לוי" }));
    expect(await screen.findByText("נפתח/ה כלקוח/ה ע״י two@example.com · לקוח/ה מאז 03/2019 · פנסיה, בריאות וסיעוד")).toBeInTheDocument();
  });

  it("lets anyone fill an older client's fields in the drawer, through convertToClient", async () => {
    show();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "יעל בר" }));
    const fields = await screen.findByRole("region", { name: "פרטי הלקוח/ה" });
    const save = within(fields).getByRole("button", { name: "שמירת פרטי הלקוח/ה" });
    expect(save).toBeDisabled();
    fireEvent.change(within(fields).getByLabelText("שנה"), { target: { value: "2015" } });
    fireEvent.change(within(fields).getByLabelText("חודש"), { target: { value: "06" } });
    fireEvent.click(within(fields).getByRole("button", { name: "גמל והשתלמות" }));
    fireEvent.click(save);
    await waitFor(() => expect(h.leadsAdmin.convertToClient).toHaveBeenCalledWith("old-client", "2015-06", ["provident"]));
    expect(await within(fields).findByText("נשמר")).toBeInTheDocument();
  });

  it("shows no client fields in the drawer of a lead that is not a client", async () => {
    show();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "דן כהן" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("region", { name: "פרטי הלקוח/ה" })).toBeNull();
  });
});
