/**
 * @vitest-environment jsdom
 *
 * The home page's testimonials section exists only when there is something to
 * show: nothing while loading, nothing when empty, and no placeholder.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Testimonial } from "@/services";
import { resetServicesMock, servicesMock } from "./services-mock";

vi.mock("@/services", async (importOriginal) => (await import("./services-mock")).servicesModule(importOriginal));

// framer-motion's layout animations need APIs jsdom does not implement.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = new Proxy(
    {},
    { get: (_t, tag: string) => ({ children, ...props }: any) => React.createElement(tag, props, children) }
  );
  return {
    motion: passthrough,
    AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
    useReducedMotion: () => true,
  };
});

const auth = vi.hoisted(() => ({ isAuthenticated: false, user: null as null | { role: string } }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth }));

import Testimonials from "@/components/dorit/sections/Testimonials";

const T1: Testimonial = { id: "t1", name: "רונית לוי", quote: "ליווי מקצועי", rating: 5, source: "google", created_date: "2026-10-01T09:00:00Z" };
const T2: Testimonial = { id: "t2", name: "אבי כהן", quote: "חסכה לי כסף אמיתי", rating: 5, source: "midrag", created_date: "2026-10-02T09:00:00Z" };

const render_ = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Testimonials />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

beforeEach(() => {
  resetServicesMock();
  auth.isAuthenticated = false;
  auth.user = null;
});

describe("<Testimonials />", () => {
  it("renders nothing while loading and nothing when there are no testimonials", async () => {
    servicesMock.content.listTestimonials.mockResolvedValueOnce([]);
    const { container } = render_();
    expect(container.querySelector("#testimonials")).toBeNull();
    await waitFor(() => expect(servicesMock.content.listTestimonials).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("#testimonials")).toBeNull();
    expect(screen.queryByRole("heading", { name: "לקוחות מספרים" })).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders the section and its heading when there are testimonials", async () => {
    servicesMock.content.listTestimonials.mockResolvedValueOnce([T1]);
    const { container } = render_();
    expect(await screen.findByRole("heading", { name: "לקוחות מספרים" })).toBeTruthy();
    expect(container.querySelector("section#testimonials")).not.toBeNull();
    expect(screen.getByText("ליווי מקצועי")).toBeTruthy();
  });

  it("keeps the section for an admin when empty, so the first one can be added", async () => {
    auth.isAuthenticated = true;
    auth.user = { role: "admin" };
    servicesMock.content.listTestimonials.mockResolvedValueOnce([]);
    render_();
    expect(await screen.findByRole("button", { name: /הוספת המלצה/ })).toBeTruthy();
  });

  it("shows a signed-in visitor who is not an admin no add or delete controls", async () => {
    // Ordinary visitors sign in for the personal area; Dorit's controls are not theirs.
    auth.isAuthenticated = true;
    auth.user = { role: "user" };
    servicesMock.content.listTestimonials.mockResolvedValueOnce([T1]);
    const { container } = render_();
    expect(await screen.findByText("ליווי מקצועי")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /הוספת המלצה/ })).toBeNull();
    expect(container.querySelectorAll("button").length).toBe(0);
  });

  it("hides the empty section from a signed-in visitor who is not an admin", async () => {
    auth.isAuthenticated = true;
    auth.user = { role: "user" };
    servicesMock.content.listTestimonials.mockResolvedValueOnce([]);
    const { container } = render_();
    await waitFor(() => expect(servicesMock.content.listTestimonials).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector("#testimonials")).toBeNull();
  });
});

/**
 * Below md (stage 3b): two or more testimonials are a strip that scrolls
 * sideways one card at a time, with prev/next buttons beside the heading.
 * `matchMedia` is stubbed to a width, as in needs-wizard.test.tsx; without it
 * (jsdom's default, every case above) the section is the desktop's grid.
 */
/**
 * Dorit's controls say what failed and ask before a delete, as the leads and
 * blog screens do (review 2026-10-15, item 18).
 */
describe("<Testimonials /> — the admin's writes", () => {
  const one = [T1];
  const { removeTestimonial: remove, createTestimonial: create } = servicesMock.contentAdmin;
  const { upload } = servicesMock.uploads;
  beforeEach(() => {
    auth.isAuthenticated = true;
    auth.user = { role: "admin" };
    // jsdom has no object URLs; the form previews the picked file with one.
    if (!URL.createObjectURL) Object.defineProperty(URL, "createObjectURL", { value: () => "blob:preview", configurable: true });
  });
  afterEach(() => vi.restoreAllMocks());

  /** Opens the form and fills the two required fields. */
  async function fillForm(container: HTMLElement) {
    fireEvent.click(await screen.findByRole("button", { name: /הוספת המלצה/ }));
    const [name] = Array.from(container.querySelectorAll<HTMLInputElement>("input:not([type=file])"));
    fireEvent.change(name, { target: { value: "דנה כהן" } });
    fireEvent.change(container.querySelector("textarea")!, { target: { value: "שירות מצוין" } });
  }

  it("asks before deleting, and deletes nothing when the answer is no", async () => {
    servicesMock.content.listTestimonials.mockResolvedValue(one);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render_();
    fireEvent.click(await screen.findByRole("button", { name: "מחיקה" }));
    expect(confirm).toHaveBeenCalledWith("למחוק את ההמלצה?");
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "מחיקה" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("t1"));
  });

  it("says so in an alert when a delete fails", async () => {
    servicesMock.content.listTestimonials.mockResolvedValue(one);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    remove.mockRejectedValueOnce(new Error("denied"));
    render_();
    fireEvent.click(await screen.findByRole("button", { name: "מחיקה" }));
    expect((await screen.findByRole("alert")).textContent).toContain("ההמלצה לא נמחקה");
  });

  it("says so in an alert when the picture does not upload, and publishes nothing", async () => {
    servicesMock.content.listTestimonials.mockResolvedValue([]);
    upload.mockRejectedValueOnce(new Error("too big"));
    const { container } = render_();
    await fillForm(container);
    const file = new File(["x"], "face.png", { type: "image/png" });
    fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /פרסום המלצה/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("התמונה לא הועלתה");
    expect(create).not.toHaveBeenCalled();
  });

  it("says so in an alert when the testimonial is not saved", async () => {
    servicesMock.content.listTestimonials.mockResolvedValue([]);
    create.mockRejectedValueOnce(new Error("denied"));
    const { container } = render_();
    await fillForm(container);
    fireEvent.click(screen.getByRole("button", { name: /פרסום המלצה/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("ההמלצה לא נשמרה");
  });
});

describe("<Testimonials /> on a phone", () => {
  function viewport(width: number) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => {
        const min = /min-width:\s*(\d+)px/.exec(query);
        return {
          matches: min ? width >= Number(min[1]) : false,
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        };
      },
    });
  }
  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });
  const TWO = [T1, T2];

  it("shows two or more as a focusable strip, every card in it, with prev and next buttons", async () => {
    viewport(390);
    servicesMock.content.listTestimonials.mockResolvedValueOnce(TWO);
    render_();
    const strip = await screen.findByRole("region", { name: "לקוחות מספרים — גלילה אופקית" });
    expect(strip.getAttribute("tabindex")).toBe("0");
    expect(strip.id).toBe("testimonials-strip");
    // Beside each other, not removed: both cards and both quotes are there.
    expect(strip.querySelectorAll("article").length).toBe(2);
    expect(screen.getByText("ליווי מקצועי")).toBeTruthy();
    expect(screen.getByText("חסכה לי כסף אמיתי")).toBeTruthy();
    expect(screen.getByRole("article", { name: "המלצה 1 מתוך 2" })).toBeTruthy();
    const prev = screen.getByRole("button", { name: "ההמלצה הקודמת" });
    const next = screen.getByRole("button", { name: "ההמלצה הבאה" });
    expect(prev.getAttribute("aria-controls")).toBe("testimonials-strip");
    expect(next.getAttribute("aria-controls")).toBe("testimonials-strip");
    // At the first card there is no going back; there is going on.
    expect(prev.getAttribute("aria-disabled")).toBe("true");
    expect(next.getAttribute("aria-disabled")).toBe("false");
  });

  it("next scrolls the strip by one card; prev at the first card does nothing", async () => {
    viewport(390);
    servicesMock.content.listTestimonials.mockResolvedValueOnce(TWO);
    render_();
    const strip = await screen.findByRole("region", { name: "לקוחות מספרים — גלילה אופקית" });
    const scrollTo = vi.fn();
    (strip as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
    fireEvent.click(screen.getByRole("button", { name: "ההמלצה הקודמת" }));
    expect(scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "ההמלצה הבאה" }));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("shows a single testimonial as it is, with no strip and no buttons", async () => {
    viewport(390);
    servicesMock.content.listTestimonials.mockResolvedValueOnce(TWO.slice(0, 1));
    render_();
    expect(await screen.findByText("ליווי מקצועי")).toBeTruthy();
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("from md up, the grid: no strip and no buttons", async () => {
    viewport(1440);
    servicesMock.content.listTestimonials.mockResolvedValueOnce(TWO);
    const { container } = render_();
    expect(await screen.findByText("חסכה לי כסף אמיתי")).toBeTruthy();
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("#testimonials .grid")).not.toBeNull();
  });
});
