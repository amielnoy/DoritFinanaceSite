// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildXlsx, HB_ROWS } from "../fixtures/har-habituach";

const submitLead = vi.fn(async () => ({ ok: true, id: "lead_1" }));

vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  return { ...actual, services: { ...actual.services, leads: { ...actual.services.leads, submitLead } } };
});

const { default: HarHabituachCheck, CHECK_DISCLAIMER, DUPLICATE_NOTE } = await import(
  "@/components/dorit/sections/HarHabituachCheck"
);

type Gtag = ReturnType<typeof vi.fn>;
const w = window as unknown as { gtag?: Gtag };
const sent = (name: string) => w.gtag!.mock.calls.filter((c) => c[1] === name);

const xlsx = (rows = HB_ROWS, name = "har-habituach.xlsx") =>
  new File([buildXlsx(rows)], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

async function upload(file: File) {
  render(<HarHabituachCheck />);
  await userEvent.upload(screen.getByLabelText(/בחירת קובץ הר הביטוח/), file);
}

beforeEach(() => {
  w.gtag = vi.fn();
  submitLead.mockClear();
});
afterEach(() => {
  delete w.gtag;
});

describe("<HarHabituachCheck /> — /tools, בדיקת כפל ביטוחים", () => {
  it("shows the three steps, linking to Har HaBituach in a new tab, and the disclaimer", () => {
    render(<HarHabituachCheck />);
    const link = screen.getByRole("link", { name: /הר הביטוח/ });
    expect(link).toHaveAttribute("href", "https://harb.cma.gov.il/");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/הקובץ נקרא בדפדפן שלכם ולא נשלח לשום מקום/)).toBeInTheDocument();
    expect(screen.getByText(CHECK_DISCLAIMER)).toBeInTheDocument();
  });

  it("reads the file into tiles and a list, a duplicate tagged, without sending anything", async () => {
    await upload(xlsx());
    const tiles = await screen.findByText("כפל אפשרי", { selector: "dt" });
    expect(tiles.nextSibling).toHaveTextContent("1");
    expect(screen.getByText("כדאי לבדוק", { selector: "dt" }).nextSibling).toHaveTextContent("3");
    const list = within(screen.getByRole("list", { name: "הפוליסות לפי סוג כיסוי" }));
    const drugs = list.getByText("תרופות - בסיס").closest("li")!;
    expect(within(drugs).getByText("כפל אפשרי")).toBeInTheDocument();
    const car = list.getByText("רכב חובה").closest("li")!;
    expect(within(car).queryByText("כפל אפשרי")).not.toBeInTheDocument();
    expect(screen.getByText(DUPLICATE_NOTE)).toBeInTheDocument();
    expect(submitLead).not.toHaveBeenCalled();
  });

  it("counts the check for GA4 once, by the tool's name only", async () => {
    await upload(xlsx());
    await screen.findByText("כפל אפשרי", { selector: "dt" });
    expect(sent("calculator_result")).toEqual([["event", "calculator_result", { tool: "coverage_check" }]]);
  });

  it("refuses a file that is not an xlsx, and an xlsx that is not Har HaBituach's", async () => {
    render(<HarHabituachCheck />);
    const input = screen.getByLabelText(/בחירת קובץ הר הביטוח/);
    fireEvent.change(input, { target: { files: [new File(["x"], "policies.xls")] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("אפשר לבדוק קובץ xlsx בלבד");
    fireEvent.change(input, { target: { files: [xlsx([["a", "b"], ["c", "d"]])] } });
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("לא מצאנו בקובץ את טבלת הפוליסות"));
  });

  it("sends Dorit only the summary, through the lead pipeline, and counts a lead once it is saved", async () => {
    await upload(xlsx());
    await screen.findByRole("heading", { name: "לשלוח לדורית לבדיקה" });
    await userEvent.type(screen.getByLabelText("שם *"), "דנה");
    await userEvent.type(screen.getByLabelText("טלפון נייד *"), "0501234567");
    await userEvent.click(screen.getByRole("button", { name: "לשלוח לדורית לבדיקה" }));
    await screen.findByRole("status");
    expect(submitLead).toHaveBeenCalledTimes(1);
    const lead = submitLead.mock.calls[0][0] as Record<string, string>;
    expect(lead).toMatchObject({ name: "דנה", phone: "0501234567", source: "quick", topic: "בדיקת כפל ביטוחים" });
    expect(lead.message).toContain("תרופות - בסיס (2 פוליסות");
    expect(JSON.stringify(lead)).not.toMatch(/000000018|FAKE-0001/);
    expect(sent("generate_lead")).toEqual([["event", "generate_lead", { method: "coverage_check" }]]);
  });

  it("asks for a name and a mobile number before sending", async () => {
    await upload(xlsx());
    await screen.findByRole("heading", { name: "לשלוח לדורית לבדיקה" });
    await userEvent.click(screen.getByRole("button", { name: "לשלוח לדורית לבדיקה" }));
    expect(screen.getByRole("alert")).toHaveTextContent("נא למלא שם.");
    await userEvent.type(screen.getByLabelText("שם *"), "דנה");
    await userEvent.type(screen.getByLabelText("טלפון נייד *"), "031234567");
    await userEvent.click(screen.getByRole("button", { name: "לשלוח לדורית לבדיקה" }));
    expect(screen.getByRole("alert")).toHaveTextContent("מספר נייד צריך להתחיל ב-05");
    expect(submitLead).not.toHaveBeenCalled();
  });
});
