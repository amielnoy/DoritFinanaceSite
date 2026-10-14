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

describe("<MaslekaAnalysis /> — publishing to the client's area (phase 4)", () => {
  const [first] = FINDINGS;
  const approvedFirst: FindingReview[] = [{ findingKey: first.key, status: "approved", finalText: null, reviewedAt: "t" }];

  function renderWith(port: MaslekaPort, confirm: (m: string) => boolean = () => true) {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <MaslekaAnalysis service={port} snapshotId="s1" confirm={confirm} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  const publishing = (over: Partial<MaslekaPort> = {}, reviews = approvedFirst, stored: Record<string, unknown> = {}) =>
    service(
      {
        getSnapshot: vi.fn(async () => ({ ...STORED, clientEmail: null, publishedAt: null, ...stored })),
        publish: vi.fn(async () => {}),
        unpublish: vi.fn(async () => {}),
        markAnswersSeen: vi.fn(async () => {}),
        listPublishedItems: vi.fn(async () => []),
        ...over,
      },
      reviews,
    );

  it("changes an approved recommendation's priority, keeping its wording", async () => {
    const port = publishing();
    renderWith(port);
    await screen.findByRole("listitem", { name: first.title });
    await userEvent.selectOptions(card(first.title).getByRole("combobox", { name: "עדיפות" }), "important");
    expect(port.decide).toHaveBeenCalledWith("s1", first.key, { status: "approved", finalText: null, priority: "important" });
  });

  it("adds a recommendation of Dorit's own, approved, with its title and priority", async () => {
    const port = publishing();
    renderWith(port);
    const form = within(await screen.findByRole("form", { name: "הוספת המלצה" }));
    await userEvent.type(form.getByLabelText("כותרת"), "עדכון מוטבים");
    await userEvent.selectOptions(form.getByLabelText("עדיפות"), "important");
    await userEvent.type(form.getByLabelText("הסבר ללקוח"), "נעדכן את המוטבים בקרן.");
    await userEvent.click(form.getByRole("button", { name: "הוספה ואישור" }));
    expect(port.decide).toHaveBeenCalledWith("s1", expect.stringMatching(/^custom:/), {
      status: "approved", finalText: "נעדכן את המוטבים בקרן.", title: "עדכון מוטבים", priority: "important",
    });
    expect(await screen.findByRole("listitem", { name: "עדכון מוטבים" })).toBeInTheDocument();
  });

  it("previews exactly what the client will see, with nothing sent", async () => {
    const port = publishing();
    renderWith(port);
    await userEvent.click(await screen.findByRole("button", { name: "תצוגה כפי שהלקוח רואה" }));
    const preview = within(screen.getByRole("region", { name: "תצוגה כפי שהלקוח רואה" }));
    expect(preview.getByRole("heading", { name: first.title })).toBeInTheDocument();
    expect(preview.getByRole("button", { name: "כן, לטפל בזה" })).toBeDisabled();
    expect(port.publish).not.toHaveBeenCalled();
  });

  it("publishes the approved recommendations to the client's address", async () => {
    const port = publishing();
    renderWith(port);
    const publish = await screen.findByRole("button", { name: "פרסום לאזור האישי" });
    expect(publish).toBeDisabled();
    await userEvent.type(screen.getByLabelText("המייל שהלקוח מתחבר איתו לאתר"), "ronit@example.com");
    await userEvent.click(publish);
    expect(port.publish).toHaveBeenCalledWith("s1", "ronit@example.com", [
      { title: first.title, body: first.body, priority: first.severity === "high" ? "important" : "check" },
    ]);
  });

  it("asks before a republish replaces what the client sees", async () => {
    const port = publishing({}, approvedFirst, { clientEmail: "ronit@example.com", publishedAt: "2026-10-14T10:00:00Z" });
    const confirm = vi.fn(() => false);
    renderWith(port, confirm);
    await userEvent.click(await screen.findByRole("button", { name: "פרסום מחדש" }));
    expect(confirm).toHaveBeenCalled();
    expect(port.publish).not.toHaveBeenCalled();
  });

  it("shows the client's answers, the new ones counted, and marks them read", async () => {
    const port = publishing(
      {
        listPublishedItems: vi.fn(async () => [
          { id: "i1", position: 0, title: first.title, body: "b", priority: "check" as const, clientStatus: "question" as const, clientNote: "מה זה אומר?", clientUpdatedAt: "u", staffSeenAt: null },
          { id: "i2", position: 1, title: "אחר", body: "b", priority: "check" as const, clientStatus: "open" as const, clientNote: null, clientUpdatedAt: null, staffSeenAt: null },
        ]),
      },
      approvedFirst,
      { clientEmail: "ronit@example.com", publishedAt: "2026-10-14T10:00:00Z" },
    );
    renderWith(port);
    expect(await screen.findByText("1 חדשות")).toBeInTheDocument();
    expect(screen.getByText("מה זה אומר?")).toBeInTheDocument();
    expect(screen.queryByText("אחר")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "סימון כנקרא" }));
    expect(port.markAnswersSeen).toHaveBeenCalledWith("s1");
    await userEvent.click(screen.getByRole("button", { name: "הסרה מהאזור האישי" }));
    expect(port.unpublish).toHaveBeenCalledWith("s1");
  });
});
