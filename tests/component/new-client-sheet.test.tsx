// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * "הוספה" with VITE_STAFF_CLIENTS: the add sheet's client mode — since when,
 * the service lines, the client notice, turning a matching lead into the
 * client, and the next steps after saving. The port is the fake.
 */

const A1 = "00000000-0000-0000-0000-000000000001";
const h = vi.hoisted(() => ({
  createLead: vi.fn(),
  addMeeting: vi.fn(),
  convertToClient: vi.fn(),
  inviteClient: vi.fn(),
  toast: vi.fn(),
  meetingsStaff: true,
}));
vi.mock("@/services", () => ({
  services: { leadsAdmin: { createLead: h.createLead, addMeeting: h.addMeeting, convertToClient: h.convertToClient, inviteClient: h.inviteClient } },
}));
vi.mock("@/components/ui/use-toast", () => ({ toast: h.toast }));
vi.mock("@/config/meetings", async (original) => ({
  ...(await original<typeof import("@/config/meetings")>()),
  get MEETINGS_STAFF() {
    return h.meetingsStaff;
  },
}));

const { default: NewLeadSheet, MODE_KEY } = await import("@/components/dorit/admin/NewLeadSheet");
const { STAFF_CLIENT_NOTICE } = await import("@/config/staff-clients");

const onClose = vi.fn();
const onCreated = vi.fn();
const onSaved = vi.fn();
const onOpenExisting = vi.fn();
const NOW = new Date("2026-10-26T09:00:00Z");

function show(over: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <NewLeadSheet
        open
        onClose={onClose}
        agencyId={A1}
        canAssign={false}
        assignees={[]}
        onCreated={onCreated}
        onSaved={onSaved}
        onOpenExisting={onOpenExisting}
        canAddClient
        now={NOW}
        {...over}
      />
    </MemoryRouter>,
  );
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const toClient = () => fireEvent.click(screen.getByRole("button", { name: "לקוח/ה" }));
const saveClient = () => screen.getByRole("button", { name: "שמירת לקוח/ה" });

function fillClient() {
  toClient();
  type("שם", "רחל לוי");
  type("טלפון", "052-111 0010");
  type("חודש", "03");
  type("שנה", "2019");
  fireEvent.click(screen.getByRole("button", { name: "פנסיה" }));
  fireEvent.click(screen.getByRole("button", { name: "בריאות וסיעוד" }));
  fireEvent.click(screen.getByLabelText("הלקוח/ה יודע/ת איך ישמשו הפרטים"));
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  h.meetingsStaff = true;
  h.createLead.mockResolvedValue({ leadId: "C1", duplicate: null, noticeSent: null, next: { invite: true, masleka: true } });
  h.convertToClient.mockResolvedValue("OLD1");
  h.inviteClient.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the add sheet's client mode", () => {
  it("has no switch without canAddClient, and is the enquiry sheet as before", () => {
    show({ canAddClient: false });
    expect(screen.queryByRole("button", { name: "לקוח/ה" })).toBeNull();
    expect(screen.getByText("פנייה חדשה")).toBeInTheDocument();
    expect(screen.getByLabelText("מצב")).toBeInTheDocument();
  });

  it("is titled הוספה, and remembers the client mode across openings", () => {
    const first = show();
    expect(screen.getByText("הוספה")).toBeInTheDocument();
    toClient();
    expect(localStorage.getItem(MODE_KEY)).toBe("client");
    first.unmount();
    show();
    expect(screen.getByRole("button", { name: "לקוח/ה" })).toHaveAttribute("aria-pressed", "true");
    expect(saveClient()).toBeInTheDocument();
  });

  it("opens in lead mode when the browser keeps nothing", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    show();
    expect(screen.getByRole("button", { name: "פנייה" })).toHaveAttribute("aria-pressed", "true");
    toClient(); // and choosing still works, unremembered
    expect(saveClient()).toBeInTheDocument();
  });

  it("hides מצב and נושא, and asks since when and the service lines", () => {
    show();
    toClient();
    expect(screen.queryByLabelText("מצב")).toBeNull();
    expect(screen.queryByLabelText("נושא")).toBeNull();
    expect(screen.getByLabelText("חודש")).toBeInTheDocument();
    expect(screen.getByLabelText("שנה")).toBeInTheDocument();
    for (const chip of screen.getAllByRole("button", { pressed: false }).filter((b) => b.textContent === "פנסיה")) {
      expect(chip.className).toContain("min-h-11");
    }
  });

  it("starts on 'לקוח/ה קיים/ת' and 'בהסכם ההתקשרות', the first method, with the client notice", () => {
    show();
    toClient();
    expect(screen.getByRole("button", { name: "לקוח/ה קיים/ת" })).toHaveAttribute("aria-pressed", "true");
    const methods = within(screen.getByRole("radiogroup", { name: "איך יודע/ה" })).getAllByRole("radio");
    expect(methods[0]).toHaveAccessibleName("בהסכם ההתקשרות");
    expect(methods[0]).toBeChecked();
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === STAFF_CLIENT_NOTICE)).toBeInTheDocument();
  });

  it("takes 'בהסכם ההתקשרות' away again in lead mode", () => {
    show();
    toClient();
    fireEvent.click(screen.getByRole("button", { name: "פנייה" }));
    expect(screen.queryByLabelText("בהסכם ההתקשרות")).toBeNull();
    expect(screen.getByRole("button", { name: "שמירה" })).toBeDisabled();
  });

  it("keeps שמירת לקוח/ה disabled until a service line and the notice are set", () => {
    show();
    toClient();
    type("שם", "רחל לוי");
    type("טלפון", "052-111 0010");
    expect(saveClient()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "פנסיה" }));
    expect(saveClient()).toBeDisabled();
    fireEvent.click(screen.getByLabelText("הלקוח/ה יודע/ת איך ישמשו הפרטים"));
    expect(saveClient()).toBeEnabled();
  });

  it("offers no month past this one in Israel — and November already on Oct 31, 22:30 UTC", () => {
    show({ now: new Date("2026-10-31T22:30:00Z") });
    toClient();
    expect(screen.getByLabelText("שנה")).toHaveValue("2026");
    expect(screen.getByLabelText("חודש")).toHaveValue("11");
    const month = screen.getByLabelText("חודש") as HTMLSelectElement;
    expect([...month.options].find((o) => o.value === "11")!.disabled).toBe(false);
    expect([...month.options].find((o) => o.value === "12")!.disabled).toBe(true);
    expect([...(screen.getByLabelText("שנה") as HTMLSelectElement).options].at(-1)!.value).toBe("1990");
  });

  it("sends a client: kind, the month, the products, status client, no topic", async () => {
    show();
    fillClient();
    fireEvent.click(saveClient());
    await waitFor(() => expect(h.createLead).toHaveBeenCalled());
    expect(h.createLead.mock.calls[0][0]).toMatchObject({
      kind: "client", clientSince: "2019-03", products: ["pension", "health"], status: "client", notice: "agreement", intake: "existing_client",
    });
    expect(h.createLead.mock.calls[0][0].topic).toBeUndefined();
  });

  it("shows the server's Hebrew refusal", async () => {
    h.createLead.mockRejectedValue(new Error("הוספת לקוח/ה אינה פעילה כרגע."));
    show();
    fillClient();
    fireEvent.click(saveClient());
    expect(await screen.findByRole("alert")).toHaveTextContent("הוספת לקוח/ה אינה פעילה כרגע.");
  });

  it("turns a matching lead into the client, with the form's month and lines, and opens it", async () => {
    h.createLead.mockResolvedValue({ leadId: "OLD1", duplicate: "visible", noticeSent: null });
    show({ leads: [{ id: "OLD1", name: "רחל לוי", phone: "0521110010", source: "quick", status: "contacted", created_date: "2025-03-14T10:00:00Z" }] });
    fillClient();
    fireEvent.click(saveClient());
    fireEvent.click(await screen.findByRole("button", { name: "הפיכת הפנייה הקיימת ללקוח/ה" }));
    await waitFor(() => expect(h.convertToClient).toHaveBeenCalledWith("OLD1", "2019-03", ["pension", "health"]));
    expect(onOpenExisting).toHaveBeenCalledWith("OLD1");
  });

  it("adds a new client anyway, on the second choice", async () => {
    h.createLead.mockResolvedValueOnce({ leadId: "OLD1", duplicate: "visible", noticeSent: null });
    show();
    fillClient();
    fireEvent.click(saveClient());
    fireEvent.click(await screen.findByRole("button", { name: "לקוח/ה חדש/ה בכל זאת" }));
    await waitFor(() => expect(h.createLead).toHaveBeenCalledTimes(2));
    expect(h.createLead.mock.calls[1][0]).toMatchObject({ kind: "client", duplicateOk: true });
  });

  it("ends on the next steps: the invite, the clearinghouse and a meeting, each by its switch", async () => {
    show();
    fillClient();
    fireEvent.click(saveClient());
    expect(await screen.findByText("✓ רחל לוי נוספ/ה כלקוח/ה")).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith("C1");
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "בקשת מסלקה" })).toHaveAttribute("href", "/admin/masleka?lead=C1");
    fireEvent.click(screen.getByRole("button", { name: "קביעת פגישה" }));
    expect(onCreated).toHaveBeenCalledWith("C1");
  });

  it("shows only what is open: no email, no clearinghouse, no meetings", async () => {
    h.meetingsStaff = false;
    h.createLead.mockResolvedValue({ leadId: "C1", duplicate: null, noticeSent: null, next: { invite: false, masleka: false } });
    show();
    fillClient();
    fireEvent.click(saveClient());
    await screen.findByText("✓ רחל לוי נוספ/ה כלקוח/ה");
    for (const name of ["שליחת הזמנה לאזור האישי", "קביעת פגישה"]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByRole("link", { name: "בקשת מסלקה" })).toBeNull();
  });

  it("sends the invite once and says so; a refusal is shown in Hebrew", async () => {
    show();
    fillClient();
    fireEvent.click(saveClient());
    fireEvent.click(await screen.findByRole("button", { name: "שליחת הזמנה לאזור האישי" }));
    expect(await screen.findByText("ההזמנה נשלחה")).toBeInTheDocument();
    expect(h.inviteClient).toHaveBeenCalledTimes(1);
    expect(h.inviteClient).toHaveBeenCalledWith(A1, "C1");
    expect(screen.queryByRole("button", { name: "שליחת הזמנה לאזור האישי" })).toBeNull();
  });

  it("shows 'כבר נשלחה הזמנה' when the server says so", async () => {
    h.inviteClient.mockRejectedValue(new Error("כבר נשלחה הזמנה ללקוח/ה הזה/הזו."));
    show();
    fillClient();
    fireEvent.click(saveClient());
    fireEvent.click(await screen.findByRole("button", { name: "שליחת הזמנה לאזור האישי" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("כבר נשלחה הזמנה");
  });

  it("shows no assignee to a User in client mode either", () => {
    show();
    toClient();
    expect(screen.queryByLabelText("שיוך")).toBeNull();
  });
});
