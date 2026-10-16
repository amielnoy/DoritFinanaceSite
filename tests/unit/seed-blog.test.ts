import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs tooling, imported for its pure planning step.
import { planSeed, mirrorRow, parseArticle, readExecResult, selectArticles, slugFromFile } from "../../scripts/seed-blog.mjs";

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
  slug: "horadat-dmei-nihul",
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

  it("carries cta_headline and og_image to Supabase only (Base44's BlogPost has neither)", () => {
    const parsed = parseArticle(
      '---\ntitle: "כותרת"\ncta_headline: "רוצים לדעת כמה אתם משלמים?"\nog_image: "https://cdn.example/share.jpg"\n---\nגוף',
    );
    const [step] = planSeed([{ ...article(), ...parsed }], []);
    expect(step.payload).not.toHaveProperty("cta_headline");
    expect(step.payload).not.toHaveProperty("og_image");
    expect(mirrorRow(step, "b44-new")).toMatchObject({
      cta_headline: "רוצים לדעת כמה אתם משלמים?",
      og_image: "https://cdn.example/share.jpg",
    });
  });

  it("mirrors an article without them as null, which the column checks accept (an empty string is refused)", () => {
    const [step] = planSeed([{ ...article(), ...parseArticle('---\ntitle: "כותרת"\n---\nגוף') }], []);
    expect(mirrorRow(step, "b44-new")).toMatchObject({ cta_headline: null, og_image: null });
  });
});

describe("readExecResult", () => {
  it("finds the marked result among the CLI's own output", () => {
    // npm's notices and the CLI's update banner share stdout with the script.
    const stdout = [
      "npm notice run dorit-finance-site@0.0.0 npx",
      '@@seed-blog@@[{"id":"b44-7","title":"t","published":true}]',
      "Update available: 0.1.15 → 0.1.27.",
    ].join("\n");
    expect(readExecResult(stdout)).toEqual([{ id: "b44-7", title: "t", published: true }]);
  });

  it("says the CLI may be signed out rather than parsing nothing", () => {
    expect(() => readExecResult("Not logged in\n")).toThrow(/base44 login/);
  });
});

describe("the article's address", () => {
  it("mirrors the file name as the slug, and keeps it out of the Base44 payload", () => {
    const [step] = planSeed([article()], []);
    expect(step.payload).not.toHaveProperty("slug");
    expect(mirrorRow(step, "b44-new").slug).toBe("horadat-dmei-nihul");
  });

  it("takes the slug from the file name", () => {
    expect(slugFromFile("horadat-dmei-nihul.md")).toBe("horadat-dmei-nihul");
  });

  it("refuses a file name that cannot be an address", () => {
    expect(() => slugFromFile("Horadat Dmei.md")).toThrow(/kebab-case/);
  });
});

/** `--only`: a new article goes up without re-writing the others over edits made in /admin/blog. */
describe("selectArticles", () => {
  const all = [{ file: "mutavim.md" }, { file: "tofes-101.md" }, { file: "shana-lifnei-prisha.md" }];

  it("takes every article when --only is not given", () => {
    expect(selectArticles(all, undefined)).toEqual(all);
  });

  it("takes only the named ones, with or without .md, in either spelling of the list", () => {
    expect(selectArticles(all, "shana-lifnei-prisha.md,mutavim").map((a: { file: string }) => a.file)).toEqual(["mutavim.md", "shana-lifnei-prisha.md"]);
    expect(selectArticles(all, " tofes-101 , ").map((a: { file: string }) => a.file)).toEqual(["tofes-101.md"]);
  });

  it("refuses a name with no article file, and an empty list, so a typo seeds nothing", () => {
    expect(() => selectArticles(all, "tofes-101,shana-lifni-prisha")).toThrow(/no such article.*shana-lifni-prisha\.md/);
    expect(() => selectArticles(all, "")).toThrow(/no article named/);
    expect(() => selectArticles(all, " , ")).toThrow(/no article named/);
  });
});
