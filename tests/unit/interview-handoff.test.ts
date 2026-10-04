import { describe, expect, it } from "vitest";
import { readHandoff } from "@/lib/interview-handoff";

/**
 * The payload the page carries out of the interview on the agent's behalf.
 *
 * The agent cannot save it: its tool calls are not executed in an anonymous
 * conversation, and every visitor to the site is anonymous. Proven by running
 * the same scripted interview twice against the same build — signed in,
 * `submitLead` fires and everything lands; anonymous, it is never invoked and
 * the agent tells the visitor it could not save. See A-59.
 *
 * So the agent states the summary in a fenced block and the page submits it.
 * Everything below guards the two ways that can go wrong: a visitor seeing the
 * machinery, or an enquiry quietly going nowhere.
 */
describe("interview handoff — reading the agent's closing block", () => {
  const block = (json: string) => `תודה, עמיאל. הסיכום הועבר.\n\n\`\`\`lead\n${json}\n\`\`\``;
  const valid = JSON.stringify({
    name: "רונית אבני",
    phone: "052-7654321",
    email: "ronit@example.com",
    track: "pension",
    meetingTopic: "גמל, השתלמות ופנסיה",
    timing: "יום ראשון בבוקר",
    scheduledAt: "2026-10-11T11:00:00",
    summary: "שכירה, מתעניינת בדמי ניהול",
    profile: { concern: "דמי ניהול", seniority: "" },
  });

  it("reads the summary the page will submit", () => {
    const { summary } = readHandoff(block(valid));
    expect(summary).toMatchObject({
      name: "רונית אבני",
      phone: "052-7654321",
      scheduledAt: "2026-10-11T11:00:00",
    });
  });

  it("never leaves the block on screen", () => {
    const { visible } = readHandoff(block(valid));
    expect(visible, "the visitor can see the machinery").not.toContain("```lead");
    expect(visible).not.toContain("052-7654321");
    expect(visible).toBe("תודה, עמיאל. הסיכום הועבר.");
  });

  it("hides it even when it is broken", () => {
    // The worst version: a visitor reading a half-written JSON blob at the end
    // of an otherwise careful conversation.
    const { visible, summary, malformed } = readHandoff(block('{"name": "רונית", '));
    expect(visible).not.toContain("```");
    expect(visible).not.toContain("name");
    expect(summary).toBeNull();
    expect(malformed, "a broken block must be reported, not ignored").toBe(true);
  });

  it("refuses a payload nobody could be called back on", () => {
    // `submitLead` rejects it anyway. What matters is that the page learns it
    // failed, so it can show the direct channels instead of staying silent.
    for (const missing of [{ phone: "0521234567" }, { name: "רונית" }, {}]) {
      const { summary, malformed } = readHandoff(block(JSON.stringify(missing)));
      expect(summary).toBeNull();
      expect(malformed).toBe(true);
    }
  });

  it("drops empty profile fields rather than sending them", () => {
    // An empty string in the profile renders as a labelled blank row in Dorit's
    // mail, which reads as "asked and unanswered" — a claim about the visitor
    // that nobody made.
    const { summary } = readHandoff(block(valid));
    expect(summary!.profile).toEqual({ concern: "דמי ניהול" });
  });

  it("leaves an ordinary message completely alone", () => {
    const plain = "שאלה טובה. נגיע לזה בפגישה עם דורית.";
    expect(readHandoff(plain)).toEqual({ visible: plain, summary: null, malformed: false });
  });

  it("does not mistake a json block for a handoff", () => {
    // A conversation about pensions can produce fenced JSON for other reasons.
    // Matching one would submit an enquiry nobody agreed to.
    const other = 'הנה דוגמה:\n\n```json\n{"name":"דוגמה","phone":"0500000000"}\n```';
    const { summary, malformed, visible } = readHandoff(other);
    expect(summary).toBeNull();
    expect(malformed).toBe(false);
    expect(visible).toBe(other);
  });

  it("tolerates whitespace and trailing prose around the block", () => {
    const messy = `סיכום\n\n\`\`\`lead\n  ${valid}  \n\`\`\`\n\nנתראה בפגישה.`;
    const { summary, visible } = readHandoff(messy);
    expect(summary!.name).toBe("רונית אבני");
    expect(visible).toBe("סיכום\n\nנתראה בפגישה.");
  });
});
