// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MaslekaAnalysis from "@/pages/MaslekaAnalysis";
import { analyse } from "@/lib/clearinghouse/analysis";
import { PENSION_MARKETING_DISCLOSURE } from "@/config/compliance";
import { MaslekaError, type FindingReview, type MaslekaPort, type ReviewDecision } from "@/services/ports";
import { SNAPSHOT } from "../fixtures/clearinghouse-snapshot";

const FINDINGS = analyse(SNAPSHOT);
const STORED = { id: "s1", requestId: "r1", clientName: "רונית מזרחי", takenAt: "2026-10-12T09:00:00.000Z", snapshot: SNAPSHOT };

/** A port whose decisions live in memory, so a decision shows up on the refetch. */
function service(over: Partial<MaslekaPort> = {}, reviews: FindingReview[] = []) {
  const store = new Map(reviews.map((r) => [r.findingKey, r]));
  const port = {
    getSnapshot: vi.fn(async () => STORED),
    listReviews: vi.fn(async () => [...store.values()]),
    decide: vi.fn(async (_s: string, key: string, decision: ReviewDecision | null) => {
      if (decision) store.set(key, { findingKey: key, reviewedAt: "t", ...decision });
      else store.delete(key);
    }),
    ...over,
  } as unknown as MaslekaPort;
  return port;
}

function renderPage(port: MaslekaPort, print = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MaslekaAnalysis service={port} snapshotId="s1" print={print} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { print };
}

const card = (title: string) => within(screen.getByRole("listitem", { name: title }));

describe("<MaslekaAnalysis /> — Dorit's review of a client's report", () => {
  it("shows the client, the totals, every finding as a draft, and the products", async () => {
    renderPage(service());
    expect(await screen.findByRole("heading", { level: 1, name: "ניתוח מסלקה — רונית מזרחי" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "סיכום" })).toHaveTextContent("493,000");
    expect(screen.getAllByRole("listitem").filter((li) => li.closest("ol"))).toHaveLength(FINDINGS.length);
    expect(screen.getByRole("status")).toHaveTextContent(`${FINDINGS.length} ממתינות לבדיקה · 0 אושרו`);
    expect(screen.getAllByRole("row")).toHaveLength(SNAPSHOT.accounts.length + 1);
    expect(screen.getByText(PENSION_MARKETING_DISCLOSURE)).toBeInTheDocument();
  });

  it("will not print before anything is approved", async () => {
    renderPage(service());
    expect(await screen.findByRole("button", { name: "הדפסה" })).toBeDisabled();
  });

  it("approves a finding, then prints", async () => {
    const port = service();
    const { print } = renderPage(port);
    const [first] = FINDINGS;
    await userEvent.click((await screen.findAllByRole("button", { name: "אישור" }))[0]);
    expect(port.decide).toHaveBeenCalledWith("s1", first.key, { status: "approved", finalText: null });
    expect(await card(first.title).findByText("אושר")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "הדפסה" }));
    expect(print).toHaveBeenCalled();
  });

  it("approves in Dorit's own words, and stores them only when they differ from the draft", async () => {
    const port = service();
    renderPage(port);
    const [first] = FINDINGS;
    await screen.findByRole("listitem", { name: first.title });
    await userEvent.click(card(first.title).getByRole("button", { name: "עריכה" }));
    const field = card(first.title).getByRole("textbox", { name: "הנוסח של ההמלצה" });
    await userEvent.clear(field);
    await userEvent.type(field, "נדבר על זה בפגישה");
    await userEvent.click(card(first.title).getByRole("button", { name: "שמירה ואישור" }));
    expect(port.decide).toHaveBeenCalledWith("s1", first.key, { status: "approved", finalText: "נדבר על זה בפגישה" });
    expect(await card(first.title).findByText("נדבר על זה בפגישה")).toBeInTheDocument();
    expect(card(first.title).getByText(/בנוסח של דורית/)).toBeInTheDocument();
  });

  it("rejects a finding and can put it back to draft", async () => {
    const port = service();
    renderPage(port);
    const [first] = FINDINGS;
    await screen.findByRole("listitem", { name: first.title });
    await userEvent.click(card(first.title).getByRole("button", { name: "דחייה" }));
    expect(port.decide).toHaveBeenCalledWith("s1", first.key, { status: "rejected", finalText: null });
    await userEvent.click(await card(first.title).findByRole("button", { name: "החזרה לטיוטה" }));
    expect(port.decide).toHaveBeenLastCalledWith("s1", first.key, null);
    expect(await card(first.title).findByText("טיוטה")).toBeInTheDocument();
  });

  it("keeps drafts and rejected findings off the printout", async () => {
    const [first, second] = FINDINGS;
    renderPage(
      service({}, [
        { findingKey: first.key, status: "approved", finalText: null, reviewedAt: "t" },
        { findingKey: second.key, status: "rejected", finalText: null, reviewedAt: "t" },
      ]),
    );
    expect(await screen.findByRole("listitem", { name: first.title })).not.toHaveClass("print:hidden");
    expect(screen.getByRole("listitem", { name: second.title })).toHaveClass("print:hidden");
    expect(screen.getByRole("listitem", { name: FINDINGS[2].title })).toHaveClass("print:hidden");
  });

  it("says so when a decision could not be saved", async () => {
    renderPage(service({ decide: vi.fn(async () => Promise.reject(new MaslekaError("forbidden", "z9"))) }));
    await userEvent.click((await screen.findAllByRole("button", { name: "אישור" }))[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent("z9");
  });

  it("says plainly when the report is gone or cannot be read", async () => {
    renderPage(service({ getSnapshot: vi.fn(async () => null) }));
    expect(await screen.findByRole("alert")).toHaveTextContent("הדוח לא נמצא");
  });
});
