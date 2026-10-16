// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

/*
 * The home page's chat loads when the visitor opens it, not with the page
 * (review 2026-10-15, item 22): AgentChat, and react-markdown with it, left the
 * home page's first bundle (main chunk 474 KB → 338 KB in the build measured).
 */
const chatModule = vi.hoisted(() => ({ evaluated: 0 }));
vi.mock("@/components/dorit/chat/AgentChat", () => {
  chatModule.evaluated += 1;
  return { default: () => <div>the interview chat</div> };
});
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = new Proxy({}, { get: (_t, tag: string) => ({ children, ...props }: any) => React.createElement(tag, props, children) });
  return { motion: passthrough, AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children), useReducedMotion: () => true };
});

const { default: StartConversation } = await import("@/components/dorit/sections/StartConversation");

describe("the home page's chat", () => {
  it("is not loaded with the section, and loads and shows once the visitor opens it", async () => {
    render(<MemoryRouter><StartConversation /></MemoryRouter>);
    expect(chatModule.evaluated).toBe(0);
    await userEvent.click(screen.getAllByRole("button", { name: /צ'אט/ })[0]);
    expect(await screen.findByText("the interview chat")).toBeTruthy();
    expect(chatModule.evaluated).toBe(1);
  });
});
