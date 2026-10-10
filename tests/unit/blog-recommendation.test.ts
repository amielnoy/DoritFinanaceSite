import { describe, expect, it } from "vitest";
import { readRecommendation } from "@/lib/blog-recommendation";

/**
 * The reading-recommender's closing signal, carried out of the conversation
 * by the page.
 *
 * The agent writes its recommendation as prose — title, why it is relevant,
 * a `/blog/<id>` link — which is for the visitor to read, not for the page
 * to parse reliably. So, mirroring the interview agent's `lead` block, it
 * also states the chosen ids in a fenced block the page reads and the
 * visitor never sees, used only to highlight and scroll to the matching
 * cards already on the page.
 */
describe("blog recommendation — reading the agent's closing block", () => {
  const block = (json: string) =>
    `דורית ממליצה לקרוא על "דמי ניהול בפנסיה" — רלוונטי למה שתיארת.\n\n\`\`\`recommended\n${json}\n\`\`\``;

  it("reads the recommended ids", () => {
    const { ids } = readRecommendation(block(JSON.stringify(["abc123", "def456"])));
    expect(ids).toEqual(["abc123", "def456"]);
  });

  it("never leaves the block on screen", () => {
    const { visible } = readRecommendation(block(JSON.stringify(["abc123"])));
    expect(visible, "the visitor can see the machinery").not.toContain("```recommended");
    expect(visible).not.toContain("abc123");
    expect(visible).toBe('דורית ממליצה לקרוא על "דמי ניהול בפנסיה" — רלוונטי למה שתיארת.');
  });

  it("hides it even when it is broken", () => {
    const { visible, ids, malformed } = readRecommendation(block("[\"abc123\", "));
    expect(visible).not.toContain("```");
    expect(visible).not.toContain("abc123");
    expect(ids).toEqual([]);
    expect(malformed, "a broken block must be reported, not ignored").toBe(true);
  });

  it("rejects a block that is not an array of ids", () => {
    for (const bad of ['{"id": "abc123"}', "123", '["abc123", 7]', '[""]']) {
      const { ids, malformed } = readRecommendation(block(bad));
      expect(ids).toEqual([]);
      expect(malformed).toBe(true);
    }
  });

  it("leaves an ordinary message completely alone", () => {
    const plain = "אשמח לעזור, איזה נושא פיננסי מעניין אותך?";
    expect(readRecommendation(plain)).toEqual({ visible: plain, ids: [], malformed: false });
  });

  it("does not mistake a json block from another agent for a recommendation", () => {
    const other = 'תודה, עמיאל. הסיכום הועבר.\n\n```lead\n{"name":"עמיאל","phone":"0500000000"}\n```';
    const { ids, malformed, visible } = readRecommendation(other);
    expect(ids).toEqual([]);
    expect(malformed).toBe(false);
    expect(visible).toBe(other);
  });

  it("tolerates whitespace and trailing prose around the block", () => {
    const messy = `המלצות\n\n\`\`\`recommended\n  ${JSON.stringify(["abc123"])}  \n\`\`\`\n\nבהצלחה בקריאה.`;
    const { ids, visible } = readRecommendation(messy);
    expect(ids).toEqual(["abc123"]);
    expect(visible).toBe("המלצות\n\nבהצלחה בקריאה.");
  });

  it("drops an empty id list rather than treating it as malformed", () => {
    // The agent is told to pick up to 3 — zero relevant matches is a valid
    // outcome, not a parsing failure, and must not be reported as malformed.
    const { ids, malformed } = readRecommendation(block("[]"));
    expect(ids).toEqual([]);
    expect(malformed).toBe(false);
  });
});
