// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/AuthContext", () => ({ useAuth: () => auth.value }));
const agency = vi.hoisted(() => ({
  myAgencies: vi.fn(),
  myRole: vi.fn(),
}));
vi.mock("@/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services")>()),
  services: { agency },
}));

import AgencyRoute from "@/components/AgencyRoute";
import type { AgencyRole } from "@/config/permissions";

const A1 = "00000000-0000-0000-0000-000000000001";
const TRUST = "0abcfa0b-cc26-40f0-8971-54bd4d845139";

const signedIn = (role: string | undefined = "user", id = "u1") => ({
  user: { id, role },
  isAuthenticated: true,
  isLoadingAuth: false,
  authChecked: true,
  authError: null,
  checkUserAuth: vi.fn(),
});

function renderAt(min: AgencyRole, path = "/admin/x") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AgencyRoute min={min} unauthenticatedElement={<p>מסך הכניסה</p>} />}>
            <Route path="/admin/x" element={<p>המסך</p>} />
          </Route>
          <Route path="/" element={<p>דף הבית</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  agency.myAgencies.mockReset().mockResolvedValue([{ id: A1, name: "דורית", role: "user" }]);
  agency.myRole.mockReset();
});

describe("<AgencyRoute />", () => {
  it("sends a signed-out visitor to sign in, asking nothing", () => {
    auth.value = {
      user: null, isAuthenticated: false, isLoadingAuth: false, authChecked: true,
      authError: { type: "auth_required", message: "x" }, checkUserAuth: vi.fn(),
    };
    renderAt("user");
    expect(screen.getByText("מסך הכניסה")).toBeInTheDocument();
    expect(agency.myRole).not.toHaveBeenCalled();
  });

  it("admits the platform operator to every level, a member of no agency", async () => {
    auth.value = signedIn("admin");
    agency.myAgencies.mockResolvedValue([]);
    agency.myRole.mockResolvedValue(null);
    renderAt("owner");
    expect(await screen.findByText("המסך")).toBeInTheDocument();
  });

  it.each([
    ["user", "user", true],
    ["admin", "user", true],
    ["owner", "admin", true],
    ["user", "admin", false],
    ["admin", "owner", false],
  ] as const)("a %s at a %s screen: %s", async (role, min, admitted) => {
    auth.value = signedIn();
    agency.myRole.mockResolvedValue(role);
    renderAt(min);
    expect(await screen.findByText(admitted ? "המסך" : "דף הבית")).toBeInTheDocument();
  });

  it("sends someone with no role in the agency home", async () => {
    auth.value = signedIn();
    agency.myAgencies.mockResolvedValue([]);
    agency.myRole.mockResolvedValue(null);
    renderAt("user");
    expect(await screen.findByText("דף הבית")).toBeInTheDocument();
  });

  it("says it could not check, rather than guessing, when the role cannot be read", async () => {
    auth.value = signedIn();
    agency.myRole.mockRejectedValue(new Error("down"));
    renderAt("user");
    expect(await screen.findByRole("alert")).toHaveTextContent("לא הצלחנו לאמת את ההרשאה");
    expect(screen.queryByText("המסך")).not.toBeInTheDocument();
  });

  it("asks about the agency in ?agency= when it is one of the person's", async () => {
    auth.value = signedIn();
    agency.myAgencies.mockResolvedValue([{ id: A1, name: "דורית", role: "user" }, { id: TRUST, name: "Trust", role: "owner" }]);
    agency.myRole.mockImplementation(async (id: string) => (id === TRUST ? "owner" : "user"));
    renderAt("owner", `/admin/x?agency=${TRUST}`);
    expect(await screen.findByText("המסך")).toBeInTheDocument();
    expect(agency.myRole).toHaveBeenCalledWith(TRUST);
  });

  it("ignores an ?agency= that is not the person's, and asks about their own", async () => {
    auth.value = signedIn();
    agency.myRole.mockResolvedValue("user");
    renderAt("user", `/admin/x?agency=${TRUST}`);
    expect(await screen.findByText("המסך")).toBeInTheDocument();
    expect(agency.myRole).toHaveBeenLastCalledWith(A1);
  });
});
