// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * /admin/campaigns (reactivation campaigns, stage 1): Admin+ creates a campaign
 * and gets its general link and WhatsApp message; nothing is saved without an
 * opt-out line; every member sees the campaigns and the leads each brought.
 */
const h = vi.hoisted(() => ({
  campaigns: [] as Record<string, unknown>[],
  leads: [] as Record<string, unknown>[],
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/hooks/useAdmin", () => ({
  useCampaigns: () => ({ data: h.campaigns, isPending: false, isError: false }),
  useCreateCampaign: () => ({ mutate: h.create, isPending: false, isError: false }),
  useUpdateCampaign: () => ({ mutate: h.update, isPending: false, isError: false }),
  useLeads: () => ({ data: h.leads }),
  useAgencyProfile: () => ({ data: { displayName: "דורית" } }),
}));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => ({ user: { id: "me", full_name: "דורית גוב ארי" } }) }));
const role = vi.hoisted(() => ({ role: "admin", isOperator: false }) as import("../helpers/agency-role-mock").RoleState);
vi.mock("@/hooks/useAgency", async () => (await import("../helpers/agency-role-mock")).agencyHookMock(role));

const { default: Campaigns } = await import("@/pages/Campaigns");

const AGENCY = "00000000-0000-0000-0000-000000000001";
const campaign = (over: Record<string, unknown> = {}) => ({
  id: "c1", agencyId: AGENCY, name: "חזרה ללקוחות", code: "k7x2m9qa1b2c",
  message: "שלום, כאן {agent}: {link}\nלהסרה השב/י 'הסר'", createdBy: "me",
  createdAt: "2026-10-20T08:00:00Z", archivedAt: null, ...over,
});
const show = () => render(<MemoryRouter><Campaigns /></MemoryRouter>);

describe("/admin/campaigns", () => {
  beforeEach(() => {
    h.create.mockReset();
    h.update.mockReset();
    role.role = "admin";
    h.campaigns = [campaign()];
    h.leads = [
      { id: "l1", channel: "reactivation", campaign: "k7x2m9qa1b2c", agency_id: AGENCY },
      { id: "l2", channel: "reactivation", campaign: "k7x2m9qa1b2c", agency_id: AGENCY },
      { id: "l3", channel: "google", campaign: null, agency_id: AGENCY },
      { id: "l4", channel: "reactivation", campaign: "someoneelse1", agency_id: AGENCY },
    ];
  });

  it("gives each campaign its link, its filled message, and the leads it brought", () => {
    show();
    const card = screen.getByRole("heading", { name: "חזרה ללקוחות" }).closest("li")!;
    const link = within(card).getByLabelText("הקישור לקמפיין") as HTMLInputElement;
    expect(link.value).toMatch(/\/\?utm_source=reactivation&utm_campaign=k7x2m9qa1b2c#start$/);
    expect(within(card).getByText(/שלום, כאן דורית גוב ארי: https?:\/\/.*utm_campaign=k7x2m9qa1b2c#start/)).toBeTruthy();
    expect(within(card).getByText("2")).toBeTruthy();
    const wa = within(card).getByRole("link", { name: /שליחה בוואטסאפ/ });
    expect(wa.getAttribute("href")).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it("lets an Admin create a campaign with the default message", () => {
    show();
    fireEvent.change(screen.getByLabelText("שם הקמפיין"), { target: { value: "סתיו 2026" } });
    fireEvent.click(screen.getByRole("button", { name: "יצירת קמפיין" }));
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({ agencyId: AGENCY, name: "סתיו 2026", message: expect.stringContaining("להסרה") }),
      expect.anything(),
    );
  });

  it("does not save a message without an opt-out line, and says why", () => {
    show();
    fireEvent.change(screen.getByLabelText("שם הקמפיין"), { target: { value: "בלי הסרה" } });
    fireEvent.change(screen.getByLabelText("ההודעה"), { target: { value: "שלום, כאן {agent}: {link}" } });
    expect(screen.getByRole("alert").textContent).toContain("שורת הסרה");
    expect((screen.getByRole("button", { name: "יצירת קמפיין" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "יצירת קמפיין" }));
    expect(h.create).not.toHaveBeenCalled();
  });

  it("lets an Admin archive a campaign", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: /העברה לארכיון/ }));
    expect(h.update).toHaveBeenCalledWith({ id: "c1", fields: { archived: true } });
  });

  it("shows a User the campaigns and their links, with nothing to create or edit", () => {
    role.role = "user";
    show();
    expect(screen.getByRole("heading", { name: "חזרה ללקוחות" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "יצירת קמפיין" })).toBeNull();
    expect(screen.queryByRole("button", { name: /עריכה/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /העברה לארכיון/ })).toBeNull();
    expect(screen.getByRole("button", { name: /העתקת הקישור/ })).toBeTruthy();
  });

  it("keeps archived campaigns folded away", () => {
    h.campaigns = [campaign(), campaign({ id: "c2", name: "ישן", code: "oldoldold123", archivedAt: "2026-10-01T00:00:00Z" })];
    show();
    expect(screen.queryByRole("heading", { name: "ישן" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "בארכיון (1)" }));
    expect(screen.getByRole("heading", { name: "ישן" })).toBeTruthy();
  });
});
