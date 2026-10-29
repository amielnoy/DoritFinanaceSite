/**
 * Each on-site agent's v6 notice, the one the chat shows (every agent is on
 * the `chat` function since Base44 exit B1). Moved from
 * chat-agents-config.test.ts when the per-agent switch went.
 */
import { describe, expect, it } from "vitest";
import { AGENTS } from "@/config/agents";
import {
  CHAT_FUNCTION_CONSENT_POINTS,
  BLOG_RECOMMENDER_CONSENT_POINTS,
  CHAT_FUNCTION_BLOG_CONSENT_POINTS,
  CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT,
  CHAT_FUNCTION_PROCEDURES_CONSENT_POINTS,
  CHAT_FUNCTION_SUPPORT_CONSENT_POINTS,
  CONSENT,
  PROCEDURES_CONSENT_POINTS,
  SUPPORT_CONSENT_POINTS,
} from "@/config/compliance";

describe("the v6 notice of each agent the function may serve", () => {
  it("exists for every one of them", () => {
    for (const { agent } of Object.values(AGENTS)) expect(CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT[agent], agent).toBeDefined();
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

describe("the procedures chat's v6 notice", () => {
  it("is the procedures chat's own for the procedures chat: its three points and the v6 fourth", () => {
    const points = CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT.procedures_agent;
    expect(points).toBe(CHAT_FUNCTION_PROCEDURES_CONSENT_POINTS);
    expect(points.slice(0, 3)).toEqual(PROCEDURES_CONSENT_POINTS.slice(0, 3));
    expect(points[3]).toBe(CHAT_FUNCTION_SUPPORT_CONSENT_POINTS[3]);
    expect(points).not.toContain(CONSENT.points[0]);
    expect(points.join(" ")).not.toMatch(/מתאם פגישה/);
  });
});

describe("the blog recommender's v6 notice", () => {
  it("is the adviser's two lines and the v6 line, never the interview's", () => {
    const points = CHAT_FUNCTION_CONSENT_POINTS_BY_AGENT.blog_recommender;
    expect(points).toBe(CHAT_FUNCTION_BLOG_CONSENT_POINTS);
    expect(points).toEqual([BLOG_RECOMMENDER_CONSENT_POINTS[0], BLOG_RECOMMENDER_CONSENT_POINTS[1], CHAT_FUNCTION_SUPPORT_CONSENT_POINTS[3]]);
    expect(points.join(" ")).not.toMatch(/נאספים שם וטלפון/);
  });
});
