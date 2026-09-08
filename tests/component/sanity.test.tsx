/**
 * @vitest-environment jsdom
 *
 * Sanity component tests: each first-party component renders, exposes the
 * accessible names the e2e suite and screen readers rely on, and calls the
 * Base44 client with the payload the backend contract expects.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { base44Mock, resetBase44Mock } from "./base44-mock";

vi.mock("@/api/base44Client", () => ({ base44: base44Mock }));

// framer-motion's layout animations need APIs jsdom does not implement.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({ children, ...props }: any) =>
          React.createElement(tag === "div" ? "div" : tag, props, children),
    }
  );
  return {
    motion: passthrough,
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

import { CONTACT } from "@/config/contact";
import Stars from "@/components/dorit/Stars";
import MobileStickyBar from "@/components/dorit/MobileStickyBar";
import FloatingActions from "@/components/dorit/FloatingActions";
import PensionFeeCalculator from "@/components/dorit/PensionFeeCalculator";
import QuickContact from "@/components/dorit/QuickContact";
import FAQ from "@/components/dorit/FAQ";
import ShareButtons from "@/components/dorit/ShareButtons";
import ReviewsWidget from "@/components/dorit/ReviewsWidget";

const withRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => resetBase44Mock());

describe("<Stars />", () => {
  it("exposes the rating as an image with an accessible name", () => {
    render(<Stars value={4} />);
    const rating = screen.getByRole("img", { name: /דירוג 4 מתוך 5/ });
    expect(rating).toBeInTheDocument();
  });

  it("rounds a fractional rating", () => {
    render(<Stars value={4.6} />);
    expect(screen.getByRole("img", { name: /דירוג 5 מתוך 5/ })).toBeInTheDocument();
  });

  it("renders five stars regardless of the value", () => {
    const { container } = render(<Stars value={2} />);
    expect(container.querySelectorAll("svg")).toHaveLength(5);
  });

  it("treats a missing value as zero rather than NaN", () => {
    render(<Stars />);
    expect(screen.getByRole("img", { name: /דירוג 0 מתוך 5/ })).toBeInTheDocument();
  });
});

describe("<MobileStickyBar />", () => {
  it("offers a dial link and a consultation anchor", () => {
    render(<MobileStickyBar />);

    expect(screen.getByRole("link", { name: /חייגו עכשיו/ })).toHaveAttribute(
      "href",
      `tel:${CONTACT.phoneE164}`
    );
    expect(screen.getByRole("link", { name: /קביעת ייעוץ/ })).toHaveAttribute("href", "#consultation");
  });
});

describe("<FloatingActions />", () => {
  it("links to WhatsApp with a prefilled Hebrew message and a safe rel", () => {
    render(<FloatingActions />);

    const wa = screen.getByRole("link", { name: "פתיחת שיחה בוואטסאפ" });
    expect(wa).toHaveAttribute("href", expect.stringContaining(`wa.me/${CONTACT.whatsapp}`));
    expect(wa).toHaveAttribute("target", "_blank");
    expect(wa.getAttribute("rel")).toContain("noopener");
    expect(decodeURIComponent(wa.getAttribute("href") ?? "")).toContain("שלום דורית");
  });

  it("links to the phone number in E.164 form", () => {
    render(<FloatingActions />);
    expect(screen.getByRole("link", { name: /התקשרות/ })).toHaveAttribute(
      "href",
      `tel:${CONTACT.phoneE164}`
    );
  });
});

describe("<PensionFeeCalculator />", () => {
  it("renders the default scenario", () => {
    render(<PensionFeeCalculator />);

    expect(screen.getByLabelText("הפקדה חודשית (₪)")).toHaveValue(2000);
    expect(screen.getByLabelText("שנות חיסכון")).toHaveValue(25);
    expect(screen.getByText(/סך הפקדות/)).toBeInTheDocument();
  });

  it("recomputes the totals when an input changes", async () => {
    const user = userEvent.setup();
    const { container } = render(<PensionFeeCalculator />);

    const totals = () => Array.from(container.querySelectorAll("p.font-heading")).map((n) => n.textContent ?? "");
    const before = totals()[0];

    const deposit = screen.getByLabelText("הפקדה חודשית (₪)");
    await user.clear(deposit);
    await user.type(deposit, "4000");

    await waitFor(() => expect(totals()[0]).not.toBe(before));
  });

  it("never shows NaN when every field is cleared", async () => {
    const user = userEvent.setup();
    const { container } = render(<PensionFeeCalculator />);

    for (const label of [
      "הפקדה חודשית (₪)",
      "שנות חיסכון",
      "דמי ניהול בהפקדה (%)",
      "דמי ניהול שוטפים (% שנתי)",
      "תשואה שנתית צפויה (%)",
    ]) {
      await user.clear(screen.getByLabelText(label));
    }

    expect(container.textContent).not.toContain("NaN");
  });

  it("labels every input for assistive tech", () => {
    render(<PensionFeeCalculator />);
    for (const input of screen.getAllByRole("spinbutton")) {
      expect(input).toHaveAccessibleName();
    }
  });
});

describe("<QuickContact />", () => {
  it("disables submit until name and phone are present", async () => {
    const user = userEvent.setup();
    render(<QuickContact />);

    const submit = screen.getByRole("button", { name: /שליחת הודעה/ });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/שם מלא/), "ישראלה");
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/טלפון/), "050-1234567");
    expect(submit).toBeEnabled();
  });

  it("emails the office and records a Lead with source=quick", async () => {
    const user = userEvent.setup();
    render(<QuickContact />);

    await user.type(screen.getByLabelText(/שם מלא/), "ישראלה");
    await user.type(screen.getByLabelText(/טלפון/), "050-1234567");
    await user.type(screen.getByLabelText(/אימייל/), "a@b.co");
    await user.click(screen.getByRole("button", { name: /שליחת הודעה/ }));

    await waitFor(() => expect(base44Mock.integrations.Core.SendEmail).toHaveBeenCalled());
    const email = base44Mock.integrations.Core.SendEmail.mock.calls[0][0] as any;
    expect(email).toMatchObject({ to: expect.stringContaining("@") });
    expect(email.body).toContain("050-1234567");

    await waitFor(() => expect(base44Mock.entities.Lead.create).toHaveBeenCalled());
    expect(base44Mock.entities.Lead.create.mock.calls[0][0]).toMatchObject({
      name: "ישראלה",
      phone: "050-1234567",
      email: "a@b.co",
      source: "quick",
      status: "new",
    });
  });

  it("confirms to the visitor and clears the form after a successful send", async () => {
    const user = userEvent.setup();
    render(<QuickContact />);

    await user.type(screen.getByLabelText(/שם מלא/), "ישראלה");
    await user.type(screen.getByLabelText(/טלפון/), "050-1234567");
    await user.click(screen.getByRole("button", { name: /שליחת הודעה/ }));

    expect(await screen.findByText("ההודעה נשלחה. תודה.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /שליחת הודעה נוספת/ }));
    expect(screen.getByLabelText(/שם מלא/)).toHaveValue("");
  });

  it("keeps the visitor's input and offers a fallback when sending fails", async () => {
    const user = userEvent.setup();
    base44Mock.integrations.Core.SendEmail.mockRejectedValueOnce(new Error("smtp down"));
    render(<QuickContact />);

    await user.type(screen.getByLabelText(/שם מלא/), "ישראלה");
    await user.type(screen.getByLabelText(/טלפון/), "050-1234567");
    await user.click(screen.getByRole("button", { name: /שליחת הודעה/ }));

    expect(await screen.findByText(/לא הצלחנו לשלוח/)).toBeInTheDocument();
    expect(screen.getByLabelText(/שם מלא/)).toHaveValue("ישראלה");
  });

  it("does not submit twice on a double click", async () => {
    const user = userEvent.setup();
    render(<QuickContact />);

    await user.type(screen.getByLabelText(/שם מלא/), "ישראלה");
    await user.type(screen.getByLabelText(/טלפון/), "050-1234567");
    const submit = screen.getByRole("button", { name: /שליחת הודעה/ });
    await user.dblClick(submit);

    await waitFor(() => expect(base44Mock.entities.Lead.create).toHaveBeenCalledTimes(1));
  });
});

describe("<FAQ />", () => {
  it("renders questions as buttons and reveals the answer on click", async () => {
    const user = userEvent.setup();
    const { container } = render(<FAQ />);

    const questions = screen.getAllByRole("button");
    expect(questions.length).toBeGreaterThan(0);

    const before = container.textContent?.length ?? 0;
    await user.click(questions[0]);
    await waitFor(() => expect(container.textContent?.length ?? 0).toBeGreaterThan(before));
  });
});

describe("<ShareButtons />", () => {
  it("renders share targets that all use https and a safe rel", () => {
    const { container } = render(<ShareButtons title="כותרת" />);

    const links = Array.from(container.querySelectorAll("a[target=_blank]"));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      // Share targets are https endpoints plus one mailto: fallback.
      expect(link.getAttribute("href") ?? "").toMatch(/^(https:\/\/|mailto:)/);
      expect(link.getAttribute("rel") ?? "").toContain("noopener");
    }
  });
});

describe("<ReviewsWidget />", () => {
  it("asks the backend for testimonials on mount", async () => {
    withRouter(<ReviewsWidget />);
    await waitFor(() => expect(base44Mock.entities.Testimonial.list).toHaveBeenCalled());
    expect(base44Mock.entities.Testimonial.list).toHaveBeenCalledWith("-created_date", 50);
  });

  it("renders without crashing when the backend returns nothing", async () => {
    base44Mock.entities.Testimonial.list.mockResolvedValueOnce([]);
    const { container } = withRouter(<ReviewsWidget />);
    await waitFor(() => expect(base44Mock.entities.Testimonial.list).toHaveBeenCalled());
    expect(container).toBeTruthy();
  });

  it("survives a backend error without throwing", async () => {
    base44Mock.entities.Testimonial.list.mockRejectedValueOnce(new Error("boom"));
    const { container } = withRouter(<ReviewsWidget />);
    await waitFor(() => expect(base44Mock.entities.Testimonial.list).toHaveBeenCalled());
    expect(container).toBeTruthy();
  });
});
