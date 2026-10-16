import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs tooling, imported for its pure planning step.
import { planSeed, rowFor, parseArticle, selectArticles, slugFromFile } from "../../scripts/seed-blog.mjs";

/**
 * Seeding writes the repo's articles to Supabase's `blog_posts`, the one
 * store the site and /admin/blog use.
 *
 * What is worth pinning is what a re-run must not do: add a second copy of a
 * post, overwrite Dorit's decision to publish, or move a post to a new address.
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

const post = (over: Record<string, unknown> = {}) => ({
  id: "uuid-7",
  slug: "horadat-dmei-nihul",
  title: "להוריד דמי ניהול בפנסיה",
  published: false,
  ...over,
});

describe("planSeed", () => {
  it("creates an article the table has never seen, as a draft with the file's slug", () => {
    const [step] = planSeed([article()], []);
    expect(step.op).toBe("create");
    expect(rowFor(step)).toMatchObject({ slug: "horadat-dmei-nihul", published: false });
  });

  it("updates the post with the same slug, even when its title was edited", () => {
    const [step] = planSeed([article()], [post({ title: "כותרת שנערכה באתר" })]);
    expect(step).toMatchObject({ op: "update", id: "uuid-7" });
  });

  it("updates the post with the same title when its slug was changed, and keeps that slug", () => {
    const [step] = planSeed([article()], [post({ slug: "dmei-nihul" })]);
    expect(step).toMatchObject({ op: "update", id: "uuid-7", slug: "dmei-nihul" });
    expect(rowFor(step)).not.toHaveProperty("slug");
  });

  it("prefers the slug match over a title match on another post", () => {
    const [step] = planSeed([article()], [post({ id: "by-title", slug: "other" }), post({ id: "by-slug", title: "אחר" })]);
    expect(step.id).toBe("by-slug");
  });

  it("leaves a published post published when the content is re-seeded", () => {
    // The file says draft — every repo article does. A post Dorit has since
    // published from /admin/blog must not quietly come down because the copy
    // was corrected.
    const [step] = planSeed([article()], [post({ published: true })]);
    expect(rowFor(step)).not.toHaveProperty("published");
  });
});

describe("rowFor", () => {
  it("carries the action time from the front matter", () => {
    const parsed = parseArticle('---\ntitle: "כותרת"\ntags: "פנסיה"\naction_time: "רבע שעה"\n---\nגוף');
    expect(parsed.action_time).toBe("רבע שעה");
    const [step] = planSeed([{ ...article(), ...parsed }], []);
    expect(rowFor(step).action_time).toBe("רבע שעה");
  });

  it("sends an empty action time for an article that has none", () => {
    expect(parseArticle('---\ntitle: "כותרת"\n---\nגוף').action_time).toBe("");
  });

  it("carries cta_headline and og_image", () => {
    const parsed = parseArticle(
      '---\ntitle: "כותרת"\ncta_headline: "רוצים לדעת כמה אתם משלמים?"\nog_image: "https://cdn.example/share.jpg"\n---\nגוף',
    );
    const [step] = planSeed([{ ...article(), ...parsed }], []);
    expect(rowFor(step)).toMatchObject({
      cta_headline: "רוצים לדעת כמה אתם משלמים?",
      og_image: "https://cdn.example/share.jpg",
    });
  });

  it("writes an article without them as null, which the column checks accept (an empty string is refused)", () => {
    const [step] = planSeed([{ ...article(), ...parseArticle('---\ntitle: "כותרת"\n---\nגוף') }], []);
    expect(rowFor(step)).toMatchObject({ cta_headline: null, og_image: null });
  });

  it("never writes a Base44 id or an agency: the column defaults decide them", () => {
    const [step] = planSeed([article()], []);
    expect(rowFor(step)).not.toHaveProperty("base44_id");
    expect(rowFor(step)).not.toHaveProperty("agency_id");
  });
});

describe("the article's address", () => {
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
