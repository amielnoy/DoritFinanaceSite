// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/services", async (importOriginal) => (await import("./services-mock")).servicesModule(importOriginal));
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: { full_name: "רונית", email: "ronit@example.com", id: "u1" }, isAuthenticated: true, logout: vi.fn() }),
}));

import Account from "@/pages/Account";
import { PENSION_MARKETING_DISCLOSURE } from "@/config/compliance";
import type { ClientAnswer, ClientSnapshot } from "@/services/ports";
import { SNAPSHOT } from "../fixtures/clearinghouse-snapshot";

const PUBLISHED: ClientSnapshot = {
  takenAt: "2026-10-12T09:00:00.000Z",
  publishedAt: "2026-10-14T10:00:00.000Z",
  snapshot: SNAPSHOT,
  items: [
    { id: "i1", title: "דמי ניהול גבוהים", body: "נבקש מהקרן להשוות.", priority: "important", clientStatus: "open", clientNote: null },
    { id: "i2", title: "כיסוי כפול", body: "נבדוק איזה להשאיר.", priority: "check", clientStatus: "open", clientNote: null },
  ],
};

function renderAccount(opts: { snapshot?: ClientSnapshot | null; enabled?: boolean } = {}) {
  let current: ClientSnapshot | null = opts.snapshot === undefined ? PUBLISHED : opts.snapshot;
  const respond = vi.fn(async (id: string, status: ClientAnswer, note?: string) => {
    current = current && {
      ...current,
      items: current.items.map((i) => (i.id === id ? { ...i, clientStatus: status, clientNote: note ?? null } : i)),
    };
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Account
          loadEnquiries={async () => []}
          loadSnapshot={async () => current}
          respond={respond}
          snapshotEnabled={opts.enabled ?? true}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { respond };
}

const card = (title: string) => within(screen.getByRole("listitem", { name: title }));

describe("<Account /> — the personal snapshot tab (phase 4)", () => {
  it("opens on תמונת מצב, with the dates, the four tiles, the products and the recommendations", async () => {
    renderAccount();
    expect(screen.getByRole("tab", { name: "תמונת מצב" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText(/נתוני המסלקה מתאריך 12.10.2026 · נבדקו על ידי דורית ב־14.10.2026/)).toBeInTheDocument();
    const summary = within(screen.getByRole("region", { name: "סיכום" }));
    for (const label of ["סך החיסכון", "קצבה צפויה בגיל 67 (הערכה)", "דמי ניהול בשנה", "המלצות פתוחות"]) {
      expect(summary.getByText(label)).toBeInTheDocument();
    }
    expect(summary.getByText("המלצות פתוחות").nextSibling).toHaveTextContent("2");
    expect(screen.getAllByRole("row")).toHaveLength(SNAPSHOT.accounts.length + 1);
    expect(card("דמי ניהול גבוהים").getByText("חשוב")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(PENSION_MARKETING_DISCLOSURE.slice(0, 30)))).toBeInTheDocument();
  });

  it("answers 'כן, לטפל בזה' and says so", async () => {
    const { respond } = renderAccount();
    await screen.findByRole("listitem", { name: "דמי ניהול גבוהים" });
    await userEvent.click(card("דמי ניהול גבוהים").getByRole("button", { name: "כן, לטפל בזה" }));
    expect(respond).toHaveBeenCalledWith("i1", "accepted", undefined);
    expect(await card("דמי ניהול גבוהים").findByText("ביקשת לטפל בזה")).toBeInTheDocument();
  });

  it("sends a question with its text", async () => {
    const { respond } = renderAccount();
    await screen.findByRole("listitem", { name: "כיסוי כפול" });
    await userEvent.click(card("כיסוי כפול").getByRole("button", { name: "יש לי שאלה" }));
    await userEvent.type(card("כיסוי כפול").getByRole("textbox", { name: "השאלה שלך לדורית" }), "איזה כיסוי כדאי?");
    await userEvent.click(card("כיסוי כפול").getByRole("button", { name: "שליחת השאלה" }));
    expect(respond).toHaveBeenCalledWith("i2", "question", "איזה כיסוי כדאי?");
    expect(await card("כיסוי כפול").findByText(/שאלת את דורית/)).toBeInTheDocument();
  });

  it("offers the clearinghouse check when nothing is published yet", async () => {
    renderAccount({ snapshot: null });
    expect(await screen.findByText("עוד אין כאן תמונת מצב")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "לבדיקת תיק פנסיוני" })).toHaveAttribute("href", "/pension-check");
  });

  it("keeps the enquiries in their own tab", async () => {
    renderAccount();
    await userEvent.click(screen.getByRole("tab", { name: "הפניות שלי" }));
    expect(screen.getByRole("tabpanel", { name: "הפניות שלי" })).toBeInTheDocument();
    expect(await screen.findByText("עוד אין כאן פניות")).toBeInTheDocument();
  });

  it("is the page it was when the switch is off: no tabs, no snapshot", async () => {
    renderAccount({ enabled: false });
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(await screen.findByText("עוד אין כאן פניות")).toBeInTheDocument();
    expect(screen.queryByText(/תמונת מצב/)).toBeNull();
  });
});
