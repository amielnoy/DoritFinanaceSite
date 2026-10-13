// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

import MaslekaBoard, { REVEAL_MS, type MaslekaBoardProps } from "@/pages/MaslekaBoard";
import { MaslekaError, type MaslekaPort, type MaslekaRequest } from "@/services/ports";

const NOW = new Date("2026-10-13T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (offset: number) => new Date(NOW.getTime() + offset).toISOString();
const LINK = `https://govari-fin.co.il/masleka#t=${"N".repeat(43)}`;
const LINK2 = `https://govari-fin.co.il/masleka#t=${"R".repeat(43)}`;

const row = (over: Partial<MaslekaRequest>): MaslekaRequest => ({
  id: "r", clientName: "לקוח", contactEmail: null, status: "invited", leadId: null, idLast4: null,
  createdAt: iso(-DAY), tokenExpiresAt: null, clientInvitedAt: null, codeReceivedAt: null,
  submittedAt: null, clearinghouseDeletesAt: null, completedAt: null, ...over,
});

const ROWS: MaslekaRequest[] = [
  row({ id: "r1", clientName: "אורי לוי", status: "invited", clientInvitedAt: iso(-2 * DAY) }),
  row({ id: "r2", clientName: "רונית מזרחי", status: "code_received", codeReceivedAt: iso(-HOUR), idLast4: "0018" }),
  row({ id: "r3", clientName: "יעל כהן", status: "submitted", submittedAt: iso(-2 * HOUR), clearinghouseDeletesAt: iso(5 * DAY) }),
  row({ id: "r4", clientName: "דן לוי", status: "submitted", submittedAt: iso(-6 * HOUR), clearinghouseDeletesAt: iso(DAY) }),
];

/** A second client waiting to be submitted, for the one-value-at-a-time cases. */
const TWO_WAITING: MaslekaRequest[] = [
  ...ROWS,
  row({ id: "r5", clientName: "שרה אברהם", status: "code_received", codeReceivedAt: iso(-2 * HOUR), idLast4: "0026" }),
];

function service(over: Partial<MaslekaPort> = {}): MaslekaPort {
  return {
    submitCode: vi.fn(),
    myRole: vi.fn(async () => "staff" as const),
    list: vi.fn(async () => ROWS),
    create: vi.fn(async () => ({ requestId: "r9", link: LINK, invited: true })),
    relink: vi.fn(async () => ({ requestId: "r1", link: LINK2, invited: false })),
    reveal: vi.fn(async (_id: string, field: "id" | "code") => (field === "id" ? "000000018" : "AB12-CD34")),
    markSubmitted: vi.fn(async () => {}),
    ...over,
  };
}

function renderBoard(props: MaslekaBoardProps) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MaslekaBoard now={() => NOW} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

const column = (name: string) => within(screen.getByRole("region", { name }));
const card = (name: string) => within(column("ממתין להגשה").getByText(name).closest("li")!);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("<MaslekaBoard /> — the columns", () => {
  it("lays the requests out by status, with the third column empty until PR B", async () => {
    renderBoard({ service: service(), clipboard: null });
    expect(await column("ממתין להגשה").findByText("רונית מזרחי")).toBeInTheDocument();
    expect(column("הוגש — ממתין להורדה").getByText("יעל כהן")).toBeInTheDocument();
    expect(column("הוגש — ממתין להורדה").getByText("דן לוי")).toBeInTheDocument();
    expect(column("הוזמנו — ממתינים לקוד").getByText("אורי לוי")).toBeInTheDocument();
    expect(column("הושלם").getByText("בקשות יופיעו כאן אחרי שקובצי המסלקה ייקלטו.")).toBeInTheDocument();
  });

  it("says when the files should be ready, and how long the clearinghouse keeps them", async () => {
    renderBoard({ service: service(), clipboard: null });
    const submitted = column("הוגש — ממתין להורדה");
    const yael = within((await submitted.findByText("יעל כהן")).closest("li")!);
    expect(yael.getByText("מוכן בעוד כ־3–4 שעות")).toBeInTheDocument();
    expect(yael.getByText("5 ימים עד מחיקה במסלקה")).toBeInTheDocument();
    const dan = within(submitted.getByText("דן לוי").closest("li")!);
    expect(dan.getByText("מוכן להורדה")).toBeInTheDocument();
    expect(dan.getByText("יום אחד עד מחיקה במסלקה")).toBeInTheDocument();
  });

  it("reports a list that failed to load", async () => {
    renderBoard({ service: service({ list: vi.fn(async () => Promise.reject(new MaslekaError("failed"))) }), clipboard: null });
    expect(await screen.findByText("לא הצלחנו לטעון את הבקשות. רעננו את הדף.")).toBeInTheDocument();
  });
});

describe("<MaslekaBoard /> — copying", () => {
  it("copies the ID to the clipboard, revealing it only on the click", async () => {
    const svc = service();
    const clipboard = { writeText: vi.fn(async () => {}) };
    renderBoard({ service: svc, clipboard });
    const waiting = column("ממתין להגשה");
    await waiting.findByText("רונית מזרחי");
    expect(svc.reveal).not.toHaveBeenCalled();
    await userEvent.click(waiting.getByRole("button", { name: "העתק ת״ז" }));
    expect(svc.reveal).toHaveBeenCalledWith("r2", "id");
    expect(clipboard.writeText).toHaveBeenCalledWith("000000018");
    expect(await waiting.findByRole("button", { name: "הועתק ✓" })).toBeInTheDocument();
  });

  it("falls back to a selected field when there is no clipboard", async () => {
    renderBoard({ service: service(), clipboard: null });
    const waiting = column("ממתין להגשה");
    await userEvent.click(await waiting.findByRole("button", { name: "העתק קוד" }));
    const field = await waiting.findByRole("textbox", { name: "הקוד של רונית מזרחי" });
    expect(field).toHaveValue("AB12-CD34");
    expect(field).toHaveAttribute("readonly");
    expect(waiting.getByText(/העתק ידנית/)).toBeInTheDocument();
  });

  it("falls back when the browser refuses the clipboard", async () => {
    const clipboard = { writeText: vi.fn(async () => Promise.reject(new DOMException("denied", "NotAllowedError"))) };
    renderBoard({ service: service(), clipboard });
    const waiting = column("ממתין להגשה");
    await userEvent.click(await waiting.findByRole("button", { name: "העתק ת״ז" }));
    expect(await waiting.findByRole("textbox", { name: "מספר הזהות של רונית מזרחי" })).toHaveValue("000000018");
  });

  it("hides a manually-copied value when asked", async () => {
    renderBoard({ service: service(), clipboard: null });
    const waiting = column("ממתין להגשה");
    await userEvent.click(await waiting.findByRole("button", { name: "העתק ת״ז" }));
    await userEvent.click(await waiting.findByRole("button", { name: "הסתר" }));
    expect(waiting.queryByDisplayValue("000000018")).not.toBeInTheDocument();
  });

  it("clears a manually-copied value after a minute", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderBoard({ service: service(), clipboard: null });
    const waiting = column("ממתין להגשה");
    await user.click(await waiting.findByRole("button", { name: "העתק ת״ז" }));
    expect(await waiting.findByDisplayValue("000000018")).toBeInTheDocument();
    expect(REVEAL_MS).toBe(60_000);
    act(() => {
      vi.advanceTimersByTime(REVEAL_MS - 1_000);
    });
    expect(waiting.getByDisplayValue("000000018")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(waiting.queryByDisplayValue("000000018")).not.toBeInTheDocument();
  });

  it("clears a manually-copied value on the next click elsewhere, but not on a click in its field", async () => {
    renderBoard({ service: service(), clipboard: null });
    const waiting = column("ממתין להגשה");
    await userEvent.click(await waiting.findByRole("button", { name: "העתק ת״ז" }));
    const field = await waiting.findByDisplayValue("000000018");
    await userEvent.click(field);
    expect(waiting.getByDisplayValue("000000018")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("heading", { name: "מסלקה" }));
    expect(waiting.queryByDisplayValue("000000018")).not.toBeInTheDocument();
  });

  it("shows one value at a time: revealing another client's clears the first", async () => {
    renderBoard({ service: service({ list: vi.fn(async () => TWO_WAITING) }), clipboard: null });
    await column("ממתין להגשה").findByText("שרה אברהם");
    await userEvent.click(card("רונית מזרחי").getByRole("button", { name: "העתק ת״ז" }));
    expect(await card("רונית מזרחי").findByRole("textbox", { name: "מספר הזהות של רונית מזרחי" })).toBeInTheDocument();
    await userEvent.click(card("שרה אברהם").getByRole("button", { name: "העתק קוד" }));
    expect(await card("שרה אברהם").findByRole("textbox", { name: "הקוד של שרה אברהם" })).toBeInTheDocument();
    expect(card("רונית מזרחי").queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("drops a value that arrives after a newer reveal was asked for", async () => {
    const slow = deferred<string>();
    const reveal = vi.fn(async (id: string) => (id === "r2" ? slow.promise : "ZZ99-YY88"));
    renderBoard({ service: service({ list: vi.fn(async () => TWO_WAITING), reveal }), clipboard: null });
    await column("ממתין להגשה").findByText("שרה אברהם");
    await userEvent.click(card("רונית מזרחי").getByRole("button", { name: "העתק ת״ז" }));
    await userEvent.click(card("שרה אברהם").getByRole("button", { name: "העתק קוד" }));
    expect(await card("שרה אברהם").findByDisplayValue("ZZ99-YY88")).toBeInTheDocument();
    await act(async () => {
      slow.resolve("000000018");
      await slow.promise;
    });
    expect(screen.queryByDisplayValue("000000018")).not.toBeInTheDocument();
    expect(card("שרה אברהם").getByDisplayValue("ZZ99-YY88")).toBeInTheDocument();
  });

  it("copies nothing when a value arrives after the board is gone", async () => {
    const slow = deferred<string>();
    const clipboard = { writeText: vi.fn(async () => {}) };
    const { unmount } = renderBoard({ service: service({ reveal: vi.fn(async () => slow.promise) }), clipboard });
    await userEvent.click(await column("ממתין להגשה").findByRole("button", { name: "העתק ת״ז" }));
    unmount();
    await act(async () => {
      slow.resolve("000000018");
      await slow.promise;
    });
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("forgets a shown value once its row leaves the column, so it never comes back with the row", async () => {
    const gone = ROWS.map((r) => (r.id === "r2" ? { ...r, status: "submitted" as const, submittedAt: iso(0) } : r));
    const list = vi.fn().mockResolvedValueOnce(ROWS).mockResolvedValueOnce(gone).mockResolvedValue(ROWS);
    const { client } = renderBoard({ service: service({ list }), clipboard: null });
    const waiting = () => column("ממתין להגשה");
    await userEvent.click(await waiting().findByRole("button", { name: "העתק ת״ז" }));
    expect(await waiting().findByDisplayValue("000000018")).toBeInTheDocument();
    await act(async () => {
      await client.invalidateQueries();
    });
    expect(await waiting().findByText("אין קודים שממתינים להגשה.")).toBeInTheDocument();
    await act(async () => {
      await client.invalidateQueries();
    });
    expect(await waiting().findByText("רונית מזרחי")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("000000018")).not.toBeInTheDocument();
  });

  it("keeps the revealed value out of the query cache, storage, the console and the address", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    // This jsdom build has no Web Storage; give it a recording one for this case.
    const writes: string[] = [];
    const recording = () => ({
      getItem: () => null,
      setItem: (k: string, v: string) => void writes.push(`${k}=${v}`),
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    });
    const names = ["localStorage", "sessionStorage"] as const;
    const originals = names.map((name) => Object.getOwnPropertyDescriptor(window, name));
    for (const name of names) {
      Object.defineProperty(window, name, { value: recording(), configurable: true });
    }
    try {
      const { client } = renderBoard({ service: service(), clipboard: null });
      const waiting = column("ממתין להגשה");
      await userEvent.click(await waiting.findByRole("button", { name: "העתק ת״ז" }));
      expect(await waiting.findByDisplayValue("000000018")).toBeInTheDocument();

      const cached = JSON.stringify([
        client.getQueryCache().getAll().map((q) => q.state),
        client.getMutationCache().getAll().map((m) => m.state),
      ]);
      expect(cached).not.toContain("000000018");
      expect(writes.join("\n")).not.toContain("000000018");
      for (const spy of spies) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain("000000018");
      }
      expect(window.location.href).not.toContain("000000018");
    } finally {
      names.forEach((name, i) => {
        const original = originals[i];
        if (original) Object.defineProperty(window, name, original);
        else delete (window as unknown as Record<string, unknown>)[name];
      });
    }
  });

  it("drops a value still on its way when its row leaves the column", async () => {
    const slow = deferred<string>();
    const clipboard = { writeText: vi.fn(async () => {}) };
    const gone = ROWS.map((r) => (r.id === "r2" ? { ...r, status: "submitted" as const, submittedAt: iso(0) } : r));
    const list = vi.fn().mockResolvedValueOnce(ROWS).mockResolvedValueOnce(gone).mockResolvedValue(ROWS);
    const { client } = renderBoard({ service: service({ list, reveal: vi.fn(async () => slow.promise) }), clipboard });
    await userEvent.click(await column("ממתין להגשה").findByRole("button", { name: "העתק ת״ז" }));
    await act(async () => {
      await client.invalidateQueries();
    });
    expect(await column("ממתין להגשה").findByText("אין קודים שממתינים להגשה.")).toBeInTheDocument();
    await act(async () => {
      slow.resolve("000000018");
      await slow.promise;
    });
    await act(async () => {
      await client.invalidateQueries();
    });
    expect(await column("ממתין להגשה").findByText("רונית מזרחי")).toBeInTheDocument();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("000000018")).not.toBeInTheDocument();
    expect(column("ממתין להגשה").queryByRole("button", { name: "הועתק ✓" })).not.toBeInTheDocument();
  });
});

describe("<MaslekaBoard /> — acting", () => {
  it("wipes on הגשתי only after asking first", async () => {
    const svc = service();
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderBoard({ service: svc, clipboard: null, confirm });
    const button = await column("ממתין להגשה").findByRole("button", { name: "הגשתי" });
    await userEvent.click(button);
    expect(svc.markSubmitted).not.toHaveBeenCalled();
    await userEvent.click(button);
    expect(svc.markSubmitted).toHaveBeenCalledWith("r2");
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
  });

  it("shows a second הגשתי as already submitted, not as an error, and refreshes the row", async () => {
    const svc = service({ markSubmitted: vi.fn(async () => Promise.reject(new MaslekaError("already_submitted", "z2"))) });
    renderBoard({ service: svc, clipboard: null, confirm: () => true });
    await userEvent.click(await column("ממתין להגשה").findByRole("button", { name: "הגשתי" }));
    expect(await screen.findByRole("status")).toHaveTextContent("כבר סומן כהוגש");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
  });

  it("tells a staff member whose access was removed", async () => {
    renderBoard({
      service: service({ reveal: vi.fn(async () => Promise.reject(new MaslekaError("forbidden", "z1"))) }),
      clipboard: null,
    });
    await userEvent.click(await column("ממתין להגשה").findByRole("button", { name: "העתק ת״ז" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ההרשאה שלך הוסרה");
  });

  it("words a failed list or a refused request in the staff vocabulary", async () => {
    const svc = service({
      list: vi.fn(async () => Promise.reject(new MaslekaError("forbidden"))),
      create: vi.fn(async () => Promise.reject(new MaslekaError("invalid_email", "z3"))),
    });
    renderBoard({ service: svc, clipboard: null });
    expect(await screen.findByText("ההרשאה שלך הוסרה")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("שם הלקוח"), "משה כהן");
    await userEvent.click(screen.getByRole("button", { name: "צור בקשה" }));
    expect(await screen.findByText(/כתובת הדוא״ל אינה תקינה/)).toBeInTheDocument();
  });

  it("links to the clearinghouse portal in a new tab without a referrer", async () => {
    renderBoard({ service: service(), clipboard: null });
    const link = await column("ממתין להגשה").findByRole("link", { name: "פתח את המסלקה" });
    expect(link).toHaveAttribute("href", "https://www.swiftness.co.il/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
    expect(link.getAttribute("rel")).toMatch(/noreferrer/);
  });

  it("creates a hand-made request and shows its link to copy", async () => {
    const svc = service();
    renderBoard({ service: svc, clipboard: null });
    await userEvent.type(screen.getByLabelText("שם הלקוח"), "משה כהן");
    await userEvent.type(screen.getByLabelText("מייל (לא חובה)"), "moshe@example.com");
    await userEvent.click(screen.getByRole("button", { name: "צור בקשה" }));
    expect(svc.create).toHaveBeenCalledWith({ clientName: "משה כהן", contactEmail: "moshe@example.com", sendInvite: true });
    expect(await screen.findByDisplayValue(LINK)).toBeInTheDocument();
    expect(screen.getByText(/הקישור נשלח במייל ללקוח/)).toBeInTheDocument();
  });

  it("makes one הגשתי call for a double click that lands before the button is disabled", async () => {
    const wipe = deferred<void>();
    const svc = service({ markSubmitted: vi.fn(() => wipe.promise) });
    renderBoard({ service: svc, clipboard: null, confirm: () => true });
    const button = await column("ממתין להגשה").findByRole("button", { name: "הגשתי" });
    // Both clicks land before React re-renders the button as disabled.
    act(() => {
      button.click();
      button.click();
    });
    await act(async () => {
      wipe.resolve();
      await wipe.promise;
    });
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
    expect(svc.markSubmitted).toHaveBeenCalledTimes(1);
  });

  it("clears an old failure when the next action starts", async () => {
    const reveal = vi
      .fn()
      .mockRejectedValueOnce(new MaslekaError("unavailable", "z4"))
      .mockResolvedValue("000000018");
    const clipboard = { writeText: vi.fn(async () => {}) };
    renderBoard({ service: service({ reveal }), clipboard });
    const waiting = column("ממתין להגשה");
    await userEvent.click(await waiting.findByRole("button", { name: "העתק ת״ז" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("השירות אינו זמין כרגע");
    await userEvent.click(waiting.getByRole("button", { name: "העתק ת״ז" }));
    expect(await waiting.findByRole("button", { name: "הועתק ✓" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("takes a row's copied mark off at once when its הגשתי succeeds, even if the refetch fails", async () => {
    const list = vi.fn().mockResolvedValueOnce(ROWS).mockRejectedValue(new MaslekaError("failed"));
    const svc = service({ list });
    const clipboard = { writeText: vi.fn(async () => {}) };
    renderBoard({ service: svc, clipboard, confirm: () => true });
    const waiting = column("ממתין להגשה");
    await userEvent.click(await waiting.findByRole("button", { name: "העתק ת״ז" }));
    expect(await waiting.findByRole("button", { name: "הועתק ✓" })).toBeInTheDocument();
    await userEvent.click(waiting.getByRole("button", { name: "הגשתי" }));
    await waitFor(() => expect(svc.markSubmitted).toHaveBeenCalledWith("r2"));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(waiting.getByText("רונית מזרחי")).toBeInTheDocument();
    expect(waiting.queryByRole("button", { name: "הועתק ✓" })).not.toBeInTheDocument();
    expect(waiting.getByRole("button", { name: "העתק ת״ז" })).toBeInTheDocument();
  });

  it("says a blank name is not valid, and sends nothing", async () => {
    const svc = service();
    renderBoard({ service: svc, clipboard: null });
    await userEvent.type(screen.getByLabelText("שם הלקוח"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "צור בקשה" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("השם אינו תקין");
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("says so when the invitation e-mail was asked for but not sent", async () => {
    const svc = service({ create: vi.fn(async () => ({ requestId: "r9", link: LINK, invited: false })) });
    renderBoard({ service: svc, clipboard: null });
    await userEvent.type(screen.getByLabelText("שם הלקוח"), "משה כהן");
    await userEvent.type(screen.getByLabelText("מייל (לא חובה)"), "moshe@example.com");
    await userEvent.click(screen.getByRole("button", { name: "צור בקשה" }));
    expect(await screen.findByDisplayValue(LINK)).toBeInTheDocument();
    expect(screen.getByText(/המייל ללקוח לא נשלח/)).toBeInTheDocument();
    expect(screen.queryByText(/הקישור נשלח במייל ללקוח/)).not.toBeInTheDocument();
  });

  it("issues a fresh link for an invited client", async () => {
    const svc = service();
    renderBoard({ service: svc, clipboard: null });
    await userEvent.click(await column("הוזמנו — ממתינים לקוד").findByRole("button", { name: "קישור חדש" }));
    expect(svc.relink).toHaveBeenCalledWith("r1");
    expect(await screen.findByDisplayValue(LINK2)).toBeInTheDocument();
  });
});
