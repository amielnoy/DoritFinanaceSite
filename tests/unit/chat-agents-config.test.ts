import { describe, expect, it } from "vitest";
import { parseChatAgents } from "@/config/chat-agents";

describe("parseChatAgents", () => {
  it("is empty by default", () => expect([...parseChatAgents(undefined, true)]).toEqual([]));
  it("reads a comma-separated list", () => expect([...parseChatAgents(" needs_interview , ", true)]).toEqual(["needs_interview"]));
  it("ignores agents the function cannot serve yet", () => expect([...parseChatAgents("support_agent,needs_interview", true)]).toEqual(["needs_interview"]));
  it("is empty without Supabase, whatever it says", () => expect([...parseChatAgents("needs_interview", false)]).toEqual([]));
});
