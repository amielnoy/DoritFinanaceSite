// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import AgentPortrait from "@/components/dorit/primitives/AgentPortrait";

const SIZES = "(min-width: 1024px) 490px, 88px";

describe("AgentPortrait", () => {
  it("CMP-POR-001: the bundled portrait is Dorit's AVIF + WebP picture", () => {
    const { container } = render(<AgentPortrait portrait={{ kind: "bundled", alt: "דורית" }} sizes={SIZES} />);
    const sources = container.querySelectorAll("picture > source");
    expect(sources).toHaveLength(2);
    expect(sources[0].getAttribute("type")).toBe("image/avif");
    expect(sources[0].getAttribute("srcset")).toContain("/images/dorit-office-portrait-480.avif 480w");
    expect(sources[1].getAttribute("type")).toBe("image/webp");
    expect(sources[1].getAttribute("srcset")).toContain("/images/dorit-office-portrait-1080.webp 1080w");
    const img = screen.getByRole("img", { name: "דורית" });
    expect(img.getAttribute("src")).toBe("/images/dorit-office-portrait-768.webp");
    expect(img.getAttribute("width")).toBe("1122");
    expect(img.getAttribute("height")).toBe("1402");
    expect(img.getAttribute("fetchpriority")).toBe("high");
    // Hero's <img> carries no `sizes` of its own; the <source>s do, and the browser reads those.
    expect(sources[0].getAttribute("sizes")).toBe(SIZES);
    expect(sources[1].getAttribute("sizes")).toBe(SIZES);
  });

  it("CMP-POR-002: an uploaded photo is one <img> with src, srcset and sizes", () => {
    const { container } = render(
      <AgentPortrait
        portrait={{ kind: "photo", src: "https://x/p-768.webp", srcSet: "https://x/p-480.webp 480w", alt: "יעל" }}
        sizes={SIZES}
      />,
    );
    expect(container.querySelector("picture")).toBeNull();
    const img = screen.getByRole("img", { name: "יעל" });
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("https://x/p-768.webp");
    expect(img.getAttribute("srcset")).toBe("https://x/p-480.webp 480w");
    expect(img.getAttribute("sizes")).toBe(SIZES);
  });

  it("CMP-POR-003: a monogram is a labelled box of initials, not an <img>", () => {
    const { container } = render(<AgentPortrait portrait={{ kind: "monogram", initials: "יכ", alt: "יעל כהן" }} sizes={SIZES} />);
    expect(screen.getByRole("img", { name: "יעל כהן" }).textContent).toBe("יכ");
    expect(container.querySelector("img")).toBeNull();
  });
});
