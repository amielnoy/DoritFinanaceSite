// @vitest-environment jsdom
/*
 * The home and about sections read the agency's content (task 5 of the
 * agency-content step), CMP-AGC-010…018. The flag is mocked on and the services
 * mock resolves a record; the flag-off renders are the existing section tests,
 * which stay unchanged.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENCY1_ID } from "@/config/agency1";
import type { AgencySiteRecord, SuccessCase } from "@/services/ports";
import { resetServicesMock, servicesMock } from "./services-mock";

vi.mock("@/config/agency-content", () => ({ AGENCY_CONTENT: true, isAgencyContentOn: () => true }));
vi.mock("@/services", async (importOriginal) => (await import("./services-mock")).servicesModule(importOriginal));

// framer-motion's layout animations need APIs jsdom does not implement.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = new Proxy(
    {},
    { get: (_t, tag: string) => ({ children, ...props }: any) => React.createElement(tag, props, children) },
  );
  return {
    motion: passthrough,
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

const auth = vi.hoisted(() => ({ isAuthenticated: false, user: null as null | { role: string } }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth }));

const roles = vi.hoisted(() => ({ useAgencyRole: vi.fn() }));
vi.mock("@/hooks/useAgency", async () => {
  const helper = await import("../helpers/agency-role-mock");
  return { ...helper.agencyHookMock({ role: "admin", isOperator: false }), useAgencyRole: roles.useAgencyRole };
});

vi.mock("@/components/dorit/primitives/Reveal", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/dorit/forms/NeedsWizard", () => ({ default: () => null }));
vi.mock("@/components/dorit/forms/QuickContact", () => ({ default: () => null }));
vi.mock("@/components/dorit/sections/ArchStatement", () => ({ default: () => null }));

import Hero from "@/components/dorit/sections/Hero";
import About from "@/components/dorit/sections/About";
import ReviewsWidget from "@/components/dorit/sections/ReviewsWidget";
import ProofCarousel from "@/components/dorit/sections/ProofCarousel";
import StartConversation from "@/components/dorit/sections/StartConversation";
import Testimonials from "@/components/dorit/sections/Testimonials";
import { can } from "@/config/permissions";

const AGENCY_F = "f0000000-0000-0000-0000-00000000000f";

function record(over: {
  agencyId?: string;
  agent?: Partial<AgencySiteRecord["agent"]>;
  contact?: Partial<AgencySiteRecord["contact"]>;
} = {}): AgencySiteRecord {
  return {
    agencyId: over.agencyId ?? AGENCY_F,
    contact: {
      phoneE164: "+972521112222",
      phoneDisplay: "052-111-2222",
      whatsapp: "972521112222",
      email: "yael@example.test",
      defaultWhatsappMessage: "שלום",
      ...over.contact,
    },
    agent: {
      fullName: "יעל כהן",
      professionalTitle: "מתכננת פיננסית",
      photoPath: null,
      photoAlt: null,
      licenceNumber: "L-0001",
      bio: {
        headline: "שורת פתיחה",
        family: "משפחה-י",
        credentials: "תעודות-י",
        career: "קריירה-י",
        insight: "תובנה-י",
        unique: "ייחודי-י",
        signature: "חתימה-י",
      },
      stats: [
        { num: "12", label: "שנות ניסיון" },
        { num: "300", label: "משפחות" },
        { num: "4", label: "ערים" },
      ],
      bookingUrl: null,
      reviewLinks: { google: "https://g.example.test/yael" },
      ...over.agent,
    },
  };
}

const show = (r: AgencySiteRecord) => servicesMock.agencyContent.siteContent.mockResolvedValue(r);

function renderIt(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetServicesMock();
  auth.isAuthenticated = false;
  auth.user = null;
  roles.useAgencyRole.mockReset();
  roles.useAgencyRole.mockReturnValue({ role: null, isOperator: false, can: () => false, isLoading: false, isError: false });
});

describe("<Hero /> from the record", () => {
  it("CMP-AGC-010: byline, licence, headline and monogram are the record's; the contact buttons are the sticky bar's", async () => {
    show(record());
    const { container } = renderIt(<Hero />);
    await waitFor(() => expect(screen.getAllByText("יעל כהן · מתכננת פיננסית")).toHaveLength(1)); // the portrait caption only; the pill above the headline is gone (2026-10-26)
    expect(screen.getByText("L-0001")).toBeTruthy();
    expect(screen.getByText("שורת פתיחה")).toBeTruthy();
    expect(screen.getByRole("img", { name: "יעל כהן — דיוקן מקצועי" })).toBeTruthy();
    expect(container.innerHTML).not.toContain("/images/dorit-office-portrait");
    // WhatsApp and the call are offered once, by the sticky bar (CMP-AGC-021) — not again in the hero (review, 2026-10-25).
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.some((h) => h.startsWith("tel:") || h.startsWith("https://wa.me/"))).toBe(false);
  });

  it("CMP-AGC-011: agency 1 without a photo keeps the bundled picture", async () => {
    show(record({ agencyId: AGENCY1_ID }));
    const { container } = renderIt(<Hero />);
    await waitFor(() => expect(screen.getAllByText("יעל כהן · מתכננת פיננסית")).toHaveLength(1));
    expect(container.querySelector("picture source[type='image/avif']")?.getAttribute("srcset")).toContain(
      "/images/dorit-office-portrait-480.avif",
    );
  });
});

describe("<About /> from the record", () => {
  it("CMP-AGC-012: the paragraphs are the record's bio, and the stats follow its count", async () => {
    show(record({ agent: { stats: [{ num: "12", label: "שנות ניסיון" }, { num: "300", label: "משפחות" }] } }));
    const { container } = renderIt(<About />);
    await screen.findByText("קריירה-י");
    expect(screen.getByText("משפחה-י תעודות-י")).toBeTruthy();
    expect(screen.getByText("תובנה-י")).toBeTruthy();
    expect(screen.getByText("ייחודי-י")).toBeTruthy();
    expect(screen.getByText("חתימה-י")).toBeTruthy();
    const strip = container.querySelector(".grid-cols-2") as HTMLElement;
    expect(strip).toBeTruthy();
    expect(strip.children).toHaveLength(2);
  });

  it("CMP-AGC-013: without family the first paragraph is the credentials alone", async () => {
    show(record({ agent: { bio: { headline: "ש", credentials: "תעודות-י", career: "קריירה-י" } } }));
    renderIt(<About />);
    const p = await screen.findByText("תעודות-י");
    expect(p.textContent).toBe("תעודות-י");
  });

  it("CMP-AGC-014: no stats, no strip; no signature, no signature line", async () => {
    show(record({ agent: { stats: [], bio: { headline: "ש", credentials: "תעודות-י", career: "קריירה-י" } } }));
    const { container } = renderIt(<About />);
    await screen.findByText("קריירה-י");
    expect(container.querySelector(".border-y")).toBeNull();
    expect(container.querySelector("p.italic")).toBeNull();
  });
});

describe("<ReviewsWidget /> from the record", () => {
  it("CMP-AGC-015: the Google link is the record's, and without a Midrag link there is none", async () => {
    show(record());
    renderIt(<ReviewsWidget />);
    const google = await waitFor(() => {
      const a = screen.getByText(/חוות דעת ב-Google/).closest("a")!;
      expect(a.getAttribute("href")).toBe("https://g.example.test/yael");
      return a;
    });
    expect(google).toBeTruthy();
    expect(screen.queryByText(/Midrag/, { selector: "a" })).toBeNull();
    expect(screen.queryByText(/חוות דעת ב-Midrag/)).toBeNull();
  });
});

describe("<ProofCarousel /> from the record", () => {
  const CASES: SuccessCase[] = [
    { tag: "תג א", title: "כותרת א", body: "גוף א", metric: "₪1", estimate: true },
    { tag: "תג ב", title: "כותרת ב", body: "גוף ב", metric: "₪2", estimate: false },
  ];

  it("CMP-AGC-016: the cases and the WhatsApp number are the agency's, and the basis shows under estimates only", async () => {
    show(record());
    servicesMock.agencyContent.successCases.mockResolvedValue(CASES);
    const { container } = renderIt(<ProofCarousel />);
    await screen.findByText("כותרת א");
    expect(screen.getByText("כותרת ב")).toBeTruthy();
    const articles = container.querySelectorAll("article");
    expect(articles).toHaveLength(2);
    expect(within(articles[0] as HTMLElement).queryByText(/./, { selector: "span.text-\\[13px\\]" })).toBeTruthy();
    expect(within(articles[1] as HTMLElement).queryByText(/./, { selector: "span.text-\\[13px\\]" })).toBeNull();
    expect(container.querySelector("a[href^='https://wa.me/972521112222']")).toBeTruthy();
  });
});

describe("<StartConversation /> from the record", () => {
  it("CMP-AGC-017: the booking block links to the record's URL, the chips use its contact", async () => {
    show(record({ agent: { bookingUrl: "https://cal.example.test/yael" } }));
    const { container } = renderIt(<StartConversation />);
    await waitFor(() => expect(container.querySelector("a[href='https://cal.example.test/yael']")).toBeTruthy());
    expect(container.querySelector("[data-track-location='start_booking']")).toBeTruthy();
    expect(container.querySelector("a[href='tel:+972521112222']")).toBeTruthy();
    expect(container.querySelector("a[href='https://wa.me/972521112222']")).toBeTruthy();
  });

  it("CMP-AGC-017b: another agency without a booking URL has no booking block", async () => {
    show(record());
    const { container } = renderIt(<StartConversation />);
    await waitFor(() => expect(container.querySelector("a[href='tel:+972521112222']")).toBeTruthy());
    expect(container.querySelector("[data-track-location='start_booking']")).toBeNull();
  });
});

describe("<Testimonials /> for the site's agency", () => {
  it("CMP-AGC-018: asks for the site agency's testimonials, and agency 1's Admin sees no add control there", async () => {
    show(record());
    auth.isAuthenticated = true;
    roles.useAgencyRole.mockImplementation((id: string) =>
      id === AGENCY1_ID
        ? { role: "admin", isOperator: false, can: (a: any) => can("admin", false, a), isLoading: false, isError: false }
        : { role: null, isOperator: false, can: () => false, isLoading: false, isError: false },
    );
    servicesMock.content.listTestimonials.mockResolvedValue([
      { id: "t1", name: "רונית", quote: "ליווי מקצועי", rating: 5, source: "google", created_date: "2026-10-01T09:00:00Z" },
    ]);
    renderIt(<Testimonials />);
    await screen.findByText("ליווי מקצועי");
    // The first read goes out for agency 1 while the site is still loading.
    await waitFor(() => expect(servicesMock.content.listTestimonials).toHaveBeenCalledWith(50, AGENCY_F));
    expect(roles.useAgencyRole.mock.calls.some(([id]) => id === AGENCY_F)).toBe(true);
    expect(screen.queryByRole("button", { name: "הוספת המלצה" })).toBeNull();
  });
});
