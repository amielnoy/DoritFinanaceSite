// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The new-agency wizard, steps 1–7 (Rollout step 4 of
 * docs/superpowers/specs/2026-10-16-new-agency-wizard-design.md): resume,
 * autosave on leaving a field and on "המשך", each step's validation, the
 * licensee created on step 1, a conflicting save reloaded, the disclosure
 * preview, testimonial consent, and the checklist with "שליחה לאישור".
 */
const h = vi.hoisted(() => ({
  record: null as unknown as Record<string, unknown>,
  onb: {
    load: vi.fn(),
    saveProfile: vi.fn(),
    saveAgent: vi.fn(),
    saveTestimonial: vi.fn(),
    deleteTestimonial: vi.fn(),
    saveSuccessCase: vi.fn(),
    deleteSuccessCase: vi.fn(),
    uploadPortrait: vi.fn(),
    removePortrait: vi.fn(),
    submit: vi.fn(),
    role: vi.fn(),
  },
}));

vi.mock("@/services", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/services")>();
  return { ...real, services: { onboarding: h.onb } };
});

const { default: AgencyOnboarding } = await import("@/pages/AgencyOnboarding");
const { OnboardingConflictError } = await import("@/services");

const AGENCY = "aaaaaaaa-0000-4000-8000-000000000001";
const T0 = "2026-10-26T08:00:00.000000+00:00";
const T1 = "2026-10-26T08:05:00.000000+00:00";

function baseRecord(over: { profile?: Record<string, unknown>; agent?: Record<string, unknown> | null } = {}) {
  return {
    agencies: { id: AGENCY, name: "סוכנות רחל", status: "draft", data_processing_agreement_date: null },
    agency_profiles: { agency_id: AGENCY, display_name: "סוכנות רחל", onboarding: {}, updated_at: T0, ...(over.profile ?? {}) },
    agents: over.agent === undefined ? null : over.agent,
    testimonials: [],
    success_cases: [],
  };
}
const AGENT = {
  id: "bbbbbbbb-0000-4000-8000-000000000002", agency_id: AGENCY, full_name: "רחל לוי", grammatical_gender: "f",
  professional_title: "סוכנת ביטוח", licence_types: [], licence_regulator: "רשות שוק ההון, ביטוח וחיסכון",
  affiliations: [], bio: {}, stats: [], review_links: {}, meeting_minutes: 15, updated_at: T0,
};

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/admin/onboarding/${AGENCY}`]}>
        <Routes>
          <Route path="/admin/onboarding/:agencyId" element={<AgencyOnboarding />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const stepTitle = async () => (await screen.findByRole("heading", { level: 2 })).textContent;

describe("the agency wizard", () => {
  beforeEach(() => {
    for (const f of Object.values(h.onb)) f.mockReset();
    h.record = baseRecord();
    h.onb.load.mockImplementation(async () => h.record);
    h.onb.saveProfile.mockImplementation(async (_a: string, patch: Record<string, unknown>) => ({ ...(h.record.agency_profiles as object), ...patch, updated_at: T1 }));
    h.onb.saveAgent.mockImplementation(async (_a: string, id: string | null, patch: Record<string, unknown>) => ({ ...AGENT, ...patch, id: id ?? AGENT.id, updated_at: T1 }));
  });

  it("opens on step 1 the first time", async () => {
    show();
    expect(await stepTitle()).toBe("בעל/ת הרישיון");
  });

  it("resumes at the last step saved", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "contact" } }, agent: AGENT });
    show();
    expect(await stepTitle()).toBe("פרטי קשר");
  });

  it("creates the licensee on step 1's first save, and remembers the next step on המשך", async () => {
    show();
    await stepTitle();
    fireEvent.change(screen.getByLabelText(/שם מלא/), { target: { value: "רחל לוי" } });
    fireEvent.click(screen.getByRole("button", { name: "נקבה" }));
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(() => expect(h.onb.saveAgent).toHaveBeenCalled());
    const [agency, agentId, patch, expected] = h.onb.saveAgent.mock.calls[0];
    expect([agency, agentId, expected]).toEqual([AGENCY, null, null]);
    expect(patch).toMatchObject({ full_name: "רחל לוי", grammatical_gender: "f" });
    await waitFor(() => expect(h.onb.saveProfile).toHaveBeenCalled());
    expect(h.onb.saveProfile.mock.calls[0][1]).toMatchObject({ onboarding: { last_step: "licence" } });
    expect(h.onb.saveProfile.mock.calls[0][2]).toBe(T0);
    expect(await stepTitle()).toBe("רישוי וגילוי נאות");
  });

  it("creates the licensee once when a field is left and המשך is clicked straight after", async () => {
    let release: () => void = () => {};
    h.onb.saveAgent.mockImplementationOnce(
      (_a: string, _id: string | null, patch: Record<string, unknown>) =>
        new Promise((resolve) => (release = () => resolve({ ...AGENT, ...patch, updated_at: T1 }))),
    );
    show();
    await stepTitle();
    const name = screen.getByLabelText(/שם מלא/);
    fireEvent.change(name, { target: { value: "רחל לוי" } });
    fireEvent.blur(name);
    fireEvent.click(screen.getByRole("button", { name: "נקבה" }));
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(() => expect(h.onb.saveAgent).toHaveBeenCalled());
    await act(async () => release());
    await waitFor(() => expect(h.onb.saveProfile).toHaveBeenCalled());
    // One insert (agentId null) — never a second licensee row; any later write names the row it made.
    expect(h.onb.saveAgent.mock.calls.filter((c) => c[1] === null)).toHaveLength(1);
    expect(h.onb.saveAgent.mock.calls.slice(1).every((c) => c[1] === AGENT.id)).toBe(true);
    expect(h.onb.saveProfile.mock.calls.at(-1)![1]).toMatchObject({ onboarding: { last_step: "licence" } });
  });

  it("saves a field when it is left, with the updated_at the step opened with", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "contact" } }, agent: AGENT });
    show();
    await stepTitle();
    const email = screen.getByLabelText(/^דוא״ל/);
    fireEvent.change(email, { target: { value: "rachel@example.com" } });
    fireEvent.blur(email);
    await waitFor(() => expect(h.onb.saveProfile).toHaveBeenCalled());
    const [, patch, expected] = h.onb.saveProfile.mock.calls[0];
    expect(patch).toMatchObject({ email: "rachel@example.com" });
    expect(expected).toBe(T0);
  });

  it("will not save a phone that is not an Israeli mobile, and derives the three columns from one that is", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "contact" } }, agent: AGENT });
    show();
    await stepTitle();
    const phone = screen.getByLabelText(/טלפון נייד/);
    fireEvent.change(phone, { target: { value: "03-1234567" } });
    expect(screen.getByText("נדרש מספר נייד ישראלי, למשל 052-1234567.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    expect(await screen.findByText("יש שדות שצריך לתקן לפני השמירה.")).toBeTruthy();
    expect(h.onb.saveProfile).not.toHaveBeenCalled();

    fireEvent.change(phone, { target: { value: "052-1234567" } });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(() => expect(h.onb.saveProfile).toHaveBeenCalled());
    expect(h.onb.saveProfile.mock.calls[0][1]).toMatchObject({ phone_e164: "+972521234567", phone_display: "052-123-4567", whatsapp: "972521234567" });
  });

  it("reloads a step that someone else saved meanwhile, and says so", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "contact" } }, agent: AGENT });
    h.onb.saveProfile.mockRejectedValueOnce(new OnboardingConflictError());
    show();
    await stepTitle();
    h.record = baseRecord({ profile: { onboarding: { last_step: "contact" }, email: "fromelsewhere@example.com", updated_at: T1 }, agent: AGENT });
    const email = screen.getByLabelText(/^דוא״ל/);
    fireEvent.change(email, { target: { value: "mine@example.com" } });
    fireEvent.blur(email);
    expect(await screen.findByText(/השלב עודכן בינתיים ממקום אחר/)).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText(/^דוא״ל/) as HTMLInputElement).value).toBe("fromelsewhere@example.com"));
  });

  it("previews the disclosure in the licensee's grammatical gender", async () => {
    h.record = baseRecord({
      profile: { onboarding: { last_step: "licence" }, licence_entity: "דן כהן", display_name: "דן כהן" },
      agent: { ...AGENT, full_name: "דן כהן", grammatical_gender: "m", licence_number: "L-1", has_institutional_affiliation: true },
    });
    show();
    await stepTitle();
    expect(screen.getByText("דן כהן בעל רישיון סוכן מרשות שוק ההון, ביטוח וחיסכון מס' L-1, ולו זיקה לגופים מוסדיים. הפעילות היא שיווק פנסיוני ולא ייעוץ פנסיוני אובייקטיבי.")).toBeTruthy();
    // Affiliations become required once "כן" is chosen: the checklist counts them.
    expect(screen.getByLabelText(/הגופים המוסדיים/)).toBeTruthy();
  });

  it("will not add a testimonial without its consent checkbox", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "testimonials" } }, agent: AGENT });
    show();
    await stepTitle();
    const form = screen.getByRole("form", { name: "המלצה חדשה" });
    fireEvent.change(within(form).getByLabelText("שם הממליץ/ה"), { target: { value: "מ.כ" } });
    fireEvent.change(within(form).getByLabelText("ההמלצה"), { target: { value: "ליווי מקצועי ורגיש" } });
    expect(within(form).getByText("יש לאשר שההמלצה אמיתית ושהממליץ/ה הסכים/ה לפרסומה.")).toBeTruthy();
    const add = within(form).getByRole("button", { name: "הוספת ההמלצה" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.click(within(form).getByLabelText(/ההמלצה אמיתית/));
    h.onb.saveTestimonial.mockResolvedValue({});
    fireEvent.click(add);
    await waitFor(() => expect(h.onb.saveTestimonial).toHaveBeenCalled());
    expect(h.onb.saveTestimonial.mock.calls[0][1]).toMatchObject({ agent_id: AGENT.id, name: "מ.כ", consent_confirmed_at: expect.any(String) });
  });

  it("lists what is missing on the review step, links back to its step, and sends for approval", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "review" } }, agent: AGENT });
    show();
    await stepTitle();
    expect(screen.getByText(/פרטים לפני שליחה לאישור/)).toBeTruthy();
    const contact = screen.getByRole("button", { name: "שלב 3 · פרטי קשר" });
    h.onb.submit.mockResolvedValue({ ok: false, missing: ["agency_profiles.email"], gates: [], message: "חסרים פרטים לפני שליחה לאישור." });
    fireEvent.click(screen.getByRole("button", { name: "שליחה לאישור" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("עוד 1 פרטים לפני שליחה לאישור:")).toBeTruthy();
    await act(async () => void fireEvent.click(contact));
    expect(await stepTitle()).toBe("פרטי קשר");
  });

  it("says it was sent once the server accepts it", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "review" } }, agent: AGENT });
    h.onb.submit.mockResolvedValue({ ok: true });
    show();
    await stepTitle();
    fireEvent.click(screen.getByRole("button", { name: "שליחה לאישור" }));
    expect(await screen.findByText(/נשלח לאישור/)).toBeTruthy();
    expect(h.onb.submit).toHaveBeenCalledWith(AGENCY);
  });
});
