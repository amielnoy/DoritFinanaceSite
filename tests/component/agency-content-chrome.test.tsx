// @vitest-environment jsdom
/*
 * The header, footer, sticky bar and public pages take contact and licence from
 * the agency's content (task 6 of the agency-content step), CMP-AGC-020…022.
 * The flag is mocked on and the services mock resolves a sentinel record; the
 * flag-off renders are the existing tests, which stay unchanged.
 */
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgencySiteRecord } from "@/services/ports";
import { resetServicesMock, servicesMock } from "./services-mock";

vi.mock("@/config/agency-content", () => ({ AGENCY_CONTENT: true, isAgencyContentOn: () => true }));
vi.mock("@/services", async (importOriginal) => (await import("./services-mock")).servicesModule(importOriginal));

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

vi.mock("@/hooks/useAgency", async () => {
  const helper = await import("../helpers/agency-role-mock");
  return helper.agencyHookMock({ role: null, isOperator: false });
});

vi.mock("@/components/dorit/primitives/Reveal", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import Footer from "@/components/dorit/layout/Footer";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import MobileStickyBar from "@/components/dorit/layout/MobileStickyBar";
import PrivacyPolicy from "@/pages/PrivacyPolicy";

const SENTINEL: AgencySiteRecord = {
  agencyId: "f0000000-0000-0000-0000-00000000000f",
  contact: {
    phoneE164: "+972500000000",
    phoneDisplay: "050-000-0000",
    whatsapp: "972500000000",
    email: "sentinel@example.test",
    defaultWhatsappMessage: "שלום",
  },
  agent: {
    fullName: "יעל כהן",
    professionalTitle: "מתכננת פיננסית",
    photoPath: null,
    photoAlt: null,
    licenceNumber: "L-0001",
    bio: { headline: "ש" },
    stats: [],
    bookingUrl: null,
    reviewLinks: {},
  },
};

function renderIt(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const hrefs = (c: HTMLElement) => [...c.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");

beforeEach(() => {
  resetServicesMock();
  auth.isAuthenticated = false;
  auth.user = null;
  servicesMock.agencyContent.siteContent.mockResolvedValue(SENTINEL);
});

describe("chrome and pages from the record", () => {
  it("CMP-AGC-020: the footer shows the record's phone, email and licence", async () => {
    const { container } = renderIt(<Footer />);
    await waitFor(() => expect(container.textContent).toContain("050-000-0000"));
    expect(container.textContent).toContain("L-0001");
    expect(container.textContent).not.toContain("L-00107009");
    expect(hrefs(container)).toContain("mailto:sentinel@example.test");
    expect(hrefs(container)).toContain("tel:+972500000000");
  });

  it("CMP-AGC-021: the sticky bar and the header call the record's number", async () => {
    const bar = renderIt(<MobileStickyBar />);
    await waitFor(() => expect(hrefs(bar.container)).toContain("tel:+972500000000"));
    const header = renderIt(<FloatingHeader />);
    await waitFor(() => expect(hrefs(header.container)).toContain("tel:+972500000000"));
  });

  it("CMP-AGC-022: the privacy policy mails the record's email", async () => {
    const { container } = renderIt(<PrivacyPolicy />);
    await waitFor(() => expect(hrefs(container)).toContain("mailto:sentinel@example.test"));
  });
});
