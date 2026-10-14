// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

const checkFreshness = vi.fn(async () => "fresh" as const);
const reloadFresh = vi.fn();
vi.mock("@/lib/freshness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/freshness")>()),
  checkFreshness,
  reloadFresh,
}));

const { default: ErrorBoundary } = await import("@/components/ErrorBoundary");
import { CONTACT } from "@/config/contact";

const Boom = () => {
  throw new Error("render failure");
};

describe("ErrorBoundary", () => {
  it("renders children normally when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the fallback with all three contact links when a child throws, and logs without personal data", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toContain("משהו השתבש");
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(`tel:${CONTACT.phoneE164}`);
    expect(hrefs).toContain(`https://wa.me/${CONTACT.whatsapp}`);
    expect(hrefs).toContain(`mailto:${CONTACT.email}`);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("isolates the failure: sibling trees still render", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
        <p>sibling survives</p>
      </div>,
    );
    expect(screen.getByText("sibling survives")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("החלק הזה");
  });

  it("uses page wording for the app-level boundary", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary scope="page">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toContain("הדף");
  });

  it("recovers when its resetKey changes, so leaving a broken page is not a dead end", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const Page = ({ broken }: { broken: boolean }) => (broken ? <Boom /> : <p>next page</p>);
    const { rerender } = render(
      <ErrorBoundary scope="page" resetKey="/broken">
        <Page broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    rerender(
      <ErrorBoundary scope="page" resetKey="/faq">
        <Page broken={false} />
      </ErrorBoundary>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("next page")).toBeTruthy();
  });

  it("offers a fresh load, past the cache, in the fallback", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary scope="page">
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "לטעון את הדף מחדש" }));
    expect(reloadFresh).toHaveBeenCalledTimes(1);
  });

  it("asks whether the build was replaced when a page chunk failed to load, and only then", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    checkFreshness.mockClear();
    const ChunkGone = () => {
      throw new TypeError("Failed to fetch dynamically imported module: https://govari-fin.co.il/assets/Claims-abc.js");
    };
    render(
      <ErrorBoundary scope="page">
        <ChunkGone />
      </ErrorBoundary>,
    );
    expect(checkFreshness).toHaveBeenCalledTimes(1);
    checkFreshness.mockClear();
    render(
      <ErrorBoundary scope="page">
        <Boom />
      </ErrorBoundary>,
    );
    expect(checkFreshness).not.toHaveBeenCalled();
  });
});
