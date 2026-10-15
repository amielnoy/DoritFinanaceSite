// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { base44Mock } from "./base44-mock";

vi.mock("@/api/base44Client", () => ({ base44: base44Mock }));
vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));

const { default: ClaimForm } = await import("@/components/dorit/forms/ClaimForm");
const { CLAIM_FIELD_LIMITS } = await import("@/config/claimDocuments");

/* The claim report's file picker and limits, as the review of 2026-10-15 asked: reachable by keyboard, stated up front, reported beside the field. */

const picker = () => screen.getByLabelText(/לחצו לבחירת קבצים/) as HTMLInputElement;

describe("<ClaimForm /> — the file picker and the limits", () => {
  it("keeps the file picker in the tab order, visually hidden rather than display:none", async () => {
    const user = userEvent.setup();
    render(<ClaimForm />);
    expect(picker()).not.toHaveClass("hidden");
    expect(picker()).toHaveClass("sr-only");
    // From the description, the next stop is the picker.
    const description = screen.getAllByRole("textbox").at(-1)!;
    description.focus();
    await user.tab();
    expect(picker()).toHaveFocus();
  });

  it("states the limits before anything is picked, tied to the picker", () => {
    render(<ClaimForm />);
    const hint = screen.getByText(/עד 10 מסמכים/);
    expect(hint).toHaveTextContent(/10MB/);
    expect(hint).toHaveTextContent(/PDF/);
    expect(picker().getAttribute("aria-describedby")).toContain(hint.id);
  });

  it("names a refused file beside the picker, not by the Send button", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ClaimForm />);
    await user.upload(picker(), new File(["x"], "virus.exe", { type: "application/x-msdownload" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("virus.exe");
    expect(picker().getAttribute("aria-describedby")).toContain(alert.id);
    expect(picker()).toHaveAttribute("aria-invalid", "true");
  });

  it("lets no field take more than the server accepts", () => {
    const { container } = render(<ClaimForm />);
    const max = (el: Element | null) => Number(el?.getAttribute("maxlength"));
    expect(max(screen.getByLabelText(/שם מלא/))).toBe(CLAIM_FIELD_LIMITS.name);
    expect(max(screen.getByLabelText(/טלפון/))).toBe(CLAIM_FIELD_LIMITS.phone);
    expect(max(container.querySelector('input[type="email"]'))).toBe(CLAIM_FIELD_LIMITS.email);
    expect(max(container.querySelector("textarea"))).toBe(CLAIM_FIELD_LIMITS.description);
  });
});
