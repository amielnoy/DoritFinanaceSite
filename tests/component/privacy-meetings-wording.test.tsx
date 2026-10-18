// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/*
 * The privacy policy tells a client what the personal area shows of their
 * meetings — with the "הפגישות שלי" tab (VITE_MEETINGS_CLIENT) and not before
 * it, so switching the tab on publishes the wording in the same build (#261).
 */

vi.mock("@/components/dorit/layout/FloatingHeader", () => ({ default: () => null }));
vi.mock("@/components/dorit/layout/Footer", () => ({ default: () => null }));
vi.mock("@/components/dorit/primitives/CredentialsStrip", () => ({ default: () => null }));

const MEETINGS = /סיכומי פגישות שדורית בוחרת לפרסם/;

async function renderPolicy(clientTab: boolean) {
  vi.resetModules();
  vi.doMock("@/config/meetings", () => ({ MEETINGS_STAFF: true, MEETINGS_CLIENT: clientTab }));
  const { default: PrivacyPolicy } = await import("@/pages/PrivacyPolicy");
  render(
    <MemoryRouter>
      <PrivacyPolicy />
    </MemoryRouter>,
  );
  return screen.getByText(/^אזור אישי:/);
}

afterEach(() => vi.doUnmock("@/config/meetings"));

describe("the privacy policy's personal-area paragraph", () => {
  it("says nothing of meetings while the client's tab is off", async () => {
    const item = await renderPolicy(false);
    expect(item.textContent).not.toMatch(MEETINGS);
    expect(item.textContent).toMatch(/סטטוס הטיפול\. אפשר לבקש עיון/);
  });

  it("describes the published summaries, the meeting times and the change requests once it is on", async () => {
    const item = await renderPolicy(true);
    const text = item.textContent!.replace(/\s+/g, " ");
    expect(text).toMatch(MEETINGS);
    expect(text).toContain("רק למי שמתחבר עם כתובת המייל המאומתת שמסר בפנייה");
    expect(text).toContain("ואינו ייעוץ בכתב, ואינו מחליף מסמך שהדין מחייב (כגון מסמך הנמקה)");
    expect(text).toContain("נשמרת אצל דורית יחד עם הפנייה, ונמחקת יחד איתה.");
    expect(text).toMatch(/סטטוס הטיפול\. סיכומי פגישות[^]*איתה\. אפשר לבקש עיון/);
  });
});
