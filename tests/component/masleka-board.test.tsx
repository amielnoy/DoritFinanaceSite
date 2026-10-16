// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

import MaslekaBoard, { REVEAL_MS, waitingLine, type MaslekaBoardProps } from "@/pages/MaslekaBoard";
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
    listSnapshots: vi.fn(async () => []),
    getSnapshot: vi.fn(async () => null),
    listReviews: vi.fn(async () => []),
    decide: vi.fn(async () => {}),
    ...over,
  };
}

/** `stage` opens the board at `?stage=<stage>`; without it, "לטיפול עכשיו". */
function renderBoard(props: MaslekaBoardProps & { stage?: string }) {
  const { stage, ...rest } = props;
  props = rest;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[stage ? `/admin/masleka?stage=${stage}` : "/admin/masleka"]}>
        <MaslekaBoard now={() => NOW} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

/** The board's one list. */
const list = () => within(screen.getByRole("list", { name: "בקשות" }));
/** One request's row. */
const rowOf = (name: string) => within(screen.getByText(name).closest("li")!);
/**
 * A waiting client's guided submit: their drawer, opened from the row's
 * "להגשה" — or the one already open for them. Another client's open drawer is
 * closed first (Esc), as a person would.
 */
const card = (name: string) => {
  const open = screen.queryByRole("dialog");
  if (open && within(open).queryByRole("heading", { name })) return within(open);
  if (open) fireEvent.keyDown(open, { key: "Escape" });
  fireEvent.click(within(screen.getByText(name).closest("li")!).getByRole("button", { name: "להגשה" }));
  return within(screen.getByRole("dialog", { name }));
};
/** The header's "+ בקשה חדשה": the new-request drawer. */
async function openNew() {
  await userEvent.click(screen.getByRole("button", { name: "בקשה חדשה" }));
  return within(await screen.findByRole("dialog", { name: "בקשה חדשה" }));
}
/** Once the list is in: that client's guided submit, open. */
async function openWaiting(name = "רונית מזרחי") {
  await screen.findByText(name);
  return card(name);
}

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

describe("<MaslekaBoard /> — the list", () => {
  it("shows each row's step, name, stage and reason, with one action", async () => {
    renderBoard({ service: service(), clipboard: null });
    const ronit = within((await screen.findByText("רונית מזרחי")).closest("li")!);
    expect(ronit.getByText("מוכן להגשה")).toBeInTheDocument();
    expect(ronit.getByText(/^קוד האימות התקבל .* · ת״ז מסתיימת ב־0018$/)).toBeInTheDocument();
    expect(ronit.getByRole("button", { name: "להגשה" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /1 · ממתין ללקוח/ }));
    expect(rowOf("אורי לוי").getByRole("button", { name: "קישור חדש" })).toBeInTheDocument();
    expect(rowOf("אורי לוי").getByText("קיבל/ה קישור לפני 2 ימים ועוד לא מילא/ה")).toBeInTheDocument();
  });

  it("says when the files should be ready, and how long the clearinghouse keeps them", async () => {
    renderBoard({ service: service(), clipboard: null, stage: "submitted" });
    const yael = within((await screen.findByText("יעל כהן")).closest("li")!);
    expect(yael.getByText(/^הוגש .* · יהיה מוכן בעוד כ־3–4 שעות$/)).toBeInTheDocument();
    expect(yael.getByText("אין צורך בפעולה")).toBeInTheDocument();
    const dan = rowOf("דן לוי");
    expect(dan.getByText("מוכן להורדה · יום אחד עד מחיקה במסלקה")).toBeInTheDocument();
    expect(dan.getByText("דחוף")).toBeInTheDocument();
    const download = dan.getByRole("link", { name: "להורדה במסלקה" });
    expect(download).toHaveAttribute("href", "https://www.swiftness.co.il/");
    expect(download).toHaveAttribute("target", "_blank");
    expect(download.getAttribute("rel")).toMatch(/noopener/);
    expect(download.getAttribute("rel")).toMatch(/noreferrer/);
  });

  it("finds a client by name as you type, and says so when nothing is there", async () => {
    renderBoard({ service: service(), clipboard: null });
    await screen.findByText("רונית מזרחי");
    await userEvent.type(screen.getByRole("searchbox", { name: "חיפוש לקוח" }), "לוי");
    expect(list().getByText("דן לוי")).toBeInTheDocument();
    expect(list().queryByText("רונית מזרחי")).not.toBeInTheDocument();
    // The stage on show: אורי לוי, invited two days ago, is in stage 1, not in "now".
    expect(list().queryByText("אורי לוי")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /1 · ממתין ללקוח/ }));
    expect(list().getByText("אורי לוי")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox", { name: "חיפוש לקוח" }), "זזז");
    expect(screen.getByText("אין כאן כלום כרגע. בקשות חדשות יופיעו כאן לבד.")).toBeInTheDocument();
  });

  it("reports a list that failed to load", async () => {
    renderBoard({ service: service({ list: vi.fn(async () => Promise.reject(new MaslekaError("failed"))) }), clipboard: null });
    expect(await screen.findByText("לא הצלחנו לטעון את הבקשות. רעננו את הדף.")).toBeInTheDocument();
  });
});

/** The address the board keeps its stage in. */
function Where() {
  return <output data-testid="where">{useLocation().search}</output>;
}

describe("<MaslekaBoard /> — the header", () => {
  it("names the board, says how many requests wait today, and links to how it works", async () => {
    renderBoard({ service: service(), clipboard: null });
    expect(screen.getByRole("heading", { level: 1, name: "מסלקה" })).toBeInTheDocument();
    expect(screen.getByText("טיפול שוטף")).toBeInTheDocument();
    expect(await screen.findByText("2 בקשות מחכות לך היום. שאר הבקשות מתקדמות לבד.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "איך זה עובד?" })).toHaveAttribute("href", "#masleka-how");
  });

  it("words the count for none and for one", () => {
    expect(waitingLine(0)).toBe("אין בקשות שמחכות לך היום. שאר הבקשות מתקדמות לבד.");
    expect(waitingLine(1)).toBe("בקשה אחת מחכה לך היום. שאר הבקשות מתקדמות לבד.");
    expect(waitingLine(7)).toBe("7 בקשות מחכות לך היום. שאר הבקשות מתקדמות לבד.");
  });

  it("keeps the new-request form off the page until '+ בקשה חדשה' opens its drawer", async () => {
    renderBoard({ service: service(), clipboard: null });
    await screen.findByText("רונית מזרחי");
    expect(screen.queryByLabelText("שם הלקוח")).not.toBeInTheDocument();
    const drawer = await openNew();
    expect(drawer.getByLabelText("שם הלקוח")).toBeInTheDocument();
  });

  it("is a modal dialog that the X and Esc close, giving the focus back to the button", async () => {
    renderBoard({ service: service(), clipboard: null });
    await screen.findByText("רונית מזרחי");
    const opener = screen.getByRole("button", { name: "בקשה חדשה" });
    await openNew();
    const dialog = screen.getByRole("dialog", { name: "בקשה חדשה" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.click(within(dialog).getByRole("button", { name: "סגירה" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
    await openNew();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe("<MaslekaBoard /> — the stage bar", () => {
  const bar = () => within(screen.getByRole("navigation", { name: "שלבי הבקשה" }));
  const stageButton = (name: RegExp) => bar().getByRole("button", { name });

  it("opens on 'לטיפול עכשיו': what needs action, urgent first, with each stage's count and hint", async () => {
    renderBoard({ service: service(), clipboard: null });
    await screen.findByText("רונית מזרחי");
    expect(stageButton(/לטיפול עכשיו/)).toHaveAttribute("aria-pressed", "true");
    expect(stageButton(/לטיפול עכשיו/)).toHaveTextContent("2");
    expect(stageButton(/1 · ממתין ללקוח/)).toHaveTextContent("1");
    expect(stageButton(/1 · ממתין ללקוח/)).toHaveTextContent("קיבלו קישור, טרם מילאו");
    expect(stageButton(/2 · מוכן להגשה/)).toHaveTextContent("קוד האימות התקבל");
    expect(stageButton(/3 · הוגש במסלקה/)).toHaveTextContent("2");
    expect(stageButton(/3 · הוגש במסלקה/)).toHaveTextContent("ממתין להורדה");
    expect(stageButton(/4 · הושלם/)).toHaveTextContent("0");
    expect(stageButton(/4 · הושלם/)).toHaveTextContent("ניתוח והמלצות");
    // דן's download is deleted tomorrow: first. יעל's is still being prepared, אורי was invited two days ago: neither.
    expect(list().getAllByRole("listitem").map((li) => within(li).getByText(/^(דן לוי|רונית מזרחי)$/).textContent)).toEqual(["דן לוי", "רונית מזרחי"]);
    expect(list().queryByText("יעל כהן")).not.toBeInTheDocument();
    expect(list().queryByText("אורי לוי")).not.toBeInTheDocument();
  });

  it("shows one stage when chosen, and keeps it in ?stage= so a refresh opens on it", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const svc = service();
    const board = (entry: string) => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[entry]}>
          <MaslekaBoard now={() => NOW} service={svc} clipboard={null} />
          <Where />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const view = render(board("/admin/masleka"));
    await screen.findByText("רונית מזרחי");
    await userEvent.click(stageButton(/3 · הוגש במסלקה/));
    expect(stageButton(/3 · הוגש במסלקה/)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("where")).toHaveTextContent("?stage=submitted");
    expect(list().getByText("יעל כהן")).toBeInTheDocument();
    expect(list().queryByText("רונית מזרחי")).not.toBeInTheDocument();
    view.unmount();
    render(board("/admin/masleka?stage=submitted"));
    expect(await list().findByText("יעל כהן")).toBeInTheDocument();
    expect(stageButton(/3 · הוגש במסלקה/)).toHaveAttribute("aria-pressed", "true");
    // Back to "now": the parameter goes.
    await userEvent.click(stageButton(/לטיפול עכשיו/));
    expect(screen.getByTestId("where")).toHaveTextContent(/^$/);
  });

  it("opens on 'now' for a stage it does not know", async () => {
    renderBoard({ service: service(), clipboard: null, stage: "everything" });
    await screen.findByText("רונית מזרחי");
    expect(stageButton(/לטיפול עכשיו/)).toHaveAttribute("aria-pressed", "true");
  });

  it("hides a revealed value when the stage changes under an open drawer (the browser's back and forward)", async () => {
    // Copied to the clipboard: an outside click leaves the mark, so only the stage change can take it.
    let navigate: NavigateFunction = () => undefined;
    function Navigator() {
      navigate = useNavigate();
      return null;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/admin/masleka"]}>
          <MaslekaBoard now={() => NOW} service={service()} clipboard={{ writeText: vi.fn(async () => {}) }} />
          <Navigator />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const drawer = await openWaiting();
    await userEvent.click(drawer.getByRole("button", { name: "העתק ת״ז" }));
    expect(await drawer.findByRole("button", { name: "הועתק ✓ — הדביקו במסלקה" })).toBeInTheDocument();
    await userEvent.click(drawer.getByRole("heading", { name: "רונית מזרחי" }));
    expect(drawer.getByRole("button", { name: "הועתק ✓ — הדביקו במסלקה" })).toBeInTheDocument();
    act(() => navigate("/admin/masleka?stage=code_received"));
    expect(drawer.queryByRole("button", { name: /הועתק/ })).not.toBeInTheDocument();
  });

});

describe("<MaslekaBoard /> — the guided submit", () => {
  const stepOf = (drawer: ReturnType<typeof card>, title: string) => drawer.getByText(title).closest("li")!;

  it("opens from the row, named for the client, with when the code came and the ID's last digits", async () => {
    renderBoard({ service: service(), clipboard: null });
    const drawer = await openWaiting();
    const dialog = screen.getByRole("dialog", { name: "רונית מזרחי" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/^קוד האימות התקבל .* · ת״ז מסתיימת ב־0018$/);
    expect(drawer.getAllByRole("listitem")).toHaveLength(4);
  });

  it("walks the four steps: the current one marked, each ticked as it is done", async () => {
    renderBoard({ service: service(), clipboard: { writeText: vi.fn(async () => {}) } });
    const drawer = await openWaiting();
    const portal = stepOf(drawer, "פותחים את פורטל המסלקה");
    expect(portal).toHaveAttribute("aria-current", "step");
    const link = within(portal).getByRole("link", { name: "פתיחת פורטל המסלקה ↗" });
    expect(link).toHaveAttribute("href", "https://www.swiftness.co.il/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    link.addEventListener("click", (e) => e.preventDefault());
    await userEvent.click(link);
    expect(within(portal).getByText("(בוצע)")).toBeInTheDocument();
    expect(stepOf(drawer, "מעתיקים את מספר הזהות")).toHaveAttribute("aria-current", "step");
    await userEvent.click(drawer.getByRole("button", { name: "העתק ת״ז" }));
    expect(await drawer.findByRole("button", { name: "הועתק ✓ — הדביקו במסלקה" })).toBeInTheDocument();
    expect(stepOf(drawer, "מעתיקים את קוד האימות")).toHaveAttribute("aria-current", "step");
    await userEvent.click(drawer.getByRole("button", { name: "העתק קוד" }));
    await waitFor(() => expect(stepOf(drawer, "סיימתם להגיש?")).toHaveAttribute("aria-current", "step"));
    // The ID's step stays ticked after its value has gone from the screen.
    expect(within(stepOf(drawer, "מעתיקים את מספר הזהות")).getByText("(בוצע)")).toBeInTheDocument();
  });

  it("hides a revealed value when the drawer closes, and opened again it starts clean", async () => {
    // Copied to the clipboard: the click that reopens the drawer is no "outside click" for it, so only the close can take it.
    renderBoard({ service: service(), clipboard: { writeText: vi.fn(async () => {}) } });
    const drawer = await openWaiting();
    await userEvent.click(drawer.getByRole("button", { name: "העתק ת״ז" }));
    expect(await drawer.findByRole("button", { name: "הועתק ✓ — הדביקו במסלקה" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const again = card("רונית מזרחי");
    expect(again.queryByRole("button", { name: /הועתק/ })).not.toBeInTheDocument();
    expect(stepOf(again, "פותחים את פורטל המסלקה")).toHaveAttribute("aria-current", "step");
  });

  it("hides a value copied by hand when the drawer closes", async () => {
    renderBoard({ service: service(), clipboard: null });
    const drawer = await openWaiting();
    await userEvent.click(drawer.getByRole("button", { name: "העתק ת״ז" }));
    expect(await drawer.findByDisplayValue("000000018")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue("000000018")).not.toBeInTheDocument();
  });

  it("drops a value still on its way when the drawer closes: never copied, never shown", async () => {
    const slow = deferred<string>();
    const clipboard = { writeText: vi.fn(async () => {}) };
    renderBoard({ service: service({ reveal: vi.fn(async () => slow.promise) }), clipboard });
    const drawer = await openWaiting();
    await userEvent.click(drawer.getByRole("button", { name: "העתק ת״ז" }));
    await userEvent.click(drawer.getByRole("button", { name: "סגירה" }));
    await act(async () => {
      slow.resolve("000000018");
      await slow.promise;
    });
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(card("רונית מזרחי").queryByRole("button", { name: /הועתק/ })).not.toBeInTheDocument();
  });

  it("keeps the inline question to the drawer: no browser confirm", async () => {
    const confirm = vi.spyOn(window, "confirm");
    renderBoard({ service: service(), clipboard: null });
    const drawer = await openWaiting();
    await userEvent.click(drawer.getByRole("button", { name: "סימון כהוגש" }));
    await userEvent.click(drawer.getByRole("button", { name: "כן, הגשתי" }));
    expect(await drawer.findByText("הוגש. מספר הזהות וקוד האימות נמחקו.")).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("<MaslekaBoard /> — copying", () => {
  it("copies the ID to the clipboard, revealing it only on the click", async () => {
    const svc = service();
    const clipboard = { writeText: vi.fn(async () => {}) };
    renderBoard({ service: svc, clipboard });
    const waiting = (await openWaiting());
    await waiting.findByText("רונית מזרחי");
    expect(svc.reveal).not.toHaveBeenCalled();
    await userEvent.click(waiting.getByRole("button", { name: "העתק ת״ז" }));
    expect(svc.reveal).toHaveBeenCalledWith("r2", "id");
    expect(clipboard.writeText).toHaveBeenCalledWith("000000018");
    expect(await waiting.findByRole("button", { name: "הועתק ✓ — הדביקו במסלקה" })).toBeInTheDocument();
  });

  it("falls back to a selected field when there is no clipboard", async () => {
    renderBoard({ service: service(), clipboard: null });
    const waiting = (await openWaiting());
    await userEvent.click(await waiting.findByRole("button", { name: "העתק קוד" }));
    const field = await waiting.findByRole("textbox", { name: "הקוד של רונית מזרחי" });
    expect(field).toHaveValue("AB12-CD34");
    expect(field).toHaveAttribute("readonly");
    expect(waiting.getByText(/העתק ידנית/)).toBeInTheDocument();
  });

  it("falls back when the browser refuses the clipboard", async () => {
    const clipboard = { writeText: vi.fn(async () => Promise.reject(new DOMException("denied", "NotAllowedError"))) };
    renderBoard({ service: service(), clipboard });
    const waiting = (await openWaiting());
    await userEvent.click(await waiting.findByRole("button", { name: "העתק ת״ז" }));
    expect(await waiting.findByRole("textbox", { name: "מספר הזהות של רונית מזרחי" })).toHaveValue("000000018");
  });

  it("hides a manually-copied value when asked", async () => {
    renderBoard({ service: service(), clipboard: null });
    const waiting = (await openWaiting());
    await userEvent.click(await waiting.findByRole("button", { name: "העתק ת״ז" }));
    await userEvent.click(await waiting.findByRole("button", { name: "הסתר" }));
    expect(waiting.queryByDisplayValue("000000018")).not.toBeInTheDocument();
  });

  it("clears a manually-copied value after a minute", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderBoard({ service: service(), clipboard: null });
    const waiting = (await openWaiting());
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
    const waiting = (await openWaiting());
    await userEvent.click(await waiting.findByRole("button", { name: "העתק ת״ז" }));
    const field = await waiting.findByDisplayValue("000000018");
    await userEvent.click(field);
    expect(waiting.getByDisplayValue("000000018")).toBeInTheDocument();
    // Anywhere else — here the drawer's own heading.
    await userEvent.click(waiting.getByRole("heading", { name: "רונית מזרחי" }));
    expect(waiting.queryByDisplayValue("000000018")).not.toBeInTheDocument();
  });

  it("shows one value at a time: revealing another client's clears the first", async () => {
    renderBoard({ service: service({ list: vi.fn(async () => TWO_WAITING) }), clipboard: null });
    await screen.findByText("שרה אברהם");
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
    await screen.findByText("שרה אברהם");
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
    await userEvent.click(await (await openWaiting()).findByRole("button", { name: "העתק ת״ז" }));
    unmount();
    await act(async () => {
      slow.resolve("000000018");
      await slow.promise;
    });
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("forgets a shown value once its row leaves the stage, so it never comes back with the row", async () => {
    const gone = ROWS.map((r) => (r.id === "r2" ? { ...r, status: "submitted" as const, submittedAt: iso(0) } : r));
    const lists = vi.fn().mockResolvedValueOnce(ROWS).mockResolvedValueOnce(gone).mockResolvedValue(ROWS);
    const { client } = renderBoard({ service: service({ list: lists }), clipboard: null });
    await userEvent.click((await openWaiting()).getByRole("button", { name: "העתק ת״ז" }));
    expect(await screen.findByDisplayValue("000000018")).toBeInTheDocument();
    await act(async () => {
      await client.invalidateQueries();
    });
    // Submitted a moment ago: off "now" altogether.
    await waitFor(() => expect(screen.queryByText("רונית מזרחי")).not.toBeInTheDocument());
    await act(async () => {
      await client.invalidateQueries();
    });
    await screen.findByText("רונית מזרחי");
    card("רונית מזרחי");
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
      const waiting = (await openWaiting());
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
    const lists = vi.fn().mockResolvedValueOnce(ROWS).mockResolvedValueOnce(gone).mockResolvedValue(ROWS);
    const { client } = renderBoard({ service: service({ list: lists, reveal: vi.fn(async () => slow.promise) }), clipboard });
    await userEvent.click((await openWaiting()).getByRole("button", { name: "העתק ת״ז" }));
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() => expect(screen.queryByText("רונית מזרחי")).not.toBeInTheDocument());
    await act(async () => {
      slow.resolve("000000018");
      await slow.promise;
    });
    await act(async () => {
      await client.invalidateQueries();
    });
    await screen.findByText("רונית מזרחי");
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("000000018")).not.toBeInTheDocument();
    expect(card("רונית מזרחי").queryByRole("button", { name: "הועתק ✓ — הדביקו במסלקה" })).not.toBeInTheDocument();
  });
});

describe("<MaslekaBoard /> — acting", () => {
  it("asks inline before the wipe: 'עוד לא' sends nothing, 'כן, הגשתי' wipes and says what happens next", async () => {
    const svc = service();
    renderBoard({ service: svc, clipboard: null });
    const drawer = await openWaiting();
    await userEvent.click(drawer.getByRole("button", { name: "סימון כהוגש" }));
    const ask = drawer.getByRole("alert");
    expect(ask).toHaveTextContent("לסמן את הבקשה של רונית מזרחי כהוגשה?");
    expect(ask).toHaveTextContent("לא תוכלו להעתיק שוב את מספר הזהות או את קוד האימות.");
    await userEvent.click(within(ask).getByRole("button", { name: "עוד לא" }));
    expect(drawer.queryByRole("alert")).not.toBeInTheDocument();
    expect(svc.markSubmitted).not.toHaveBeenCalled();
    await userEvent.click(drawer.getByRole("button", { name: "סימון כהוגש" }));
    await userEvent.click(drawer.getByRole("button", { name: "כן, הגשתי" }));
    expect(svc.markSubmitted).toHaveBeenCalledWith("r2");
    expect(await drawer.findByText("הוגש. מספר הזהות וקוד האימות נמחקו.")).toBeInTheDocument();
    expect(drawer.getByText("הקבצים יהיו מוכנים להורדה בעוד כ־3–4 שעות. נזכיר לך במייל.")).toBeInTheDocument();
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
    await userEvent.click(drawer.getByRole("button", { name: "חזרה ללוח" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows a second הגשתי as already submitted, not as an error, and refreshes the row", async () => {
    const svc = service({ markSubmitted: vi.fn(async () => Promise.reject(new MaslekaError("already_submitted", "z2"))) });
    renderBoard({ service: svc, clipboard: null });
    const drawer = await openWaiting();
    await userEvent.click(drawer.getByRole("button", { name: "סימון כהוגש" }));
    await userEvent.click(drawer.getByRole("button", { name: "כן, הגשתי" }));
    expect(await screen.findByRole("status")).toHaveTextContent("כבר סומן כהוגש");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
  });

  it("tells a staff member whose access was removed", async () => {
    renderBoard({
      service: service({ reveal: vi.fn(async () => Promise.reject(new MaslekaError("forbidden", "z1"))) }),
      clipboard: null,
    });
    await userEvent.click(await (await openWaiting()).findByRole("button", { name: "העתק ת״ז" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ההרשאה שלך הוסרה");
  });

  it("words a failed list or a refused request in the staff vocabulary", async () => {
    const svc = service({
      list: vi.fn(async () => Promise.reject(new MaslekaError("forbidden"))),
      create: vi.fn(async () => Promise.reject(new MaslekaError("invalid_email", "z3"))),
    });
    renderBoard({ service: svc, clipboard: null });
    expect(await screen.findByText("ההרשאה שלך הוסרה")).toBeInTheDocument();
    await openNew();
    await userEvent.type(screen.getByLabelText("שם הלקוח"), "משה כהן");
    await userEvent.click(screen.getByRole("button", { name: "צור בקשה" }));
    expect(await screen.findByText(/כתובת הדוא״ל אינה תקינה/)).toBeInTheDocument();
  });

  it("links to the clearinghouse portal in a new tab without a referrer", async () => {
    renderBoard({ service: service(), clipboard: null });
    const link = await (await openWaiting()).findByRole("link", { name: "פתיחת פורטל המסלקה ↗" });
    expect(link).toHaveAttribute("href", "https://www.swiftness.co.il/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toMatch(/noopener/);
    expect(link.getAttribute("rel")).toMatch(/noreferrer/);
  });

  it("creates a hand-made request and shows its link to copy", async () => {
    const svc = service();
    renderBoard({ service: svc, clipboard: null });
    await openNew();
    await userEvent.type(screen.getByLabelText("שם הלקוח"), "משה כהן");
    await userEvent.type(screen.getByLabelText("מייל (לא חובה)"), "moshe@example.com");
    await userEvent.click(screen.getByRole("button", { name: "צור בקשה" }));
    expect(svc.create).toHaveBeenCalledWith({ clientName: "משה כהן", contactEmail: "moshe@example.com", sendInvite: true });
    expect(await screen.findByDisplayValue(LINK)).toBeInTheDocument();
    expect(screen.getByText(/הקישור נשלח במייל ללקוח/)).toBeInTheDocument();
    const open = screen.getByRole("link", { name: "פתיחת הקישור" });
    expect(open).toHaveAttribute("href", LINK);
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("makes one הגשתי call for a double click that lands before the button is disabled", async () => {
    const wipe = deferred<void>();
    const svc = service({ markSubmitted: vi.fn(() => wipe.promise) });
    renderBoard({ service: svc, clipboard: null });
    const drawer = await openWaiting();
    await userEvent.click(drawer.getByRole("button", { name: "סימון כהוגש" }));
    const button = drawer.getByRole("button", { name: "כן, הגשתי" });
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
    const waiting = (await openWaiting());
    await userEvent.click(await waiting.findByRole("button", { name: "העתק ת״ז" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("השירות אינו זמין כרגע");
    await userEvent.click(waiting.getByRole("button", { name: "העתק ת״ז" }));
    expect(await waiting.findByRole("button", { name: "הועתק ✓ — הדביקו במסלקה" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("takes a row's copied mark off at once when its הגשתי succeeds, even if the refetch fails", async () => {
    const list = vi.fn().mockResolvedValueOnce(ROWS).mockRejectedValue(new MaslekaError("failed"));
    const svc = service({ list });
    const clipboard = { writeText: vi.fn(async () => {}) };
    renderBoard({ service: svc, clipboard });
    const drawer = await openWaiting();
    await userEvent.click(drawer.getByRole("button", { name: "העתק ת״ז" }));
    expect(await drawer.findByRole("button", { name: "הועתק ✓ — הדביקו במסלקה" })).toBeInTheDocument();
    await userEvent.click(drawer.getByRole("button", { name: "סימון כהוגש" }));
    await userEvent.click(drawer.getByRole("button", { name: "כן, הגשתי" }));
    await waitFor(() => expect(svc.markSubmitted).toHaveBeenCalledWith("r2"));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(await drawer.findByText("הוגש. מספר הזהות וקוד האימות נמחקו.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /הועתק/ })).not.toBeInTheDocument();
    // The refetch failed, so the row is still on the list as it was: opened again, it starts clean.
    await userEvent.click(drawer.getByRole("button", { name: "חזרה ללוח" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const again = card("רונית מזרחי");
    expect(again.queryByRole("button", { name: /הועתק/ })).not.toBeInTheDocument();
    expect(again.getByRole("button", { name: "העתק ת״ז" })).toBeInTheDocument();
  });

  it("says a blank name is not valid, and sends nothing", async () => {
    const svc = service();
    renderBoard({ service: svc, clipboard: null });
    const drawer = await openNew();
    await userEvent.type(screen.getByLabelText("שם הלקוח"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "צור בקשה" }));
    expect(await drawer.findByRole("alert")).toHaveTextContent("השם אינו תקין");
    expect(svc.create).not.toHaveBeenCalled();
  });

  it("says so when the invitation e-mail was asked for but not sent", async () => {
    const svc = service({ create: vi.fn(async () => ({ requestId: "r9", link: LINK, invited: false })) });
    renderBoard({ service: svc, clipboard: null });
    await openNew();
    await userEvent.type(screen.getByLabelText("שם הלקוח"), "משה כהן");
    await userEvent.type(screen.getByLabelText("מייל (לא חובה)"), "moshe@example.com");
    await userEvent.click(screen.getByRole("button", { name: "צור בקשה" }));
    expect(await screen.findByDisplayValue(LINK)).toBeInTheDocument();
    expect(screen.getByText(/המייל ללקוח לא נשלח/)).toBeInTheDocument();
    expect(screen.queryByText(/הקישור נשלח במייל ללקוח/)).not.toBeInTheDocument();
  });

  it("links a completed request to its analysis, and lists every stored report", async () => {
    const done = row({ id: "r7", clientName: "אורי לוי", status: "completed", completedAt: iso(-HOUR) });
    const svc = service({
      list: vi.fn(async () => [...ROWS, done]),
      listSnapshots: vi.fn(async () => [
        { id: "s7", requestId: "r7", clientName: "אורי לוי", takenAt: iso(-2 * HOUR) },
        { id: "s8", requestId: null, clientName: "לקוח מהטלפון", takenAt: iso(-3 * HOUR) },
      ]),
    });
    renderBoard({ service: svc, clipboard: null, stage: "completed" });
    expect(await screen.findByRole("link", { name: "לניתוח" })).toHaveAttribute("href", "/admin/masleka/analysis/s7");
    const analyses = within(screen.getByRole("region", { name: "ניתוחים" }));
    expect(analyses.getByRole("link", { name: "לקוח מהטלפון" })).toHaveAttribute("href", "/admin/masleka/analysis/s8");
  });

  it("keeps the board working when the reports cannot be read", async () => {
    renderBoard({ service: service({ listSnapshots: vi.fn(async () => Promise.reject(new Error("no table"))) }), clipboard: null });
    expect(await screen.findByText("לא הצלחנו לטעון את הניתוחים.")).toBeInTheDocument();
    expect(await (await openWaiting()).findByRole("button", { name: "העתק ת״ז" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("issues a fresh link for an invited client", async () => {
    const svc = service();
    renderBoard({ service: svc, clipboard: null, stage: "invited" });
    await screen.findByText("אורי לוי");
    await userEvent.click(rowOf("אורי לוי").getByRole("button", { name: "קישור חדש" }));
    expect(svc.relink).toHaveBeenCalledWith("r1");
    expect(await screen.findByDisplayValue(LINK2)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "פתיחת הקישור" })).toHaveAttribute("href", LINK2);
  });
});
