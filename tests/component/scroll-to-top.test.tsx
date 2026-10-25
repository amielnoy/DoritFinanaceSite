// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScrollToTop from "@/components/ScrollToTop";

/*
 * A link opened fresh with a hash reaches its section (a campaign's
 * /?…#start): React Router calls the first load a POP, which ScrollToTop used
 * to skip as if it were the back button.
 */
describe("ScrollToTop on the first load", () => {
  let scrolled: string[];
  beforeEach(() => {
    vi.useFakeTimers();
    scrolled = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    } as typeof Element.prototype.scrollIntoView;
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  afterEach(() => vi.useRealTimers());

  const page = (entry: string) =>
    render(
      <MemoryRouter initialEntries={[entry]}>
        <ScrollToTop />
        <section id="start">start</section>
      </MemoryRouter>,
    );

  it("scrolls to the section a fresh link names", () => {
    page("/?utm_source=reactivation&utm_campaign=k7x2m9qa1b2c#start");
    act(() => void vi.advanceTimersByTime(100));
    expect(scrolled).toEqual(["start"]);
  });

  it("leaves a fresh load without a hash where the browser put it", () => {
    page("/");
    act(() => void vi.advanceTimersByTime(100));
    expect(scrolled).toEqual([]);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
