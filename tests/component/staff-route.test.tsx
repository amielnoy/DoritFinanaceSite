// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/app-params", () => ({ appParams: { token: "" } }));
const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth.value }));

import StaffRoute from "@/components/StaffRoute";
import type { StaffRole } from "@/services/ports";

const signedIn = (role: string | undefined = "user", id = "u1") => ({
  user: { id, role },
  isAuthenticated: true,
  isLoadingAuth: false,
  authChecked: true,
  authError: null,
  checkUserAuth: vi.fn(),
});

const tree = (loadRole: () => Promise<StaffRole | null>) => (
  <MemoryRouter initialEntries={["/admin/masleka"]}>
    <Routes>
      <Route element={<StaffRoute unauthenticatedElement={<p>מסך הכניסה</p>} loadRole={loadRole} />}>
        <Route path="/admin/masleka" element={<p>לוח המסלקה</p>} />
      </Route>
      <Route path="/" element={<p>דף הבית</p>} />
    </Routes>
  </MemoryRouter>
);

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderAt(loadRole: () => Promise<StaffRole | null>) {
  return render(<QueryClientProvider client={newClient()}>{tree(loadRole)}</QueryClientProvider>);
}

describe("<StaffRoute />", () => {
  it("sends a signed-out visitor to sign in", () => {
    auth.value = {
      user: null, isAuthenticated: false, isLoadingAuth: false, authChecked: true,
      authError: { type: "auth_required", message: "x" }, checkUserAuth: vi.fn(),
    };
    const loadRole = vi.fn();
    renderAt(loadRole);
    expect(screen.getByText("מסך הכניסה")).toBeInTheDocument();
    expect(loadRole).not.toHaveBeenCalled();
  });

  it("admits the platform admin without asking for a membership", () => {
    auth.value = signedIn("admin");
    const loadRole = vi.fn();
    renderAt(loadRole);
    expect(screen.getByText("לוח המסלקה")).toBeInTheDocument();
    expect(loadRole).not.toHaveBeenCalled();
  });

  it("admits a member of the agency", async () => {
    auth.value = signedIn();
    renderAt(async () => "staff");
    expect(await screen.findByText("לוח המסלקה")).toBeInTheDocument();
  });

  it("turns away a signed-in user with no membership", async () => {
    auth.value = signedIn();
    renderAt(async () => null);
    expect(await screen.findByText("דף הבית")).toBeInTheDocument();
    expect(screen.queryByText("לוח המסלקה")).toBeNull();
  });

  it("says so when the role cannot be read, rather than guessing either way", async () => {
    auth.value = signedIn();
    renderAt(async () => {
      throw new Error("down");
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("לא הצלחנו לאמת את ההרשאה");
    expect(screen.queryByText("לוח המסלקה")).toBeNull();
  });

  it("waits while sign-in is still being checked", () => {
    auth.value = { ...signedIn(), isLoadingAuth: true, authChecked: false };
    renderAt(async () => "staff");
    expect(screen.queryByText("לוח המסלקה")).toBeNull();
    expect(screen.queryByText("דף הבית")).toBeNull();
  });

  it.each([
    ["an empty string", ""],
    ["an unexpected string", "superuser"],
    ["a wrong-case role", "Staff"],
  ])("turns away a membership answer of %s, never rendering the outlet", async (_label, answer) => {
    auth.value = signedIn();
    renderAt((async () => answer) as unknown as () => Promise<StaffRole | null>);
    expect(await screen.findByText("דף הבית")).toBeInTheDocument();
    expect(screen.queryByText("לוח המסלקה")).toBeNull();
  });

  it("alerts, never renders the outlet, when the membership answer is undefined", async () => {
    auth.value = signedIn();
    renderAt((async () => undefined) as unknown as () => Promise<StaffRole | null>);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("לוח המסלקה")).toBeNull();
  });

  it("turns away a signed-in user who has no id, without asking", async () => {
    auth.value = { ...signedIn(), user: { role: "user" } };
    const loadRole = vi.fn(async () => "staff" as StaffRole);
    renderAt(loadRole);
    expect(await screen.findByText("דף הבית")).toBeInTheDocument();
    expect(loadRole).not.toHaveBeenCalled();
  });

  it.each([
    ["an admin spelled in capitals", "ADMIN"],
    ["no role at all", undefined],
    ["an unexpected role", "owner"],
  ])("does not take %s on the user for the platform admin", async (_label, role) => {
    auth.value = signedIn(role);
    const loadRole = vi.fn(async () => null);
    renderAt(loadRole);
    expect(await screen.findByText("דף הבית")).toBeInTheDocument();
    expect(loadRole).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("לוח המסלקה")).toBeNull();
  });

  it("does not let one user's role reach the next user who signs in", async () => {
    const client = newClient();
    const answers: Record<string, StaffRole | null> = { u1: "staff", u2: null };
    let who = "u1";
    const loadRole = vi.fn(async () => answers[who]);

    auth.value = signedIn("user", "u1");
    const view = render(<QueryClientProvider client={client}>{tree(loadRole)}</QueryClientProvider>);
    expect(await screen.findByText("לוח המסלקה")).toBeInTheDocument();

    // u1 signs out, u2 signs in, in the same tab and the same query cache.
    who = "u2";
    auth.value = signedIn("user", "u2");
    view.rerender(<QueryClientProvider client={client}>{tree(loadRole)}</QueryClientProvider>);
    expect(screen.queryByText("לוח המסלקה")).toBeNull();
    expect(await screen.findByText("דף הבית")).toBeInTheDocument();
    expect(loadRole).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("לוח המסלקה")).toBeNull();
  });
});
