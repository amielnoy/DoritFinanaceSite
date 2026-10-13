import { describe, expect, it } from "vitest";
import { fillPlaceholders, systemBlocks } from "../../supabase/functions/chat/prompt.ts";
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

describe("systemBlocks('interview')", () => {
  const blocks = systemBlocks("interview");

  it("is compliance, then the role, then the profile", () => {
    expect(blocks).toHaveLength(3);
    expect(blocks[0].text).toMatch(/^## 3\./);
    expect(blocks[1].text).toMatch(/סוכן ההיכרות האוטומטי של דורית גוב ארי/);
    expect(blocks[2].text).toMatch(/^## הסוכנות שבשמה אתה פועל/);
  });

  it("caches the fixed prefix: the breakpoint is on the role block", () => {
    expect(blocks.map((b) => b.cache_control?.type ?? null)).toEqual([null, "ephemeral", null]);
  });

  it("leaves no placeholder unfilled", () => {
    for (const b of blocks) expect(b.text).not.toMatch(/\{\{agency\./);
  });

  it("asks for a submitLead call, never a fenced block", () => {
    expect(blocks[1].text).not.toMatch(/```lead/);
    expect(blocks[1].text).toMatch(/submitLead עם stage='complete'/);
  });
});
