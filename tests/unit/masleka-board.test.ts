import { describe, expect, it, vi } from "vitest";
import { addBusinessDays } from "../../supabase/functions/_shared/business-days.ts";
import * as edge from "../../supabase/functions/_shared/masleka.ts";
import {
  actionFor,
  boardTime,
  nowRows,
  planRows,
  stageRows,
  viewFromParam,
  BOARD_VIEWS,
  READY_AFTER_MS,
  clientMessage,
  copyOrFallback,
  daysUntil,
  deletionLabel,
  isPlausibleCode,
  staffMessage,
  readTokenFromHash,
  readinessLabel,
} from "@/lib/masleka";
import { MaslekaError, type MaslekaFailure, type MaslekaRequest } from "@/services/ports";

const NOW = new Date("2026-10-13T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (offset: number) => new Date(NOW.getTime() + offset).toISOString();

const request = (over: Partial<MaslekaRequest>): MaslekaRequest => ({
  id: "r", clientName: "לקוח", contactEmail: null, status: "invited", leadId: null, idLast4: null,
  createdAt: iso(-DAY), tokenExpiresAt: null, clientInvitedAt: null, codeReceivedAt: null,
  submittedAt: null, clearinghouseDeletesAt: null, completedAt: null, ...over,
});

/** The board's "needs action" rule (the redesign's step 3), with no page. */
describe("actionFor", () => {
  const none = new Map<string, string>();

  it("sends a received code to the guided submit, saying when it came and the ID's last digits", () => {
    const plan = actionFor(request({ status: "code_received", codeReceivedAt: iso(-HOUR), idLast4: "0018" }), NOW, none);
    expect(plan).toMatchObject({ step: 2, stage: "code_received", needsAction: true, urgent: false, action: { kind: "submit", label: "להגשה" } });
    expect(plan.reason).toBe(`קוד האימות התקבל ${boardTime(iso(-HOUR))} · ת״ז מסתיימת ב־0018`);
    expect(actionFor(request({ status: "code_received", codeReceivedAt: iso(-HOUR) }), NOW, none).reason).not.toContain("ת״ז");
  });

  it("sends a ready download to the clearinghouse, with its deletion countdown", () => {
    const plan = actionFor(request({ status: "submitted", submittedAt: iso(-6 * HOUR), clearinghouseDeletesAt: iso(5 * DAY) }), NOW, none);
    expect(plan).toMatchObject({ step: 3, needsAction: true, urgent: false, action: { kind: "download", label: "להורדה במסלקה" } });
    expect(plan.reason).toBe("מוכן להורדה · 5 ימים עד מחיקה במסלקה");
  });

  it("marks a ready download urgent two days or fewer before the clearinghouse deletes it", () => {
    const at = (days: number) => actionFor(request({ status: "submitted", submittedAt: iso(-6 * HOUR), clearinghouseDeletesAt: iso(days * DAY) }), NOW, none);
    expect(at(3).urgent).toBe(false);
    expect(at(2).urgent).toBe(true);
    expect(at(1).urgent).toBe(true);
    expect(at(1).reason).toBe("מוכן להורדה · יום אחד עד מחיקה במסלקה");
  });

  it("asks nothing of a submission still being prepared", () => {
    const plan = actionFor(request({ status: "submitted", submittedAt: iso(-HOUR), clearinghouseDeletesAt: iso(DAY) }), NOW, none);
    expect(plan).toMatchObject({ step: 3, needsAction: false, urgent: false, action: { kind: "none", label: "אין צורך בפעולה" } });
    expect(plan.reason).toBe(`הוגש ${boardTime(iso(-HOUR))} · יהיה מוכן בעוד כ־3–4 שעות`);
    expect(READY_AFTER_MS).toBe(4 * HOUR);
  });

  it("offers an invited client a fresh link always, and puts them in 'now' only after three days", () => {
    const fresh = actionFor(request({ status: "invited", clientInvitedAt: iso(-2 * DAY) }), NOW, none);
    expect(fresh).toMatchObject({ step: 1, needsAction: false, action: { kind: "relink", label: "קישור חדש" } });
    expect(fresh.reason).toBe("קיבל/ה קישור לפני 2 ימים ועוד לא מילא/ה");
    const stale = actionFor(request({ status: "invited", clientInvitedAt: iso(-4 * DAY) }), NOW, none);
    expect(stale).toMatchObject({ needsAction: true, action: { kind: "relink" } });
    expect(stale.reason).toBe("קיבל/ה קישור לפני 4 ימים ועוד לא מילא/ה");
  });

  it("counts an invitation from its creation when it was never mailed, and says today and yesterday in words", () => {
    expect(actionFor(request({ status: "invited", createdAt: iso(-5 * DAY) }), NOW, none).needsAction).toBe(true);
    expect(actionFor(request({ status: "invited", createdAt: iso(-HOUR) }), NOW, none).reason).toBe("קיבל/ה קישור היום ועוד לא מילא/ה");
    expect(actionFor(request({ status: "invited", createdAt: iso(-DAY) }), NOW, none).reason).toBe("קיבל/ה קישור אתמול ועוד לא מילא/ה");
  });

  it("links a completed request to its analysis when there is one, and is never 'now'", () => {
    const done = request({ id: "c1", status: "completed", completedAt: iso(-DAY) });
    expect(actionFor(done, NOW, new Map([["c1", "snap-1"]]))).toMatchObject({
      step: 4, needsAction: false, reason: `הושלם ${boardTime(iso(-DAY))}`, action: { kind: "analysis", label: "לניתוח", snapshotId: "snap-1" },
    });
    expect(actionFor(done, NOW, none).action.kind).toBe("none");
  });
});

describe("nowRows and stageRows", () => {
  const none = new Map<string, string>();
  const rows = planRows(
    [
      request({ id: "invited-new", status: "invited", clientInvitedAt: iso(-DAY) }),
      request({ id: "invited-old", status: "invited", clientInvitedAt: iso(-10 * DAY) }),
      request({ id: "code", status: "code_received", codeReceivedAt: iso(-2 * HOUR) }),
      request({ id: "ready", status: "submitted", submittedAt: iso(-30 * HOUR), clearinghouseDeletesAt: iso(5 * DAY) }),
      request({ id: "urgent", status: "submitted", submittedAt: iso(-6 * HOUR), clearinghouseDeletesAt: iso(DAY) }),
      request({ id: "preparing", status: "submitted", submittedAt: iso(-HOUR), clearinghouseDeletesAt: iso(9 * DAY) }),
      request({ id: "done", status: "completed", completedAt: iso(-DAY) }),
      request({ id: "gone", status: "expired" }),
    ],
    NOW,
    none,
  );

  it("drops what left the board", () => {
    expect(rows.map((r) => r.request.id)).not.toContain("gone");
  });

  it("puts the urgent first, then the oldest first, and only what needs action", () => {
    expect(nowRows(rows).map((r) => r.request.id)).toEqual(["urgent", "invited-old", "ready", "code"]);
  });

  it("lists one stage oldest first, and the completed newest first", () => {
    // Ready since 26 h ago, ready since 2 h ago, submitted an hour ago.
    expect(stageRows(rows, "submitted").map((r) => r.request.id)).toEqual(["ready", "urgent", "preparing"]);
    expect(stageRows(rows, "invited").map((r) => r.request.id)).toEqual(["invited-old", "invited-new"]);
  });
});

describe("the stage bar's views", () => {
  it("reads ?stage= as one of the bar's views, and anything else as 'now'", () => {
    expect(BOARD_VIEWS.map((v) => v.view)).toEqual(["now", "invited", "code_received", "submitted", "completed"]);
    for (const v of ["invited", "code_received", "submitted", "completed", "now"]) expect(viewFromParam(v)).toBe(v);
    for (const v of [null, "", "waiting", "SUBMITTED", "<script>"]) expect(viewFromParam(v)).toBe("now");
  });
});

describe("readinessLabel", () => {
  it("says when the files should be ready, then that they are", () => {
    expect(readinessLabel(iso(-2 * HOUR), NOW)).toBe("מוכן בעוד כ־3–4 שעות");
    expect(readinessLabel(iso(-4 * HOUR), NOW)).toBe("מוכן להורדה");
    expect(readinessLabel(null, NOW)).toBe("");
  });
});

describe("deletionLabel", () => {
  it("counts the days the clearinghouse still keeps the files", () => {
    expect(daysUntil(iso(5 * DAY), NOW)).toBe(5);
    expect(deletionLabel(iso(5 * DAY), NOW)).toBe("5 ימים עד מחיקה במסלקה");
    expect(deletionLabel(iso(DAY), NOW)).toBe("יום אחד עד מחיקה במסלקה");
    expect(deletionLabel(iso(12 * HOUR), NOW)).toBe("יום אחד עד מחיקה במסלקה");
  });

  it("says when they are gone, and nothing when there is no date", () => {
    expect(deletionLabel(iso(-HOUR), NOW)).toBe("נמחק במסלקה");
    expect(deletionLabel(null, NOW)).toBe("");
    expect(daysUntil("not a date", NOW)).toBeNull();
  });
});

describe("copyOrFallback", () => {
  it("copies when the clipboard works", async () => {
    const clipboard = { writeText: vi.fn(async () => {}) };
    expect(await copyOrFallback("000000018", clipboard)).toBe("copied");
    expect(clipboard.writeText).toHaveBeenCalledWith("000000018");
  });

  it("falls back when there is no clipboard (a non-secure page, an old browser)", async () => {
    expect(await copyOrFallback("000000018", null)).toBe("manual");
    expect(await copyOrFallback("000000018", undefined)).toBe("manual");
    expect(await copyOrFallback("000000018", {} as never)).toBe("manual");
  });

  it("falls back when the browser refuses, however it refuses", async () => {
    expect(await copyOrFallback("x", { writeText: async () => Promise.reject(new DOMException("denied", "NotAllowedError")) })).toBe("manual");
    expect(await copyOrFallback("x", { writeText: () => { throw new TypeError("no"); } })).toBe("manual");
  });
});

describe("readTokenFromHash", () => {
  const token = "Ab3_-".repeat(8) + "xyz";
  it("reads a token from the link's fragment", () => {
    expect(readTokenFromHash(`#t=${token}`)).toBe(token);
  });
  it("reads nothing else", () => {
    expect(readTokenFromHash("")).toBeNull();
    expect(readTokenFromHash("#t=short")).toBeNull();
    expect(readTokenFromHash(`#x=${token}`)).toBeNull();
    expect(readTokenFromHash(`#t=${token}&utm=1`)).toBeNull();
  });
});

describe("isPlausibleCode", () => {
  it("accepts what the clearinghouse could issue and nothing that carries markup", () => {
    expect(isPlausibleCode(" AB12-CD34 ")).toBe(true);
    expect(isPlausibleCode("ab")).toBe(false);
    expect(isPlausibleCode("<b>x</b>")).toBe(false);
  });
});

describe("the browser and the Edge function agree", () => {
  const SAMPLES = [
    "AB12-CD34", " AB12-CD34 ", "ab", "abc", "abcd", "a".repeat(64), "a".repeat(65), "", "   ",
    "<b>x</b>", "a b c d", "AB12_CD34", "אבגד1234", "1234\n", "----", "ab\u200fcd",
  ];

  it("accepts and refuses the same codes (isPlausibleCode is normalizeCode's pattern)", () => {
    for (const sample of SAMPLES) {
      expect(isPlausibleCode(sample), JSON.stringify(sample)).toBe(edge.normalizeCode(sample) !== null);
    }
  });

  it("waits the same time before the files are ready", () => {
    expect(READY_AFTER_MS).toBe(edge.READY_AFTER_HOURS * 3_600_000);
  });

  it("counts days to the deletion date the way the server set it, across a daylight-saving end", () => {
    // Thursday 22 Oct 2026, 00:30 Israel time (21 Oct 21:30Z), seven business days on.
    const submitted = new Date("2026-10-21T21:30:00Z");
    const deletes = addBusinessDays(submitted, 7);
    // Sun 25, Mon 26 (clock goes back that night), Tue 27, Wed 28, Thu 29, Sun 1 Nov, Mon 2 Nov.
    expect(deletes.toISOString()).toBe("2026-11-01T22:30:00.000Z");
    // 11 Israeli calendar days later, though the span is 11 days + 1 hour.
    expect(daysUntil(deletes.toISOString(), submitted)).toBe(11);
    expect(deletionLabel(deletes.toISOString(), submitted)).toBe("11 ימים עד מחיקה במסלקה");
  });

  it("reads the day in Israel, not in UTC", () => {
    // 22:30Z Thursday is already Friday in Israel; the next day in Israel is two hours away.
    const now = new Date("2026-10-15T20:30:00Z");
    expect(daysUntil("2026-10-15T21:30:00Z", now)).toBe(1);
    expect(daysUntil("2026-10-15T20:30:00Z", now)).toBe(0);
  });

  it("is business day 5 and 7 after submission for any weekday, counted in calendar days", () => {
    for (let i = 0; i < 7; i += 1) {
      const submitted = new Date(Date.UTC(2026, 9, 11 + i, 9, 0, 0));
      const deletes = addBusinessDays(submitted, 7).toISOString();
      const days = daysUntil(deletes, submitted)!;
      expect(days).toBeGreaterThanOrEqual(9);
      expect(days).toBeLessThanOrEqual(11);
    }
  });
});

describe("copyOrFallback leaves nothing behind", () => {
  const SECRET = "SECRET-CODE-4321";

  function fakeDocument(copyResult: boolean | "throws") {
    const attached: Array<{ value: string; selected: boolean }> = [];
    const log: string[] = [];
    const doc = {
      body: {
        appendChild(el: { value: string; selected: boolean }) { attached.push(el); log.push("append"); return el; },
        removeChild(el: { value: string; selected: boolean }) { attached.splice(attached.indexOf(el), 1); log.push("remove"); return el; },
      },
      createElement() {
        const el = { value: "", selected: false, style: {} as Record<string, string>, readOnly: false,
          setAttribute() {}, focus() {}, select() { el.selected = true; }, setSelectionRange() {}, remove() { doc.body.removeChild(el); } };
        return el;
      },
      execCommand: vi.fn(() => {
        log.push(`copy:${attached[0]?.value}`);
        if (copyResult === "throws") throw new Error("blocked");
        return copyResult;
      }),
    };
    return { doc, attached, log };
  }

  const spyAll = () => {
    const calls: unknown[][] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a) => { calls.push(a); }));
    return { calls, restore: () => spies.forEach((s) => s.mockRestore()) };
  };

  it("copies through a temporary field when the clipboard is missing, and takes the field away at once", async () => {
    const { doc, attached, log } = fakeDocument(true);
    expect(await copyOrFallback(SECRET, undefined, doc as never)).toBe("copied");
    expect(log).toEqual(["append", `copy:${SECRET}`, "remove"]);
    expect(attached).toHaveLength(0);
  });

  it("copies through the field when the clipboard refuses", async () => {
    const { doc, attached } = fakeDocument(true);
    const clipboard = { writeText: async () => Promise.reject(new DOMException("denied", "NotAllowedError")) };
    expect(await copyOrFallback(SECRET, clipboard, doc as never)).toBe("copied");
    expect(attached).toHaveLength(0);
  });

  it("clears the field's value before it is removed", async () => {
    const { doc } = fakeDocument(true);
    const created: Array<{ value: string }> = [];
    const original = doc.createElement;
    doc.createElement = (() => { const el = original(); created.push(el); return el; }) as never;
    await copyOrFallback(SECRET, null, doc as never);
    expect(created).toHaveLength(1);
    expect(created[0].value).toBe("");
  });

  it("says manual, with no field left, when the browser refuses the copy command or throws", async () => {
    for (const result of [false, "throws"] as const) {
      const { doc, attached } = fakeDocument(result);
      expect(await copyOrFallback(SECRET, null, doc as never)).toBe("manual");
      expect(attached).toHaveLength(0);
    }
  });

  it("says manual when there is no document at all", async () => {
    expect(await copyOrFallback(SECRET, null, null)).toBe("manual");
  });

  it("never writes the value to storage or the console, on any path", async () => {
    const stored: string[] = [];
    const storage = { setItem: (_k: string, v: string) => { stored.push(v); }, getItem: () => null };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    const spy = spyAll();
    try {
      for (const result of [true, false, "throws"] as const) {
        await copyOrFallback(SECRET, null, fakeDocument(result).doc as never);
        await copyOrFallback(SECRET, { writeText: async () => { throw new Error(SECRET); } }, fakeDocument(result).doc as never);
      }
      expect(stored).toEqual([]);
      expect(JSON.stringify(spy.calls)).not.toContain(SECRET);
      expect(spy.calls).toEqual([]);
    } finally {
      spy.restore();
      vi.unstubAllGlobals();
    }
  });
});

describe("what the page says when a request fails", () => {
  const ALL: MaslekaFailure[] = [
    "disabled", "link_invalid", "bad_id", "bad_code", "already_submitted", "rate_limited", "unauthorized",
    "forbidden", "not_found", "not_available", "invalid", "invalid_name", "invalid_email", "unavailable", "not_saved",
    "failed",
  ];

  it("has Hebrew copy for every reason, on both pages", () => {
    for (const reason of ALL) {
      for (const say of [clientMessage, staffMessage]) {
        const message = say(new MaslekaError(reason));
        expect(message.text, reason).toMatch(/[\u0590-\u05ff]/);
      }
    }
  });

  it("shows a second הגשתי as a state, not an error (Ruling 18)", () => {
    expect(staffMessage(new MaslekaError("already_submitted"))).toEqual({ tone: "state", text: "כבר סומן כהוגש" });
    for (const reason of ALL.filter((r) => r !== "already_submitted")) {
      expect(staffMessage(new MaslekaError(reason)).tone, reason).toBe("error");
    }
  });

  it("tells a client who tried too often to wait a while, and that the link is not dead", () => {
    const { text, tone } = clientMessage(new MaslekaError("rate_limited"));
    expect(tone).toBe("error");
    expect(text).toContain("נסו שוב בעוד זמן מה");
    expect(text).toContain("הקישור תקין");
    expect(text).not.toContain("אינו תקף");
  });

  it("does not invite a retry after a failure that may have stored the code", () => {
    const { text } = clientMessage(new MaslekaError("failed"));
    expect(text).toContain("ייתכן שהקוד כבר התקבל");
    expect(text).toContain("דורית תיצור קשר");
    expect(text).not.toMatch(/נסו שוב/);
  });

  it("tells a client plainly that a send which stored nothing did not go through, and to send again", () => {
    // Decision 2026-10-14: not "the code may have arrived" — it did not.
    const { text, tone } = clientMessage(new MaslekaError("not_saved"));
    expect(tone).toBe("error");
    expect(text).toBe("השליחה לא עברה והקוד לא נשמר. נסו לשלוח שוב בעוד כמה דקות — הקישור עדיין בתוקף.");
    expect(text).not.toContain("ייתכן");
  });

  it("says a dead link is dead, and a switched-off service is unavailable", () => {
    expect(clientMessage(new MaslekaError("link_invalid")).text).toContain("הקישור");
    expect(clientMessage(new MaslekaError("disabled")).text).toBe("השירות אינו זמין כרגע");
  });

  it("treats anything that is not a MaslekaError as a failure", () => {
    expect(clientMessage(new TypeError("x"))).toEqual(clientMessage(new MaslekaError("failed")));
    expect(staffMessage("boom")).toEqual(staffMessage(new MaslekaError("failed")));
  });
});
