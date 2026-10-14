// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/*
 * The growth brief (2026-10-14): "בדיקת תיק פנסיוני" as the flagship — its
 * form, its page, the year-end page, the hero's main button, the calculator's
 * gate — and the Cal.com and WhatsApp-channel switches.
 */

const submitInterview = vi.fn(async () => ({ ok: true, rid: "r1" }));
vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  return { ...actual, services: { ...actual.services, leads: { ...actual.services.leads, submitInterview } } };
});

// The switches are read once from the build; each test sets them here.
const offers = vi.hoisted(() => ({ cal: null as string | null, channel: null as string | null }));
vi.mock("@/config/offers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/offers")>();
  return {
    ...actual,
    get CAL_LINK() {
      return offers.cal;
    },
    get WHATSAPP_CHANNEL_URL() {
      return offers.channel;
    },
  };
});

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = new Proxy(
    {},
    { get: (_t, tag: string) => ({ children, ...props }: any) => React.createElement(tag, props, children) },
  );
  return { motion: passthrough, AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children) };
});
// The pages' header reads the sign-in; it is not what these tests are about.
vi.mock("@/components/dorit/layout/FloatingHeader", () => ({ default: () => null }));
vi.mock("@/components/ui/image", async () => {
  const React = await import("react");
  return { Image: ({ src, alt }: { src: string; alt: string }) => React.createElement("img", { src, alt }) };
});

const { default: PensionCheckForm } = await import("@/components/dorit/forms/PensionCheckForm");
const { default: PensionCheck } = await import("@/pages/PensionCheck");
const { default: YearEndSelfEmployed } = await import("@/pages/YearEndSelfEmployed");
const { default: Hero } = await import("@/components/dorit/sections/Hero");
const { default: PensionFeeCalculator } = await import("@/components/dorit/sections/PensionFeeCalculator");
const { default: Footer } = await import("@/components/dorit/layout/Footer");
const { default: StartConversation } = await import("@/components/dorit/sections/StartConversation");

type Gtag = ReturnType<typeof vi.fn>;
const w = window as unknown as { gtag?: Gtag };
const sent = (name: string) => w.gtag!.mock.calls.filter((c) => c[1] === name);
const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  w.gtag = vi.fn();
  submitInterview.mockClear();
  offers.cal = null;
  offers.channel = null;
});
afterEach(() => {
  delete w.gtag;
});

async function fill(name: string, phone: string, email = "") {
  await userEvent.type(screen.getByLabelText("שם *"), name);
  await userEvent.type(screen.getByLabelText("טלפון נייד *"), phone);
  if (email) await userEvent.type(screen.getByLabelText(/אימייל/), email);
  await userEvent.click(screen.getByRole("button", { name: "לבדיקת תיק פנסיוני" }));
}

describe("<PensionCheckForm /> — the flagship's form", () => {
  it("sends the questionnaire's lead with the clearinghouse opt-in ticked, and counts it once saved", async () => {
    inRouter(<PensionCheckForm location="calculator" context="אחרי מחשבון דמי הניהול" />);
    await fill("דנה כהן", "0501234567", "dana@example.com");
    expect(await screen.findByRole("status")).toHaveTextContent("במייל שלך מחכה קישור אישי");
    expect(submitInterview).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "דנה כהן",
        phone: "0501234567",
        email: "dana@example.com",
        track: "pension",
        meetingTopic: "בדיקת תיק פנסיוני",
        profile: { clearinghouse: "מעוניין/ת" },
        stage: "complete",
        summary: "בדיקת תיק פנסיוני — בקשה מהאתר (אחרי מחשבון דמי הניהול).",
      }),
    );
    expect(sent("generate_lead")).toEqual([["event", "generate_lead", { method: "pension_check", location: "calculator" }]]);
  });

  it("takes no email too, and says Dorit will send the link herself", async () => {
    inRouter(<PensionCheckForm location="page" context="x" />);
    await fill("דנה", "0501234567");
    expect(await screen.findByRole("status")).toHaveTextContent("דורית תחזור אליך ותשלח את הקישור");
    expect(submitInterview.mock.calls[0][0]).toMatchObject({ email: undefined });
  });

  it("asks for a name, a mobile number and a real address before sending", async () => {
    inRouter(<PensionCheckForm location="page" context="x" />);
    await userEvent.click(screen.getByRole("button", { name: "לבדיקת תיק פנסיוני" }));
    expect(screen.getByRole("alert")).toHaveTextContent("נא למלא שם.");
    await fill("דנה", "031234567");
    expect(screen.getByRole("alert")).toHaveTextContent("מספר נייד");
    await userEvent.clear(screen.getByLabelText("טלפון נייד *"));
    await userEvent.type(screen.getByLabelText("טלפון נייד *"), "0501234567");
    await userEvent.type(screen.getByLabelText(/אימייל/), "not-an-address");
    await userEvent.click(screen.getByRole("button", { name: "לבדיקת תיק פנסיוני" }));
    expect(screen.getByRole("alert")).toHaveTextContent("כתובת המייל");
    expect(submitInterview).not.toHaveBeenCalled();
  });

  it("says so, and counts nothing, when the save fails", async () => {
    submitInterview.mockResolvedValueOnce({ ok: false, rid: "r2" });
    inRouter(<PensionCheckForm location="page" context="x" />);
    await fill("דנה", "0501234567");
    expect(await screen.findByRole("alert")).toHaveTextContent("לא הצלחנו לשלוח");
    expect(sent("generate_lead")).toHaveLength(0);
  });
});

describe("the flagship's places", () => {
  it("/pension-check: one h1, three steps, the form and the disclosure, and no 'חינם'", () => {
    const { container } = inRouter(<PensionCheck />);
    expect(screen.getByRole("heading", { level: 1, name: "בדיקת תיק פנסיוני" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(3);
    expect(screen.getByRole("button", { name: "לבדיקת תיק פנסיוני" })).toBeInTheDocument();
    expect(container.textContent).toMatch(/שיווק פנסיוני ולא ייעוץ פנסיוני אובייקטיבי/);
    expect(container.textContent).not.toMatch(/חינם/);
  });

  it("/atzmaim-31-12: the article's figures, a link to it, and the form with the campaign as its context", async () => {
    inRouter(<YearEndSelfEmployed />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("עד 31.12");
    expect(screen.getByText(/38,400/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /המדריך המלא/ })).toHaveAttribute("href", "/blog/sof-shana-atzmaim");
    await fill("דנה", "0501234567");
    expect(submitInterview.mock.calls[0][0]).toMatchObject({ summary: expect.stringContaining("עצמאים — עד 31.12") });
    expect(sent("generate_lead")[0][2]).toEqual({ method: "pension_check", location: "year_end" });
  });

  it("the hero leads with the check; the conversation is the second button, hidden on a phone", () => {
    inRouter(<Hero />);
    const hero = within(document.getElementById("top")!);
    expect(hero.getByRole("link", { name: "בדיקת תיק פנסיוני" })).toHaveAttribute("href", "/pension-check");
    const talk = hero.getByRole("link", { name: "לשיחה קצרה עם דורית" });
    expect(talk).toHaveAttribute("href", "#start");
    expect(talk.className).toContain("max-md:hidden");
  });

  it("the fee calculator offers the check right after its result", () => {
    inRouter(<PensionFeeCalculator />);
    expect(screen.getByRole("heading", { name: "רוצים לדעת כמה אתם משלמים בפועל? בדיקת מסלקה אישית" })).toBeInTheDocument();
  });
});

describe("the outside links, each behind its switch", () => {
  it("the footer names the WhatsApp channel only once its address is set", () => {
    const { unmount } = inRouter(<Footer />);
    expect(screen.queryByRole("link", { name: "להצטרפות לערוץ הוואטסאפ" })).toBeNull();
    unmount();
    offers.channel = "https://whatsapp.com/channel/abc";
    inRouter(<Footer />);
    const link = screen.getByRole("link", { name: "להצטרפות לערוץ הוואטסאפ" });
    expect(link).toHaveAttribute("href", "https://whatsapp.com/channel/abc");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/תזכורת אחת בחודש לפני דדליינים של מס/)).toBeInTheDocument();
  });

  it("#start offers the 15-minute call first once Cal.com is set, the questionnaire second", () => {
    const { unmount } = inRouter(<StartConversation />);
    expect(screen.queryByRole("link", { name: /לבחירת מועד/ })).toBeNull();
    unmount();
    offers.cal = "https://cal.com/dorit/15min";
    inRouter(<StartConversation />);
    const book = screen.getByRole("link", { name: /לבחירת מועד/ });
    expect(book).toHaveAttribute("href", "https://cal.com/dorit/15min");
    expect(book).toHaveAttribute("target", "_blank");
    expect(screen.getByText("שיחת טלפון של 15 דקות עם דורית")).toBeInTheDocument();
    expect(screen.getByText(/או, אם נוח יותר — שלוש שאלות קצרות/)).toBeInTheDocument();
  });
});
