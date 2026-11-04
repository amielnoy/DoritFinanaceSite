// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
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
    let phone = screen.getByLabelText(/טלפון נייד/);
    fireEvent.change(phone, { target: { value: "03-1234567" } });
    expect(screen.getAllByRole("alert").some((a) => a.textContent === "נדרש מספר נייד ישראלי, למשל 052-1234567.")).toBe(true);
    // A bad value never blocks the move (ONB-D-02): it is left out, and the owner is told.
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    expect(await screen.findByText("לא נשמר כי הערך אינו תקין: טלפון נייד.")).toBeTruthy();
    await waitFor(() => expect(h.onb.saveProfile).toHaveBeenCalled());
    expect(h.onb.saveProfile.mock.calls[0][1]).not.toHaveProperty("phone_e164");
    h.onb.saveProfile.mockClear();

    fireEvent.click(await screen.findByRole("button", { name: "הקודם" }));
    await waitFor(async () => expect(await stepTitle()).toBe("פרטי קשר"));
    phone = screen.getByLabelText(/טלפון נייד/);
    fireEvent.change(phone, { target: { value: "052-1234567" } });
    h.onb.saveProfile.mockClear();
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
    // Affiliations show, and are required, once "כן" is chosen: the checklist counts them.
    expect(screen.getByLabelText(/הגופים המוסדיים/)).toBeTruthy();
    // The bot is the licensee's, by first name (ONB-D-12).
    expect(screen.getByText("זהו עוזר אוטומטי (בינה מלאכותית) של דן כהן — לא דן עצמו ולא בעל רישיון.")).toBeTruthy();
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
  it("CMP-ONB-101: moves freely before step 1's name is saved, and creates the licensee with what was typed later (ONB-D-01)", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "licence" } } });
    show();
    expect(await stepTitle()).toBe("רישוי וגילוי נאות");
    fireEvent.change(screen.getByLabelText(/מספר רישיון/), { target: { value: "L-0012345" } });
    fireEvent.click(screen.getByRole("button", { name: "הקודם" }));
    await waitFor(async () => expect(await stepTitle()).toBe("בעל/ת הרישיון"));
    expect(screen.getByText("הפרטים של בעל/ת הרישיון יישמרו ברגע שימולא השם המלא בשלב 1.")).toBeTruthy();
    expect(h.onb.saveAgent).not.toHaveBeenCalled();
    expect(screen.queryByText(/כדי לשמור, יש להשלים קודם/)).toBeNull();

    fireEvent.change(screen.getByLabelText(/שם מלא/), { target: { value: "רחל לוי" } });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(() => expect(h.onb.saveAgent).toHaveBeenCalled());
    expect(h.onb.saveAgent.mock.calls[0][2]).toMatchObject({ full_name: "רחל לוי", licence_number: "L-0012345" });
  });

  it("CMP-ONB-102: a step with nothing typed moves without a word, even with no licensee yet (ONB-D-01)", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "about" } } });
    show();
    expect(await stepTitle()).toBe("אודות");
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(async () => expect(await stepTitle()).toBe("המלצות ותיקי הצלחה"));
    expect(screen.queryByText(/יישמרו ברגע/)).toBeNull();
    expect(h.onb.saveAgent).not.toHaveBeenCalled();
  });

  it("CMP-ONB-103: shows the institutional bodies only after יש זיקה = כן, and clears them on לא (ONB-D-04)", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "licence" } }, agent: AGENT });
    show();
    await stepTitle();
    expect(screen.queryByLabelText(/הגופים המוסדיים/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "כן" }));
    fireEvent.change(screen.getByLabelText(/הגופים המוסדיים/), { target: { value: "מגדל" } });
    fireEvent.click(screen.getByRole("button", { name: "לא" }));
    expect(screen.queryByLabelText(/הגופים המוסדיים/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(() => expect(h.onb.saveAgent).toHaveBeenCalled());
    expect(h.onb.saveAgent.mock.calls.at(-1)![2]).toMatchObject({ has_institutional_affiliation: false });
    expect(h.onb.saveAgent.mock.calls.at(-1)![2]).not.toHaveProperty("affiliations");
  });

  it("CMP-ONB-104: a stat typed in row 2 stays in row 2 (ONB-D-05)", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "about" } }, agent: AGENT });
    show();
    await stepTitle();
    const label2 = screen.getByLabelText("תיאור מספר 2") as HTMLInputElement;
    for (const v of ["ל", "לק", "לקוחות"]) fireEvent.change(label2, { target: { value: v } });
    expect(label2.value).toBe("לקוחות");
    expect((screen.getByLabelText("תיאור מספר 1") as HTMLInputElement).value).toBe("");
  });

  it("CMP-ONB-105: a saved testimonial opens for editing and saves in place; a delete asks first (ONB-D-06, ONB-D-10)", async () => {
    const row = { id: "t1", name: "מ.כ", role: null, quote: "ליווי מקצועי", rating: 5, source: "google", source_url: null, sort_order: 0 };
    h.record = { ...baseRecord({ profile: { onboarding: { last_step: "testimonials" } }, agent: AGENT }), testimonials: [row] };
    h.onb.saveTestimonial.mockResolvedValue({});
    show();
    await stepTitle();
    expect(screen.getByText(/מ\.כ · Google/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "עריכת ההמלצה של מ.כ" }));
    const form = screen.getByRole("form", { name: "עריכת המלצה" });
    expect((within(form).getByLabelText("ההמלצה") as HTMLTextAreaElement).value).toBe("ליווי מקצועי");
    fireEvent.change(within(form).getByLabelText("ההמלצה"), { target: { value: "ליווי מקצועי ורגיש" } });
    fireEvent.click(within(form).getByLabelText(/ההמלצה אמיתית/));
    fireEvent.click(within(form).getByRole("button", { name: "שמירת השינויים" }));
    await waitFor(() => expect(h.onb.saveTestimonial).toHaveBeenCalled());
    expect(h.onb.saveTestimonial.mock.calls[0][1]).toMatchObject({ id: "t1", quote: "ליווי מקצועי ורגיש" });

    fireEvent.click(screen.getByRole("button", { name: "מחיקת ההמלצה של מ.כ" }));
    expect(h.onb.deleteTestimonial).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(h.onb.deleteTestimonial).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "מחיקת ההמלצה של מ.כ" }));
    fireEvent.click(screen.getByRole("button", { name: "כן, למחוק" }));
    await waitFor(() => expect(h.onb.deleteTestimonial).toHaveBeenCalledWith("t1"));
  });

  it("CMP-ONB-106: the checklist names the phone once, never its raw columns (ONB-D-07)", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "review" } }, agent: AGENT });
    show();
    await stepTitle();
    const contact = screen.getByRole("button", { name: "שלב 3 · פרטי קשר" }).closest("li")!;
    expect(contact.textContent).toContain("טלפון נייד");
    expect(contact.textContent).not.toMatch(/agency_profiles\./);
  });

  it("CMP-ONB-107: after sending, the old return note gives way to the pending banner (ONB-D-11)", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "review", review: { return_note: "חסר דיוקן" } } }, agent: AGENT });
    h.onb.submit.mockResolvedValue({ ok: true });
    show();
    await stepTitle();
    expect(screen.getByText(/הוחזרה לתיקונים/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "שליחה לאישור" }));
    await screen.findByText(/הסוכנות נשלחה לאישור/);
    expect(screen.queryByText(/הוחזרה לתיקונים/)).toBeNull();
  });
  it("CMP-ONB-109: a new line in a one-per-line box stays while the next item is typed (ONB-D-13)", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "contact" } }, agent: AGENT });
    show();
    await stepTitle();
    const box = screen.getByLabelText(/כתובות להתראות/) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "a@example.com\n" } });
    expect(box.value).toBe("a@example.com\n");
    fireEvent.change(box, { target: { value: "a@example.com\nb@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(() => expect(h.onb.saveProfile).toHaveBeenCalled());
    expect(h.onb.saveProfile.mock.calls[0][1]).toMatchObject({ notify_emails: ["a@example.com", "b@example.com"] });
  });

  it("CMP-ONB-110: a required value typed but not acceptable does not tick its step (ONB-D-15)", async () => {
    h.record = baseRecord({
      profile: { onboarding: { last_step: "licence" }, licence_entity: "רחל לוי" },
      agent: { ...AGENT, licence_number: "L-0012345", licence_types: ["life_agent"], has_institutional_affiliation: false },
    });
    show();
    await stepTitle();
    const chip = () => screen.getByRole("button", { name: /2 · רישוי וגילוי נאות/ });
    expect(chip().querySelector("svg")).not.toBeNull();
    fireEvent.change(screen.getByLabelText(/מספר רישיון/), { target: { value: "12345" } });
    expect(chip().querySelector("svg")).toBeNull();
  });

  it("CMP-ONB-111: an English phrase in a Hebrew hint stays in one piece, its full stop outside (ONB-D-16)", async () => {
    const { Bidi } = await import("@/components/dorit/onboarding/fields");
    const { container } = render(<p><Bidi text="Google appointment schedule, Calendly או Outlook Bookings." /></p>);
    expect([...container.querySelectorAll("bdi")].map((b) => b.textContent)).toEqual(["Google appointment schedule, Calendly", "Outlook Bookings"]);
    expect(container.textContent).toBe("Google appointment schedule, Calendly או Outlook Bookings.");
  });
  /** The wizard with the browser's Back and Forward, as buttons outside it. */
  function showWithHistory(entry = `/admin/onboarding/${AGENCY}`) {
    const History = () => {
      const navigate = useNavigate();
      return (
        <>
          <button type="button" onClick={() => navigate(-1)}>browser-back</button>
          <button type="button" onClick={() => navigate(1)}>browser-forward</button>
        </>
      );
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[entry]}>
          <History />
          <Routes>
            <Route path="/admin/onboarding/:agencyId" element={<AgencyOnboarding />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("CMP-ONB-112: the address names the step, and opens it (ONB-D-21)", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "contact" } }, agent: AGENT });
    showWithHistory(`/admin/onboarding/${AGENCY}?step=meetings`);
    expect(await stepTitle()).toBe("פגישות");
  });

  it("CMP-ONB-113: the browser's Back and Forward move between steps, saving what was typed on the way (ONB-D-21, ONB-D-22)", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "contact" } }, agent: AGENT });
    showWithHistory();
    expect(await stepTitle()).toBe("פרטי קשר");
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    await waitFor(async () => expect(await stepTitle()).toBe("אודות"));
    // Typed, never left — then Back.
    fireEvent.change(screen.getByLabelText(/משפט שיווקי קצר/), { target: { value: "משפט חדש" } });
    h.onb.saveAgent.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "browser-back" }));
    await waitFor(async () => expect(await stepTitle()).toBe("פרטי קשר"));
    await waitFor(() => expect(h.onb.saveAgent).toHaveBeenCalled());
    expect(h.onb.saveAgent.mock.calls[0][2]).toMatchObject({ bio: { headline: "משפט חדש" } });
    fireEvent.click(screen.getByRole("button", { name: "browser-forward" }));
    await waitFor(async () => expect(await stepTitle()).toBe("אודות"));
    expect((screen.getByLabelText(/משפט שיווקי קצר/) as HTMLTextAreaElement).value).toBe("משפט חדש");
  });

  it("CMP-ONB-114: leaving step 5 with a testimonial typed and not added asks first (ONB-D-20)", async () => {
    h.record = baseRecord({ profile: { onboarding: { last_step: "testimonials" } }, agent: AGENT });
    showWithHistory();
    await stepTitle();
    const form = screen.getByRole("form", { name: "המלצה חדשה" });
    fireEvent.change(within(form).getByLabelText("שם הממליץ/ה"), { target: { value: "י.ל" } });
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    expect(await screen.findByText(/התחלת למלא המלצה/)).toBeTruthy();
    expect(await stepTitle()).toBe("המלצות ותיקי הצלחה");
    fireEvent.click(screen.getByRole("button", { name: "להישאר כאן" }));
    expect((within(form).getByLabelText("שם הממליץ/ה") as HTMLInputElement).value).toBe("י.ל");
    fireEvent.click(screen.getByRole("button", { name: "המשך" }));
    fireEvent.click(await screen.findByRole("button", { name: "להמשיך בלי להוסיף" }));
    await waitFor(async () => expect(await stepTitle()).toBe("פגישות"));
  });
});
