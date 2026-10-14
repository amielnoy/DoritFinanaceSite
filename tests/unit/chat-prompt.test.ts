import { describe, expect, it } from "vitest";
import { fillPlaceholders, systemBlocks, todayBlock } from "../../supabase/functions/chat/prompt.ts";
import { AGENCY } from "../../supabase/functions/_shared/agency.ts";

describe("fillPlaceholders", () => {
  it("fills every agency placeholder", () => {
    expect(fillPlaceholders("{{agency.displayName}} · {{agency.phoneDisplay}}")).toBe(`${AGENCY.displayName} · ${AGENCY.phoneDisplay}`);
  });

  it("refuses a placeholder the agency has no value for", () => {
    expect(() => fillPlaceholders("{{agency.fax}}")).toThrow(/agency\.fax/);
  });

  it("leaves text without placeholders alone, braces included", () => {
    expect(fillPlaceholders("{x} {{y}}")).toBe("{x} {{y}}");
  });
});

// Wed 14 Oct 2026, 21:30 UTC = Thu 15 Oct, 00:30 in Israel (IDT, UTC+3).
const NOW = Date.UTC(2026, 9, 14, 21, 30);

describe("systemBlocks('interview')", () => {
  const blocks = systemBlocks("interview", NOW);

  it("is compliance, then the role, then the profile, then today's date", () => {
    expect(blocks).toHaveLength(4);
    expect(blocks[0].text).toMatch(/^## 3\./);
    expect(blocks[1].text).toMatch(/סוכן ההיכרות האוטומטי של דורית גוב ארי/);
    expect(blocks[2].text).toMatch(/^## הסוכנות שבשמה אתה פועל/);
    expect(blocks[3]).toEqual(todayBlock(NOW));
  });

  it("caches the fixed prefix: the breakpoint is on the role block, and the date comes after it", () => {
    expect(blocks.map((b) => b.cache_control?.type ?? null)).toEqual([null, "ephemeral", null, null]);
  });
});

describe("todayBlock", () => {
  // The interview turns "Thursday" and "tomorrow" into a calendar date for
  // scheduledAt (prompts/interview.md). Without today's date the model asked the
  // visitor for it, and the evaluation of 2026-10-14 ran three interviews out of
  // turns on that question.
  it("states today's date, weekday and time in Israel, not UTC", () => {
    const { text } = todayBlock(NOW);
    expect(text).toContain("יום חמישי, 15.10.2026, 00:30 (שעון ישראל)");
    expect(text).toContain("היום הוא 2026-10-15");
  });

  it("lists the next 14 days with weekday and ISO date, so no date arithmetic is left to the model", () => {
    const lines = todayBlock(NOW).text.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(14);
    expect(lines[0]).toBe("- יום חמישי 15.10 (היום) — 2026-10-15");
    expect(lines[1]).toBe("- יום שישי 16.10 (מחר) — 2026-10-16");
    expect(lines[3]).toBe("- יום ראשון 18.10 — 2026-10-18");
    expect(lines[13]).toBe("- יום רביעי 28.10 — 2026-10-28");
  });

  it("follows the clock change: the night of 25 Oct 2026 Israel moves to UTC+2", () => {
    // Sun 25 Oct 2026, 22:30 UTC = Mon 26 Oct, 00:30 in Israel (IST, UTC+2).
    expect(todayBlock(Date.UTC(2026, 9, 25, 22, 30)).text).toContain("יום שני, 26.10.2026, 00:30 (שעון ישראל)");
  });

  it("is not cached: it changes every minute", () => {
    expect(todayBlock(NOW).cache_control).toBeUndefined();
  });
});

describe("systemBlocks('interview'), the role text", () => {
  const blocks = systemBlocks("interview", NOW);

  it("leaves no placeholder unfilled", () => {
    for (const b of blocks) expect(b.text).not.toMatch(/\{\{agency\./);
  });

  it("asks for a submitLead call, never a fenced block", () => {
    expect(blocks[1].text).not.toMatch(/```lead/);
    expect(blocks[1].text).toMatch(/submitLead עם stage='complete'/);
  });
});
