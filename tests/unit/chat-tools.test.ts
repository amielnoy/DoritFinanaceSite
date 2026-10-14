import { describe, expect, it, vi } from "vitest";
import {
  ESCALATE_TOOL,
  INTERVIEW_TOOLS,
  LIST_ARTICLES_TOOL,
  READ_ARTICLE_TOOL,
  SUPPORT_TOOLS,
  createToolRunner,
  type ToolCallContext,
} from "../../supabase/functions/chat/tools.ts";
import type { ArticleSource } from "../../supabase/functions/chat/articles.ts";

const ctx = (over: Partial<ToolCallContext> = {}): ToolCallContext => ({
  conversation: {
    id: "00000000-0000-4000-8000-000000000001",
    status: "open",
    escalated: false,
    consentVersion: "2026-10-agents-v6",
    consentAt: "2026-10-13T09:00:00.000Z",
    attribution: { channel: "google", campaign: "", landingPath: "/" },
  },
  agent: "needs_interview",
  origin: "https://govari-fin.co.il",
  userAgent: "Mozilla/5.0 (iPhone)",
  forwardedFor: "203.0.113.9",
  evalMode: false,
  ...over,
});

const answering = (status: number, body: unknown) =>
  vi.fn(async (_req: Request) => new Response(JSON.stringify(body), { status }));

const LEAD = {
  stage: "complete",
  name: "רונית אבני",
  phone: "0527654321",
  email: "",
  track: "pension",
  meetingTopic: "דמי ניהול",
  timing: "ראשון בבוקר",
  notes: "",
  scheduledAt: "2026-10-18T09:00:00",
  summary: "שכירה, דמי ניהול",
  profile: { life_stage: "שכירה", goal: "צבירה", concern: "דמי ניהול" },
};

describe("INTERVIEW_TOOLS", () => {
  it("are submitLead and escalateToHuman, the names the prompt uses", () => {
    expect(INTERVIEW_TOOLS.map((t) => t.name)).toEqual(["submitLead", "escalateToHuman"]);
  });
});

describe("submitLead", () => {
  it("posts the lead to submit-lead with consent and attribution from the conversation, never from the model", async () => {
    const submitLead = answering(200, { ok: true, rid: "r1", leadId: "lead-1" });
    const run = createToolRunner({ submitLead, escalateToHuman: answering(200, {}) });
    const outcome = await run("submitLead", { ...LEAD, channel: "evil", consent_version: "forged", source: "quick" }, ctx());

    const req = submitLead.mock.calls[0][0] as Request;
    const body = await req.json();
    expect(body).toMatchObject({
      source: "interview",
      stage: "complete",
      name: "רונית אבני",
      phone: "0527654321",
      consent_version: "2026-10-agents-v6",
      consent_at: "2026-10-13T09:00:00.000Z",
      channel: "google",
      landingPath: "/",
    });
    expect(req.headers.get("origin")).toBe("https://govari-fin.co.il");
    expect(req.headers.get("x-forwarded-for")).toBe("203.0.113.9");
    expect(outcome).toMatchObject({ name: "submitLead", status: "ok", isError: false, leadId: "lead-1", leadSaved: true });
  });

  it("saves a partial lead silently: a lead id, but not a saved interview", async () => {
    const run = createToolRunner({ submitLead: answering(200, { ok: true, leadId: "lead-2" }), escalateToHuman: answering(200, {}) });
    const outcome = await run("submitLead", { ...LEAD, stage: "partial" }, ctx());
    expect(outcome).toMatchObject({ status: "ok", leadId: "lead-2", leadSaved: false });
  });

  it("writes one complete lead per conversation: the second call answers already_saved", async () => {
    const submitLead = answering(200, { ok: true, leadId: "lead-1" });
    const run = createToolRunner({ submitLead, escalateToHuman: answering(200, {}) });
    const c = ctx();
    await run("submitLead", LEAD, c);
    const second = await run("submitLead", LEAD, c);
    expect(submitLead).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ status: "already_saved", isError: false });
    expect(c.conversation.status).toBe("lead_saved");
  });

  it("refuses a partial save once the lead is saved: already_saved, no second row", async () => {
    const submitLead = answering(200, { ok: true, leadId: "lead-1" });
    const run = createToolRunner({ submitLead, escalateToHuman: answering(200, {}) });
    const c = ctx();
    await run("submitLead", LEAD, c);
    const second = await run("submitLead", { ...LEAD, stage: "partial" }, c);
    expect(second).toMatchObject({ status: "already_saved", isError: false });
    expect(submitLead).toHaveBeenCalledTimes(1);
  });

  it("refuses a partial save after a simulated complete one too", async () => {
    const submitLead = answering(200, { ok: true });
    const run = createToolRunner({ submitLead, escalateToHuman: answering(200, {}) });
    const c = ctx({ evalMode: true });
    await run("submitLead", LEAD, c);
    expect(await run("submitLead", { ...LEAD, stage: "partial" }, c)).toMatchObject({ status: "already_saved" });
  });

  it("hands the model the handler's own Hebrew error, so it can ask again", async () => {
    const run = createToolRunner({ submitLead: answering(400, { error: "נדרשים שם וטלפון", rid: "r2" }), escalateToHuman: answering(200, {}) });
    const outcome = await run("submitLead", { ...LEAD, phone: "" }, ctx());
    expect(outcome).toMatchObject({ status: "error", isError: true, leadSaved: false });
    expect(outcome.forModel).toContain("נדרשים שם וטלפון");
  });

  it("simulates the save in an evaluation run, without calling the handler", async () => {
    const submitLead = answering(200, { ok: true });
    const run = createToolRunner({ submitLead, escalateToHuman: answering(200, {}) });
    const outcome = await run("submitLead", LEAD, ctx({ evalMode: true }));
    expect(submitLead).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "simulated", leadSaved: true, isError: false });
  });
});

describe("escalateToHuman", () => {
  it("posts the hand-off with the agent, the consent and the attribution, and reports it", async () => {
    const escalateToHuman = answering(200, { ok: true, contact: { phoneDisplay: "050-831-1776" }, acknowledgement: "הפרטים הועברו" });
    const run = createToolRunner({ submitLead: answering(200, {}), escalateToHuman });
    const outcome = await run("escalateToHuman", { reason: "product_recommendation", summary: "שאל איזו קרן הכי טובה" }, ctx());
    const body = await (escalateToHuman.mock.calls[0][0] as Request).json();
    expect(body).toMatchObject({ reason: "product_recommendation", agent: "needs_interview", consentVersion: "2026-10-agents-v6", channel: "google" });
    expect(outcome).toMatchObject({ status: "ok", escalated: true, isError: false });
    expect(outcome.forModel).toContain("050-831-1776");
  });

  it("turns an unknown reason into uncertain before it leaves", async () => {
    const escalateToHuman = answering(200, { ok: true });
    const run = createToolRunner({ submitLead: answering(200, {}), escalateToHuman });
    await run("escalateToHuman", { reason: "whatever", summary: "x" }, ctx());
    expect((await (escalateToHuman.mock.calls[0][0] as Request).json()).reason).toBe("uncertain");
  });

  it("hands off once per conversation: the second call answers already_escalated without calling the handler", async () => {
    const escalateToHuman = answering(200, { ok: true, leadId: "lead-9" });
    const run = createToolRunner({ submitLead: answering(200, {}), escalateToHuman });
    const c = ctx();
    await run("escalateToHuman", { reason: "uncertain", summary: "x" }, c);
    const second = await run("escalateToHuman", { reason: "complaint", summary: "y" }, c);
    expect(escalateToHuman).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ status: "already_escalated", isError: false });
    expect(c.conversation.status).toBe("escalated");
    expect(c.conversation.escalated).toBe(true);
  });

  it("does not let a failed hand-off block the retry", async () => {
    const escalateToHuman = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const run = createToolRunner({ submitLead: answering(200, {}), escalateToHuman });
    const c = ctx();
    const first = await run("escalateToHuman", { reason: "uncertain", summary: "x" }, c);
    expect(first).toMatchObject({ status: "error", isError: true, escalated: false });
    expect(c.conversation.status).toBe("open");
    const second = await run("escalateToHuman", { reason: "uncertain", summary: "x" }, c);
    expect(escalateToHuman).toHaveBeenCalledTimes(2);
    expect(second).toMatchObject({ status: "ok", escalated: true });
  });

  it("exposes the lead id the hand-off recorded, for the conversation's lead_id", async () => {
    const run = createToolRunner({ submitLead: answering(200, {}), escalateToHuman: answering(200, { ok: true, leadId: "lead-9", recorded: true }) });
    const outcome = await run("escalateToHuman", { reason: "user_request", summary: "x", name: "ר", phone: "0527654321" }, ctx());
    expect(outcome.leadId).toBe("lead-9");
  });

  it("has no lead id when the hand-off was anonymous (the handler answers leadId null)", async () => {
    const run = createToolRunner({ submitLead: answering(200, {}), escalateToHuman: answering(200, { ok: true, leadId: null, recorded: false }) });
    const outcome = await run("escalateToHuman", { reason: "user_request", summary: "x" }, ctx());
    expect(outcome.leadId).toBeUndefined();
  });
});

describe("a hand-off and a lead in one conversation (Ruling 9)", () => {
  it("keeps already_saved after a hand-off: the second complete submitLead writes nothing", async () => {
    const submitLead = answering(200, { ok: true, leadId: "lead-1" });
    const run = createToolRunner({ submitLead, escalateToHuman: answering(200, { ok: true }) });
    const c = ctx();
    await run("submitLead", LEAD, c);
    await run("escalateToHuman", { reason: "uncertain", summary: "x" }, c);
    const second = await run("submitLead", LEAD, c);
    expect(second).toMatchObject({ status: "already_saved" });
    expect(submitLead).toHaveBeenCalledTimes(1);
    expect(c.conversation.status).toBe("lead_saved");
    expect(c.conversation.escalated).toBe(true);
  });

  it("saves the lead after a hand-off: status becomes lead_saved, escalated stays true", async () => {
    const submitLead = answering(200, { ok: true, leadId: "lead-1" });
    const run = createToolRunner({ submitLead, escalateToHuman: answering(200, { ok: true }) });
    const c = ctx();
    await run("escalateToHuman", { reason: "uncertain", summary: "x" }, c);
    expect(c.conversation.status).toBe("escalated");
    const outcome = await run("submitLead", LEAD, c);
    expect(submitLead).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ status: "ok", leadSaved: true });
    expect(c.conversation.status).toBe("lead_saved");
    expect(c.conversation.escalated).toBe(true);
  });

  it("answers already_escalated to a second hand-off after the lead was saved", async () => {
    const escalateToHuman = answering(200, { ok: true });
    const run = createToolRunner({ submitLead: answering(200, { ok: true, leadId: "l" }), escalateToHuman });
    const c = ctx();
    await run("submitLead", LEAD, c);
    await run("escalateToHuman", { reason: "uncertain", summary: "x" }, c);
    const second = await run("escalateToHuman", { reason: "uncertain", summary: "y" }, c);
    expect(second).toMatchObject({ status: "already_escalated" });
    expect(escalateToHuman).toHaveBeenCalledTimes(1);
    expect(c.conversation.status).toBe("lead_saved");
  });
});

describe("anything else", () => {
  it("is an error the model sees, not a crash", async () => {
    const run = createToolRunner({ submitLead: answering(200, {}), escalateToHuman: answering(200, {}) });
    expect(await run("createConsultationEvent", {}, ctx())).toMatchObject({ status: "error", isError: true });
  });

  it.each(["submitLead", "escalateToHuman"])("turns a %s handler that throws into an error outcome, leaving the conversation as it was", async (name) => {
    const boom = vi.fn(async () => {
      throw new Error("insert_http_503");
    });
    const run = createToolRunner({ submitLead: boom, escalateToHuman: boom });
    const c = ctx();
    const outcome = await run(name, { ...LEAD, reason: "complaint", summary: "x" }, c);
    expect(outcome).toMatchObject({ name, status: "error", isError: true });
    expect(outcome.leadSaved ?? false).toBe(false);
    expect(outcome.escalated ?? false).toBe(false);
    expect(JSON.parse(outcome.forModel)).toMatchObject({ ok: false });
    expect(c.conversation).toMatchObject({ status: "open", escalated: false });
  });
});

describe("a partial save tells the model to keep talking", () => {
  // "שמירה שקטה" (a silent save) was read as "say nothing": the reply after it was
  // empty and the turn failed with 503. The answer now says what to do next.
  it.each([false, true])("in evaluation mode %s, the partial answer asks for the next question in the same message", async (evalMode) => {
    const run = createToolRunner({ submitLead: answering(200, { ok: true, leadId: "l1" }), escalateToHuman: answering(200, {}) });
    const out = await run("submitLead", { ...LEAD, stage: "partial" }, ctx({ evalMode }));
    const answer = JSON.parse(out.forModel);
    expect(answer).toMatchObject({ ok: true, stage: "partial" });
    expect(answer.next).toMatch(/המשך/);
  });

  it("a complete save says nothing of the kind: the interview is over", async () => {
    const run = createToolRunner({ submitLead: answering(200, { ok: true, leadId: "l1" }), escalateToHuman: answering(200, {}) });
    const answer = JSON.parse((await run("submitLead", LEAD, ctx())).forModel);
    expect(answer).toEqual({ ok: true, stage: "complete" });
  });

  it("the tool's description says the partial save is not mentioned but the conversation goes on", () => {
    expect(INTERVIEW_TOOLS[0].description).toMatch(/המשך באותה הודעה/);
  });
});

const articleSource = (over: Partial<ArticleSource> = {}): ArticleSource => ({
  list: vi.fn(async () => [{ slug: "dmei-nihul", title: "דמי ניהול", excerpt: "מה הם", tags: "פנסיה" }]),
  read: vi.fn(async (slug: string) => (slug === "dmei-nihul" ? { slug, title: "דמי ניהול", body: "גוף המאמר", truncated: false } : null)),
  ...over,
});
const supportCtx = (over: Partial<ToolCallContext> = {}) => ctx({ agent: "support_agent", ...over });

describe("the support tool set", () => {
  it("is the two article tools and the hand-off, and never submitLead", () => {
    expect(SUPPORT_TOOLS.map((t) => t.name)).toEqual(["listArticles", "readArticle", "escalateToHuman"]);
    expect(SUPPORT_TOOLS).toContain(ESCALATE_TOOL);
    expect(INTERVIEW_TOOLS).toContain(ESCALATE_TOOL);
  });

  it("asks the model for nothing but a slug when reading", () => {
    expect(LIST_ARTICLES_TOOL.input_schema).toEqual({ type: "object", properties: {} });
    expect(READ_ARTICLE_TOOL.input_schema).toMatchObject({ required: ["slug"], properties: { slug: { type: "string" } } });
  });
});

describe("listArticles / readArticle", () => {
  const run = (articles: ArticleSource) => createToolRunner({ submitLead: answering(200, {}), escalateToHuman: answering(200, {}) }, articles);

  it("lists the published articles for the model, with their slugs", async () => {
    const out = await run(articleSource())("listArticles", {}, supportCtx());
    expect(out).toMatchObject({ name: "listArticles", status: "ok", isError: false });
    expect(JSON.parse(out.forModel)).toEqual({ ok: true, articles: [{ slug: "dmei-nihul", title: "דמי ניהול", excerpt: "מה הם", tags: "פנסיה" }] });
  });

  it("reads an article by slug, saying when it was cut", async () => {
    const out = await run(articleSource())("readArticle", { slug: "dmei-nihul" }, supportCtx());
    expect(JSON.parse(out.forModel)).toEqual({ ok: true, slug: "dmei-nihul", title: "דמי ניהול", body: "גוף המאמר", truncated: false });
  });

  it("answers not_found for a slug no published article has, as a tool error the model can handle", async () => {
    const out = await run(articleSource())("readArticle", { slug: "invented-slug" }, supportCtx());
    expect(out).toMatchObject({ name: "readArticle", status: "error", isError: true });
    expect(JSON.parse(out.forModel)).toEqual({ ok: false, error: "not_found" });
  });

  it("passes a non-string slug through as nothing, never as text", async () => {
    const articles = articleSource();
    await run(articles)("readArticle", { slug: { $ne: 1 } }, supportCtx());
    expect(articles.read).toHaveBeenCalledWith("");
  });

  it("reads real articles in evaluation mode too: reading changes nothing", async () => {
    const articles = articleSource();
    await run(articles)("listArticles", {}, supportCtx({ evalMode: true }));
    expect(articles.list).toHaveBeenCalled();
  });

  it("turns a failing article store into tool_failed, not a crashed turn", async () => {
    const out = await run(articleSource({ list: vi.fn(async () => { throw new Error("select_http_500"); }) }))("listArticles", {}, supportCtx());
    expect(JSON.parse(out.forModel)).toEqual({ ok: false, error: "tool_failed" });
  });
});
