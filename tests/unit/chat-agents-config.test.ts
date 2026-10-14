import { describe, expect, it } from "vitest";
import { CHAT_FUNCTION_AGENTS, parseChatAgents } from "@/config/chat-agents";
import {
  CHAT_FUNCTION_CONSENT_POINTS,
  CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT,
  CHAT_FUNCTION_SUPPORT_CONSENT_POINTS,
  CONSENT,
  SUPPORT_CONSENT_POINTS,
} from "@/config/compliance";

describe("parseChatAgents", () => {
  it("is empty by default", () => expect([...parseChatAgents(undefined, true)]).toEqual([]));
  it("reads a comma-separated list", () => expect([...parseChatAgents(" needs_interview , ", true)]).toEqual(["needs_interview"]));
  it("ignores agents the function cannot serve yet", () =>
    expect([...parseChatAgents("procedures_agent,needs_interview,blog_recommender", true)]).toEqual(["needs_interview"]));
  it("is empty without Supabase, whatever it says", () => expect([...parseChatAgents("needs_interview", false)]).toEqual([]));

  it("may serve the FAQ chat from the function, but only when VITE_CHAT_AGENTS names it", () => {
    expect(CHAT_FUNCTION_AGENTS).toContain("support_agent");
    expect([...parseChatAgents("", true)]).toEqual([]);
    expect([...parseChatAgents("support_agent", true)]).toEqual(["support_agent"]);
    expect([...parseChatAgents("needs_interview,support_agent", true)]).toEqual(["needs_interview", "support_agent"]);
    expect([...parseChatAgents("support_agent", false)]).toEqual([]);
    expect([...parseChatAgents("procedures_agent,blog_recommender", true)]).toEqual([]);
  });
});

describe("the v6 notice of each agent the function may serve", () => {
  it("exists for every one of them", () => {
    for (const agent of CHAT_FUNCTION_AGENTS) expect(CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT[agent], agent).toBeDefined();
  });

  it("is the interview's for the interview", () => {
    expect(CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT.needs_interview).toBe(CHAT_FUNCTION_CONSENT_POINTS);
  });

  it("is the FAQ chat's own for the FAQ chat: its first three points, never the interview's promise of a name, a phone and a meeting", () => {
    const points = CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT.support_agent;
    expect(points).toBe(CHAT_FUNCTION_SUPPORT_CONSENT_POINTS);
    expect(points.slice(0, 3)).toEqual(SUPPORT_CONSENT_POINTS.slice(0, 3));
    expect(points).not.toContain(CONSENT.points[0]);
    expect(points).not.toContain(CONSENT.points[2]);
    expect(points.join(" ")).not.toMatch(/נאספים שם וטלפון|מתאם פגישה/);
  });

  it("says, for the FAQ chat as for the interview, who processes the conversation and how long it is kept", () => {
    const fourth = CHAT_FUNCTION_SUPPORT_CONSENT_POINTS[3];
    expect(fourth).toContain("ספק שירותי בינה מלאכותית מחוץ לישראל");
    expect(fourth).toContain("12 חודשים");
    expect(CHAT_FUNCTION_CONSENT_POINTS[3]).toContain("ספק שירותי בינה מלאכותית מחוץ לישראל");
    expect(fourth).not.toBe(SUPPORT_CONSENT_POINTS[3]);
  });
});
