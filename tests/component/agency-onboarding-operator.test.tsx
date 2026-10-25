// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The operator's side of the new-agency wizard: step 0 opens a draft and
 * invites its owner (a failed invitation leaves the agency open and can be
 * sent again); the review screen passes the three gates, activates, returns
 * with a note, and lists the agencies being set up. Plus the wizard's route
 * gate, the post-sign-in redirect and the switcher's label.
 */
const h = vi.hoisted(() => ({
  onb: {
    createAgency: vi.fn(), load: vi.fn(), listInProgress: vi.fn(), activate: vi.fn(), returnAgency: vi.fn(),
    setDpaDate: vi.fn(), setLicenceVerified: vi.fn(), setDisclosuresApproved: vi.fn(), setOperatorFields: vi.fn(), role: vi.fn(),
  },
  invite: vi.fn(),
  user: { id: "op", role: "admin" } as Record<string, unknown>,
  agencies: [] as Record<string, unknown>[],
}));

vi.mock("@/services", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/services")>();
  return { ...real, services: { onboarding: h.onb, usersAdmin: { invite: h.invite } } };
});
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: h.user, isAuthenticated: true, isLoadingAuth: false, authChecked: true, authError: null, checkUserAuth: vi.fn() }),
}));
vi.mock("@/hooks/useAgency", () => ({
  useMyAgencies: () => ({ data: h.agencies }),
  useCurrentAgency: () => ({ agencyId: String(h.agencies[0]?.id ?? ""), agencies: h.agencies, setAgency: vi.fn(), isLoading: false }),
}));
vi.mock("@/config/agency-onboarding", () => ({ AGENCY_ONBOARDING: true, isAgencyOnboardingOn: () => true }));

const { default: AgencyNew } = await import("@/pages/AgencyNew");
const { default: AgencyReview } = await import("@/pages/AgencyReview");
const { default: OnboardingRoute } = await import("@/components/OnboardingRoute");
const { default: DraftOwnerRedirect } = await import("@/components/DraftOwnerRedirect");
const { AgencySwitcher } = await import("@/components/dorit/admin/AdminLayout");

const AGENCY = "aaaaaaaa-0000-4000-8000-000000000001";
const wrap = (ui: React.ReactNode, entry = "/") => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}>{ui}</MemoryRouter></QueryClientProvider>);
};

beforeEach(() => {
  for (const f of Object.values(h.onb)) f.mockReset();
  h.invite.mockReset();
  h.user = { id: "op", role: "admin" };
  h.agencies = [];
  h.onb.listInProgress.mockResolvedValue([]);
});

describe("/admin/agencies/new", () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText(/שם הסוכנות/), { target: { value: "סוכנות רחל" } });
    fireEvent.change(screen.getByLabelText(/דוא״ל הבעלים/), { target: { value: "rachel@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "פתיחת הסוכנות ושליחת הזמנה" }));
  };

  it("opens the draft, then invites its owner as owner", async () => {
    h.onb.createAgency.mockResolvedValue(AGENCY);
    h.invite.mockResolvedValue({ created: true, mailed: true });
    wrap(<AgencyNew />);
    fill();
    expect(await screen.findByText("הזמנה נשלחה אל rachel@example.com.")).toBeTruthy();
    expect(h.onb.createAgency).toHaveBeenCalledWith({ name: "סוכנות רחל", ownerEmail: "rachel@example.com", dpaDate: null });
    expect(h.invite).toHaveBeenCalledWith({ email: "rachel@example.com", orgId: AGENCY, role: "owner" });
  });

  it("keeps the agency when the invitation fails, says so, and sends it again", async () => {
    h.onb.createAgency.mockResolvedValue(AGENCY);
    h.invite.mockRejectedValueOnce(new Error("mail down")).mockResolvedValueOnce({ created: false, mailed: true });
    wrap(<AgencyNew />);
    fill();
    expect(await screen.findByText(/ההזמנה אל rachel@example.com לא נשלחה/)).toBeTruthy();
    expect(screen.getByText(/הסוכנות ״סוכנות רחל״ נפתחה כטיוטה/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "שליחת ההזמנה שוב" }));
    expect(await screen.findByText("הזמנה נשלחה אל rachel@example.com.")).toBeTruthy();
    expect(h.onb.createAgency).toHaveBeenCalledTimes(1);
  });

  it("does not open an agency without a valid owner address", () => {
    wrap(<AgencyNew />);
    fireEvent.change(screen.getByLabelText(/שם הסוכנות/), { target: { value: "סוכנות" } });
    fireEvent.change(screen.getByLabelText(/דוא״ל הבעלים/), { target: { value: "not-an-email" } });
    expect((screen.getByRole("button", { name: "פתיחת הסוכנות ושליחת הזמנה" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("כתובת הדוא״ל אינה תקינה.")).toBeTruthy();
  });
});

describe("/admin/agencies/:id/review", () => {
  const record = (status = "pending_review") => ({
    agencies: { id: AGENCY, name: "סוכנות רחל", status, data_processing_agreement_date: null },
    agency_profiles: { agency_id: AGENCY, display_name: "רחל לוי", licence_entity: "רחל לוי", onboarding: { review: { owner_email: "rachel@example.com" } }, updated_at: "2026-10-26T08:00:00Z" },
    agents: { id: "agent-1", full_name: "רחל לוי", grammatical_gender: "f", licence_number: "L-12345", licence_regulator: "רשות שוק ההון, ביטוח וחיסכון", has_institutional_affiliation: false, licence_verified_at: null },
    testimonials: [],
    success_cases: [],
  });
  const show = () =>
    wrap(<Routes><Route path="/admin/agencies/:agencyId/review" element={<AgencyReview />} /></Routes>, `/admin/agencies/${AGENCY}/review`);

  it("passes the gates the operator checks", async () => {
    h.onb.load.mockResolvedValue(record());
    show();
    fireEvent.click(await screen.findByRole("button", { name: "בדקתי את הרישיון במרשם" }));
    await waitFor(() => expect(h.onb.setLicenceVerified).toHaveBeenCalledWith("agent-1", true));
    fireEvent.change(screen.getByLabelText("תאריך הסכם עיבוד הנתונים"), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירת התאריך" }));
    await waitFor(() => expect(h.onb.setDpaDate).toHaveBeenCalledWith(AGENCY, "2026-10-20"));
    fireEvent.click(screen.getByRole("button", { name: "אישרתי את הנוסחים" }));
    await waitFor(() => expect(h.onb.setDisclosuresApproved).toHaveBeenCalledWith(AGENCY, true));
  });

  it("names the gates still closed when activation is refused", async () => {
    h.onb.load.mockResolvedValue(record());
    h.onb.activate.mockResolvedValue({ ok: false, missing: [], gates: ["agents.licence_verified_at", "agencies.data_processing_agreement_date"], message: "אחד מתנאי ההפעלה עדיין לא התקיים." });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "הפעלה" }));
    expect(await screen.findByText("הרישיון נבדק במרשם הרשות · הסכם עיבוד נתונים נחתם")).toBeTruthy();
  });

  it("returns an agency for corrections only with a note", async () => {
    h.onb.load.mockResolvedValue(record());
    h.onb.returnAgency.mockResolvedValue({ ok: true });
    show();
    const back = (await screen.findByRole("button", { name: "החזרה לתיקונים" })) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("הערה לבעלים"), { target: { value: "חסר מספר רישיון מלא" } });
    fireEvent.click(back);
    await waitFor(() => expect(h.onb.returnAgency).toHaveBeenCalledWith(AGENCY, "חסר מספר רישיון מלא"));
  });

  it("offers neither activation nor return before the agency is sent for approval", async () => {
    h.onb.load.mockResolvedValue(record("draft"));
    show();
    expect(((await screen.findByRole("button", { name: "הפעלה" })) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lists the agencies being set up, with when each was last edited", async () => {
    h.onb.load.mockResolvedValue(record());
    h.onb.listInProgress.mockResolvedValue([{ id: AGENCY, name: "סוכנות רחל", status: "draft", lastEdited: "2026-10-26T08:00:00Z", ownerEmail: "rachel@example.com" }]);
    show();
    expect(await screen.findByText(/בהקמה · rachel@example.com · נערכה לאחרונה/)).toBeTruthy();
  });
});

describe("the wizard's gate, the redirect and the switcher", () => {
  const guarded = () =>
    wrap(
      <Routes>
        <Route element={<OnboardingRoute unauthenticatedElement={<p>login</p>} />}>
          <Route path="/admin/onboarding/:agencyId" element={<p>the wizard</p>} />
        </Route>
        <Route path="/" element={<p>home</p>} />
      </Routes>,
      `/admin/onboarding/${AGENCY}`,
    );

  it("lets the operator and the agency's owner in, and no other member", async () => {
    guarded();
    expect(await screen.findByText("the wizard")).toBeTruthy();
  });

  it("lets the owner of the draft in", async () => {
    h.user = { id: "u1", role: "user" };
    h.onb.role.mockResolvedValue("owner");
    guarded();
    expect(await screen.findByText("the wizard")).toBeTruthy();
  });

  it("sends an Admin of the draft home", async () => {
    h.user = { id: "u1", role: "user" };
    h.onb.role.mockResolvedValue("admin");
    guarded();
    expect(await screen.findByText("home")).toBeTruthy();
  });

  it("brings an owner whose only agency is a draft to its wizard after sign-in", async () => {
    h.user = { id: "u1", role: "user" };
    h.agencies = [{ id: AGENCY, name: "סוכנות רחל", role: "owner", status: "draft" }];
    wrap(
      <>
        <DraftOwnerRedirect />
        <Routes>
          <Route path="/" element={<p>home</p>} />
          <Route path="/admin/onboarding/:agencyId" element={<p>the wizard</p>} />
        </Routes>
      </>,
    );
    expect(await screen.findByText("the wizard")).toBeTruthy();
  });

  it("leaves an owner with a live agency too where they are", async () => {
    h.user = { id: "u1", role: "user" };
    h.agencies = [
      { id: "live", name: "דורית", role: "owner", status: "active" },
      { id: AGENCY, name: "סוכנות רחל", role: "owner", status: "draft" },
    ];
    wrap(
      <>
        <DraftOwnerRedirect />
        <Routes><Route path="/" element={<p>home</p>} /><Route path="/admin/onboarding/:agencyId" element={<p>the wizard</p>} /></Routes>
      </>,
    );
    expect(await screen.findByText("home")).toBeTruthy();
    // …and the switcher names the draft for what it is.
    wrap(<AgencySwitcher />);
    expect(screen.getByRole("option", { name: "סוכנות רחל (בהקמה)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "דורית" })).toBeTruthy();
  });
});
