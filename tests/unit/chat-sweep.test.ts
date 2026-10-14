import { describe, expect, it, vi } from "vitest";
import {
  SHEET_LOG_BATCH,
  SHEET_LOG_IDLE_MS,
  SHEET_LOGGED_ROLES,
  createSheetLogSweep,
  sheetRow,
} from "../../supabase/functions/chat/sweep.ts";

const m = (role: "user" | "assistant" | "tool", content: string) => ({ role, content });

describe("sheetRow", () => {
  it("is the visitor's first question as the topic, the transcript without tool rows, and the count", () => {
    const row = sheetRow([m("user", "  מה זה דמי ניהול?  "), m("tool", "listArticles: ok"), m("assistant", "דמי ניהול הם…")], false);
    expect(row).toEqual({
      topic: "מה זה דמי ניהול?",
      transcript: "מבקר:   מה זה דמי ניהול?  \nעוזר: דמי ניהול הם…",
      outcome: "answered",
      messageCount: 2,
    });
  });

  it.each([
    ["escalated", [m("user", "q"), m("assistant", "a")], true],
    ["escalated", [m("user", "q"), m("assistant", "a"), m("user", "עוד")], true],
    ["referred_to_interview", [m("user", "q"), m("assistant", "[לשיחה קצרה עם דורית](/#start)")], false],
    ["abandoned", [m("user", "q"), m("assistant", "a"), m("user", "עוד שאלה")], false],
    ["abandoned", [m("user", "q")], false],
    ["answered", [m("user", "q"), m("assistant", "ראו [דמי ניהול](/blog/dmei-nihul)")], false],
  ] as const)("outcome %s", (outcome, messages, escalated) => {
    expect(sheetRow([...messages], escalated)?.outcome).toBe(outcome);
  });

  it("cuts the topic to 200 characters", () => {
    expect(sheetRow([m("user", "א".repeat(300)), m("assistant", "a")], false)?.topic).toHaveLength(200);
  });

  it("is nothing for a conversation with no visitor message", () => {
    expect(sheetRow([m("assistant", "שלום")], false)).toBeNull();
    expect(sheetRow([], false)).toBeNull();
  });
});

describe("the sweep", () => {
  const SAVED = { ok: true, rid: "x", sheet: "נרשם ✓ — https://docs.google.com/spreadsheets/d/s/edit" };
  const conv = (id: string, over = {}) => ({ id, agency_id: "a", role: "support", status: "open", escalated_at: null, ...over });
  const setup = (claimed: Record<string, unknown>[], messages: Record<string, ReturnType<typeof m>[]>) => {
    const store = {
      claimSheetLogs: vi.fn(async (_roles: readonly string[], _cutoff: string, _now: string, _limit: number) => claimed),
      listMessages: vi.fn(async (id: string) => messages[id] ?? []),
    };
    const logSupportChat = vi.fn(async (_req: Request) => Response.json(SAVED));
    const log = vi.fn();
    const sweep = createSheetLogSweep({ store: store as never, logSupportChat, now: () => Date.UTC(2026, 9, 14, 10, 0), log });
    return { store, logSupportChat, log, sweep };
  };
  const sent = async (fn: ReturnType<typeof vi.fn>, call = 0) => (fn.mock.calls[call][0] as Request).json();

  it("claims a batch of support conversations idle for 30 minutes, then logs each through log-support-chat", async () => {
    const { store, logSupportChat, sweep } = setup([conv("c1")], { c1: [m("user", "q"), m("assistant", "a")] });
    expect(await sweep("rid1")).toBe(1);
    const [roles, cutoff, now, limit] = store.claimSheetLogs.mock.calls[0];
    expect(roles).toEqual(["support"]);
    expect(SHEET_LOGGED_ROLES).toEqual(["support"]);
    expect(now).toBe("2026-10-14T10:00:00.000Z");
    expect(Date.parse(now) - Date.parse(cutoff)).toBe(SHEET_LOG_IDLE_MS);
    expect(limit).toBe(SHEET_LOG_BATCH);
    const req = logSupportChat.mock.calls[0][0] as Request;
    expect(req.method).toBe("POST");
    expect(await req.json()).toEqual({ channel: "site", topic: "q", transcript: "מבקר: q\nעוזר: a", outcome: "answered", messageCount: 2 });
  });

  it("counts an escalated conversation as escalated", async () => {
    const { logSupportChat, sweep } = setup([conv("c1", { escalated_at: "2026-10-14T09:00:00Z" })], { c1: [m("user", "q"), m("assistant", "a")] });
    await sweep("r");
    expect((await sent(logSupportChat)).outcome).toBe("escalated");
  });

  it("sends no phone: the chat has none, and the model is never asked for one", async () => {
    const { logSupportChat, sweep } = setup([conv("c1")], { c1: [m("user", "q"), m("assistant", "a")] });
    await sweep("r");
    expect(await sent(logSupportChat)).not.toHaveProperty("phone");
  });

  it("skips a claimed conversation with nothing to log, and keeps going after one that throws", async () => {
    const { logSupportChat, log, sweep } = setup([conv("empty"), conv("boom"), conv("ok")], {
      empty: [m("assistant", "שלום")],
      boom: [m("user", "q"), m("assistant", "a")],
      ok: [m("user", "q2"), m("assistant", "a2")],
    });
    logSupportChat.mockImplementationOnce(async () => {
      throw new Error("sheet down");
    });
    expect(await sweep("r")).toBe(1);
    expect(logSupportChat).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("info", "sweep.nothing_to_log", { rid: "r", conversation: "empty" });
    expect(log).toHaveBeenCalledWith("error", "sweep.log_failed", expect.objectContaining({ conversation: "boom" }));
    expect(log).toHaveBeenCalledWith("info", "sweep.done", { rid: "r", claimed: 3, logged: 1 });
  });

  it.each([
    ["a refusal", () => Response.json({ error: "אין מה לרשום", rid: "x" }, { status: 400 }), 400],
    ["a failed append, which log-support-chat answers 200 with a warning", () => Response.json({ ok: true, rid: "x", sheet: "נכשל", warnings: ["sheet_append_failed"] }), 200],
  ])("does not count %s as logged, and says so", async (_name, answer, status) => {
    const { logSupportChat, log, sweep } = setup([conv("c1")], { c1: [m("user", "q"), m("assistant", "a")] });
    logSupportChat.mockImplementationOnce(async () => answer());
    expect(await sweep("r")).toBe(0);
    expect(log).toHaveBeenCalledWith("warn", "sweep.not_logged", { rid: "r", conversation: "c1", status, outcome: "answered" });
  });

  it("logs nothing when nothing is claimed — a second overlapping sweep finds the rows already taken", async () => {
    const { logSupportChat, store, sweep } = setup([], {});
    expect(await sweep("r")).toBe(0);
    expect(store.listMessages).not.toHaveBeenCalled();
    expect(logSupportChat).not.toHaveBeenCalled();
  });

  it("lets a failed claim fail the sweep, so the route reports it", async () => {
    const { store, sweep } = setup([], {});
    store.claimSheetLogs.mockRejectedValueOnce(new Error("select_http_503"));
    await expect(sweep("r")).rejects.toThrow("select_http_503");
  });
});
