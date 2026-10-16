// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

import Masleka from "@/pages/Masleka";
import SeoRouteGuard from "@/components/SeoRouteGuard";
import { clientMessage } from "@/lib/masleka";
import { MaslekaError } from "@/services/ports";

const TOKEN = "Ab3_-".repeat(8) + "xyz";

const renderPage = (props: React.ComponentProps<typeof Masleka>) =>
  render(
    <MemoryRouter>
      <Masleka {...props} />
    </MemoryRouter>,
  );

const fill = async (code = "AB12-CD34", id = "000000018") => {
  await userEvent.type(screen.getByLabelText("קוד האימות מאתר המסלקה"), code);
  await userEvent.type(screen.getByLabelText("מספר תעודת זהות"), id);
  await userEvent.click(screen.getByRole("button", { name: "שליחה" }));
};

beforeEach(() => {
  window.history.replaceState(null, "", `/masleka#t=${TOKEN}`);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("<Masleka /> — dark", () => {
  it("says the service is unavailable when the switch is off, and offers no form", () => {
    const submit = vi.fn();
    renderPage({ enabled: false, submit });
    expect(screen.getByRole("heading", { name: "השירות אינו זמין כרגע" })).toBeInTheDocument();
    expect(screen.queryByRole("form")).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("<Masleka /> — on", () => {
  it("takes the link's token out of the address bar", () => {
    renderPage({ enabled: true, submit: vi.fn() });
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/masleka");
  });

  it("does not take the token from a query string", async () => {
    window.history.replaceState(null, "", `/masleka?t=${TOKEN}`);
    const submit = vi.fn();
    renderPage({ enabled: true, submit });
    expect(screen.getByRole("heading", { name: "הקישור חסר או שגוי" })).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it("sends the code and the nine-digit ID with the link's token, then only thanks", async () => {
    const submit = vi.fn(async () => {});
    renderPage({ enabled: true, submit });
    await fill(" AB12-CD34 ", "00018");
    expect(submit).toHaveBeenCalledWith(TOKEN, "AB12-CD34", "000000018");
    expect(await screen.findByRole("heading", { name: "תודה — דורית תטפל בזה" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("00018")).toBeNull();
    expect(screen.queryByDisplayValue(/AB12-CD34/)).toBeNull();
  });

  it("writes neither value to storage or the console", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const err = vi.spyOn(console, "error");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderPage({ enabled: true, submit: vi.fn(async () => {}) });
    await fill();
    await screen.findByRole("heading", { name: "תודה — דורית תטפל בזה" });
    expect(setItem).not.toHaveBeenCalled();
    for (const spy of [log, warn, err]) {
      expect(JSON.stringify(spy.mock.calls)).not.toMatch(/AB12-CD34|000000018/);
    }
  });

  it("refuses an ID that fails the check digit before sending", async () => {
    const submit = vi.fn();
    renderPage({ enabled: true, submit });
    await fill("AB12-CD34", "000000019");
    expect(screen.getByRole("alert")).toHaveTextContent("מספר תעודת הזהות אינו תקין");
    expect(submit).not.toHaveBeenCalled();
  });

  it("refuses a code that cannot be one", async () => {
    const submit = vi.fn();
    renderPage({ enabled: true, submit });
    await fill("ab", "000000018");
    expect(screen.getByRole("alert")).toHaveTextContent("הקוד אינו נראה תקין");
    expect(submit).not.toHaveBeenCalled();
  });

  it("explains a link that is no longer valid, in clientMessage's words", async () => {
    const submit = vi.fn(async () => {
      throw new MaslekaError("link_invalid", "r1");
    });
    renderPage({ enabled: true, submit });
    await fill();
    expect(await screen.findByRole("alert")).toHaveTextContent(clientMessage(new MaslekaError("link_invalid")).text);
  });

  it("after too many tries says to wait, and that the link is not dead", async () => {
    const submit = vi.fn(async () => {
      throw new MaslekaError("rate_limited", "r1");
    });
    renderPage({ enabled: true, submit });
    await fill();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("נסו שוב בעוד זמן מה");
    expect(alert).toHaveTextContent("הקישור תקין");
    expect(alert).not.toHaveTextContent("אינו תקף");
  });

  it("after an unknown failure says the code may have arrived, with no invitation to retry", async () => {
    const submit = vi.fn(async () => {
      throw new MaslekaError("failed", "r1");
    });
    renderPage({ enabled: true, submit });
    await fill();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ייתכן שהקוד כבר התקבל");
    expect(alert).toHaveTextContent("דורית תיצור קשר");
    expect(alert).not.toHaveTextContent("נסו שוב");
  });

  it("after a send that stored nothing says so plainly, and keeps both values for the retry", async () => {
    const submit = vi
      .fn<(token: string, code: string, idNumber: string) => Promise<void>>()
      .mockRejectedValueOnce(new MaslekaError("not_saved", "r1"))
      .mockResolvedValueOnce(undefined);
    renderPage({ enabled: true, submit });
    await fill();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("השליחה לא עברה והקוד לא נשמר");
    expect(alert).toHaveTextContent("נסו לשלוח שוב");
    expect(alert).not.toHaveTextContent("ייתכן");
    await userEvent.click(screen.getByRole("button", { name: "שליחה" }));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
    expect(await screen.findByRole("heading", { name: "תודה — דורית תטפל בזה" })).toBeInTheDocument();
  });

  it("treats a thrown non-MaslekaError the same way", async () => {
    const submit = vi.fn(async () => {
      throw new TypeError("network");
    });
    renderPage({ enabled: true, submit });
    await fill();
    expect(await screen.findByRole("alert")).toHaveTextContent("ייתכן שהקוד כבר התקבל");
  });

  it("asks for the link when there is no token", () => {
    window.history.replaceState(null, "", "/masleka");
    renderPage({ enabled: true, submit: vi.fn() });
    expect(screen.getByRole("heading", { name: "הקישור חסר או שגוי" })).toBeInTheDocument();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("links to the clearinghouse in a new tab without a referrer", () => {
    renderPage({ enabled: true, submit: vi.fn() });
    const link = screen.getByRole("link", { name: "לאתר המסלקה" });
    expect(link).toHaveAttribute("href", "https://www.swiftness.co.il/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
    expect(link.getAttribute("rel")).toMatch(/noreferrer/);
  });

  it("links the privacy policy, since it collects an ID number", () => {
    renderPage({ enabled: true, submit: vi.fn() });
    expect(screen.getByRole("link", { name: "מדיניות הפרטיות" })).toHaveAttribute("href", "/privacy");
  });

  it("renders no screenshot slot when none is given, and the given one when it is", () => {
    const { unmount } = renderPage({ enabled: true, submit: vi.fn() });
    expect(screen.queryAllByRole("figure")).toHaveLength(0);
    unmount();
    window.history.replaceState(null, "", `/masleka#t=${TOKEN}`);
    renderPage({ enabled: true, submit: vi.fn(), screenshots: { 2: <img alt="הפקת הקוד" src="/x.png" /> } });
    expect(screen.getAllByRole("figure")).toHaveLength(1);
    expect(screen.getByAltText("הפקת הקוד")).toBeInTheDocument();
  });
});

describe("/masleka in search", () => {
  it("is marked noindex", async () => {
    render(
      <MemoryRouter initialEntries={["/masleka"]}>
        <SeoRouteGuard />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(document.querySelector('meta[name="robots"]')?.getAttribute("content")).toMatch(/noindex/),
    );
  });
});
