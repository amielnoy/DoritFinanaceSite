// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * The privacy policy tells a client that the agency's staff may open their
 * record from the engagement — with the client mode (VITE_STAFF_LEADS and
 * VITE_STAFF_CLIENTS) and not before it, so switching it on publishes the
 * line in the same build (staff-client spec, "Retention and privacy").
 */

vi.mock("@/components/dorit/layout/FloatingHeader", () => ({ default: () => null }));
vi.mock("@/components/dorit/layout/Footer", () => ({ default: () => null }));
vi.mock("@/components/dorit/primitives/CredentialsStrip", () => ({ default: () => null }));

const LINE = /צוות הסוכנות עשוי לפתוח עבורך רשומה במאגר/;

async function renderPolicy(leads: boolean, clients: boolean) {
  vi.resetModules();
  vi.doMock("@/config/staff-leads", async (orig) => ({ ...(await orig<object>()), STAFF_LEADS: leads }));
  vi.doMock("@/config/staff-clients", async (orig) => ({ ...(await orig<object>()), STAFF_CLIENTS: clients }));
  const { default: PrivacyPolicy } = await import("@/pages/PrivacyPolicy");
  render(
    <MemoryRouter>
      <PrivacyPolicy />
    </MemoryRouter>,
  );
  return screen.getByRole("heading", { name: "2. הפרטים שאנו אוספים" }).closest("section")!;
}

afterEach(() => {
  vi.doUnmock("@/config/staff-leads");
  vi.doUnmock("@/config/staff-clients");
});

describe("the privacy policy's line on clients added by hand", () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
  ])("is absent unless both switches are on (leads %s, clients %s)", async (leads, clients) => {
    const section = await renderPolicy(leads, clients);
    expect(section.textContent).not.toMatch(LINE);
  });

  it("says what is kept, for what, who sees it, how long, and the invitation, once both are on", async () => {
    const section = await renderPolicy(true, true);
    const text = section.textContent!.replace(/\s+/g, " ");
    expect(text).toMatch(LINE);
    expect(text).toContain("על סמך הסכם ההתקשרות — שם, טלפון, דוא״ל, החודש שבו החלה ההתקשרות ותחומי השירות");
    expect(text).toContain("גלויה לצוות הסוכנות בלבד");
    expect(text).toContain("כמידע הנוגע להתקשרות בפועל (סעיף 7)");
    expect(text).toContain("הזמנה לאזור האישי");
  });
});
