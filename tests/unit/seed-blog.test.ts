import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs tooling, imported for its pure planning step.
import { planSeed, mirrorRow, parseArticle, readExecResult } from "../../scripts/seed-blog.mjs";

/**
 * Seeding writes the repo's articles to both stores.
 *
 * Base44 is still what the site and the blog recommender read, so it is
 * written first and its id ties the Supabase copy to it — the same contract
 * `contentAdmin` keeps for edits made from /admin/blog. What is worth pinning
 * is what a re-run must not do: overwrite Dorit's decision to publish.
 */
const article = (over: Record<string, unknown> = {}) => ({
  file: "horadat-dmei-nihul.md",
  title: "להוריד דמי ניהול בפנסיה",
  excerpt: "תקציר",
  tags: "פנסיה, דמי ניהול",
  image_url: "",
  published: false,
  body: "גוף",
  ...over,
});

describe("planSeed", () => {
  it("creates an article Base44 has never seen, as a draft", () => {
    const [step] = planSeed([article()], []);
    expect(step.op).toBe("create");
    expect(step.payload.published).toBe(false);
  });

  it("updates the post with the same title instead of adding a second one", () => {
    const [step] = planSeed([article()], [{ id: "b44-7", title: "להוריד דמי ניהול בפנסיה", published: false }]);
    expect(step.op).toBe("update");
    expect(step.id).toBe("b44-7");
  });

  it("leaves a published post published when the content is re-seeded", () => {
    // The file says draft — every repo article does. A post Dorit has since
    // published from /admin/blog must not quietly come down because the copy
    // was corrected.
    const [step] = planSeed([article()], [{ id: "b44-7", title: "להוריד דמי ניהול בפנסיה", published: true }]);
    expect(step.payload).not.toHaveProperty("published");
    expect(step.published).toBe(true);
  });
});

describe("mirrorRow", () => {
  it("carries the Base44 id, so the two copies are one row", () => {
    const [step] = planSeed([article()], []);
    const row = mirrorRow(step, "b44-new");
    expect(row.base44_id).toBe("b44-new");
    expect(row.title).toBe("להוריד דמי ניהול בפנסיה");
    expect(row.published).toBe(false);
  });

  it("mirrors the published state Base44 actually holds", () => {
    const [step] = planSeed([article()], [{ id: "b44-7", title: "להוריד דמי ניהול בפנסיה", published: true }]);
    expect(mirrorRow(step, "b44-7").published).toBe(true);
  });

  it("carries the action time from the front matter to both stores", () => {
    const parsed = parseArticle('---\ntitle: "כותרת"\ntags: "פנסיה"\naction_time: "רבע שעה"\n---\nגוף');
    expect(parsed.action_time).toBe("רבע שעה");
    const [step] = planSeed([{ ...article(), ...parsed }], []);
    expect(step.payload.action_time).toBe("רבע שעה");
    expect(mirrorRow(step, "b44-new").action_time).toBe("רבע שעה");
  });

  it("sends an empty action time for an article that has none", () => {
    expect(parseArticle('---\ntitle: "כותרת"\n---\nגוף').action_time).toBe("");
  });
});

describe("readExecResult", () => {
  it("finds the marked result among the CLI's own output", () => {
    // npm's notices and the CLI's update banner share stdout with the script.
    const stdout = [
      "npm notice run base44-app@0.0.0 npx",
      '@@seed-blog@@[{"id":"b44-7","title":"t","published":true}]',
      "Update available: 0.1.15 → 0.1.27.",
    ].join("\n");
    expect(readExecResult(stdout)).toEqual([{ id: "b44-7", title: "t", published: true }]);
  });

  it("says the CLI may be signed out rather than parsing nothing", () => {
    expect(() => readExecResult("Not logged in\n")).toThrow(/base44 login/);
  });
});
