// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/* The login page's Google button: a start that fails says so, instead of a silent click (review 2026-10-15). */

const signInWithGoogle = vi.fn<(returnUrl: string) => Promise<void>>();
vi.mock("@/services", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services")>();
  return { ...actual, services: { ...actual.services, auth: { ...actual.services.auth, signInWithGoogle: (u: string) => signInWithGoogle(u) } } };
});

const { default: Login } = await import("@/pages/Login");

describe("<Login /> — Google", () => {
  it("tells the visitor when Google's sign-in could not start", async () => {
    signInWithGoogle.mockRejectedValue(new Error("provider is not enabled"));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/login"]}><Login /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: /המשיכו עם Google/ }));
    expect(await screen.findByText("לא הצלחנו להתחיל את ההתחברות. נסו שוב.")).toBeInTheDocument();
  });

  it("says nothing while Google takes the visitor away", async () => {
    signInWithGoogle.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/login"]}><Login /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: /המשיכו עם Google/ }));
    expect(screen.queryByText("לא הצלחנו להתחיל את ההתחברות. נסו שוב.")).toBeNull();
    expect(signInWithGoogle).toHaveBeenCalled();
  });
});
