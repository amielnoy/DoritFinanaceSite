// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/*
 * The claim form's documents (review 2026-10-15, item 19): a file dropped on
 * the zone takes the same checks as a picked one, the picker stays reachable
 * by keyboard, and a problem is said in an alert.
 */
vi.mock("@/lib/AuthContext", () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, isLoadingAuth: false, logout: vi.fn() }),
}));
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = new Proxy({}, { get: (_t, tag: string) => ({ children, ...props }: any) => React.createElement(tag, props, children) });
  return { motion: passthrough, AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children) };
});
vi.mock("@/components/ui/image", async () => {
  const React = await import("react");
  return { Image: ({ src, alt }: { src: string; alt: string }) => React.createElement("img", { src, alt }) };
});

const { default: LocaleLayout } = await import("@/i18n/LocaleLayout");
const { default: Claims } = await import("@/pages/Claims");

function renderClaims() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/claims"]}>
        <Routes>
          <Route element={<LocaleLayout locale="he" />}>
            <Route path="/claims" element={<Claims />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const picker = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
const dropZone = () => picker().closest("label")!;
const pdf = new File(["%PDF-1.4"], "policy.pdf", { type: "application/pdf" });
const exe = new File(["MZ"], "setup.exe", { type: "application/x-msdownload" });

describe("the claim form's documents", () => {
  it("takes dropped files through the same checks as picked ones", () => {
    renderClaims();
    fireEvent.dragOver(dropZone(), { dataTransfer: { files: [pdf, exe] } });
    fireEvent.drop(dropZone(), { dataTransfer: { files: [pdf, exe] } });
    expect(screen.getByText("policy.pdf")).toBeTruthy();
    expect(screen.queryByText("setup.exe")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("\"setup.exe\" — ניתן לצרף PDF או תמונה");
  });

  it("keeps the picker in the tab order: visually hidden, never display:none", async () => {
    renderClaims();
    expect(picker().className).toContain("sr-only");
    expect(picker().className.split(/\s+/)).not.toContain("hidden");
    const user = userEvent.setup();
    for (let i = 0; i < 30 && document.activeElement !== picker(); i += 1) await user.tab();
    expect(document.activeElement).toBe(picker());
  });

  it("accepts only the bucket's types, and says a picked file's problem in an alert", () => {
    renderClaims();
    expect(picker().accept).toContain("application/pdf");
    expect(picker().accept).toContain("image/heic");
    const big = new File([new Uint8Array(1)], "scan.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(picker(), { target: { files: [big] } });
    expect(screen.getByRole("alert").textContent).toContain("\"scan.jpg\" גדול מ-10MB");
    expect(picker().value).toBe("");
  });
});
