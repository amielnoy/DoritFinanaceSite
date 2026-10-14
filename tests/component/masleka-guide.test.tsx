// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import MaslekaGuide from "@/pages/MaslekaGuide";
import SeoRouteGuard from "@/components/SeoRouteGuard";
import { LICENCE } from "@/config/compliance";
import { CLEARINGHOUSE_ADVISOR_URL } from "@/config/masleka";

const renderGuide = (props: React.ComponentProps<typeof MaslekaGuide> = {}) =>
  render(
    <MemoryRouter>
      <MaslekaGuide {...props} />
    </MemoryRouter>,
  );

describe("<MaslekaGuide />", () => {
  it("walks through registering, submitting and downloading, in order", () => {
    renderGuide();
    const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titles).toEqual([
      "נכנסים לאתר המסלקה כבעלי רישיון",
      "נרשמים — ללא עלות",
      "מגישים בקשה לכל לקוח",
      "מורידים את הקבצים",
    ]);
  });

  it("names the licence the registration is made under", () => {
    renderGuide();
    expect(screen.getByText(new RegExp(LICENCE.number))).toBeInTheDocument();
  });

  it("links to the clearinghouse in a new tab without a referrer, and back to the board", () => {
    renderGuide();
    const out = screen.getByRole("link", { name: "לאתר המסלקה" });
    expect(out).toHaveAttribute("href", CLEARINGHOUSE_ADVISOR_URL);
    expect(out).toHaveAttribute("target", "_blank");
    expect(out.getAttribute("rel")).toMatch(/noopener/);
    expect(out.getAttribute("rel")).toMatch(/noreferrer/);
    expect(screen.getByRole("link", { name: /חזרה ללוח/ })).toHaveAttribute("href", "/admin/masleka");
  });

  it("shows no screenshot unless one is given", () => {
    const { unmount } = renderGuide();
    expect(screen.queryAllByRole("figure")).toHaveLength(0);
    unmount();
    renderGuide({ screenshots: { 3: <img alt="הגשת בקשה בפורטל" src="/x.png" /> } });
    expect(screen.getByAltText("הגשת בקשה בפורטל")).toBeInTheDocument();
  });

  it("is marked noindex", async () => {
    render(
      <MemoryRouter initialEntries={["/admin/masleka/guide"]}>
        <SeoRouteGuard />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toMatch(/noindex/),
    );
  });
});
