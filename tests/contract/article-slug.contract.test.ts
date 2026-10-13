import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASE44_ID_PATTERN, SLUG_PATTERN } from "@/lib/articlePath";
// @ts-expect-error — plain .mjs tooling, imported for its front-matter reader.
import { parseArticle } from "../../scripts/seed-blog.mjs";

/**
 * An article's address, as a contract.
 *
 * `blog_posts.slug` is shaped by four things that cannot import one another:
 * the migration's CHECK, the app (`src/lib/articlePath.ts`), the Base44
 * function that writes the mirror (`contentAdmin`) and the build that prebuilds
 * the pages (`scripts/published-articles.mjs`). A copy that drifted would let
 * the form accept a slug the database refuses, or the build write a page the
 * redirect can never reach. Duplicated is fine; drifted is not.
 */

const REPO_ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf8");
const MIGRATION = "supabase/migrations/20261014000000_blog_slug.sql";

describe("one slug rule, wherever it is spelled", () => {
  it("the migration's CHECKs are articlePath's patterns", () => {
    const sql = read(MIGRATION);
    expect(sql.match(/check \(slug ~ '([^']+)'\)/)?.[1]).toBe(SLUG_PATTERN.source);
    expect(sql.match(/check \(slug !~ '([^']+)'\)/)?.[1]).toBe(BASE44_ID_PATTERN.source);
  });
});

describe("the backfill names the articles that were live", () => {
  const sql = read(MIGRATION);
  // ('<exact title>', '<slug>') — the backfill's VALUES rows.
  const pairs = [...sql.matchAll(/\('((?:[^']|'')+)', '([a-z0-9-]+)'\)/g)].map(
    (m) => [m[1].replace(/''/g, "'"), m[2]] as const,
  );

  it("gives a repo article's slug to that file's exact title", () => {
    // A typo here would not fail the migration: the row would quietly get a
    // `post-<id>` address instead. Checked from the backfill's side, so a draft
    // added under content/blog later (seeded with its own slug) needs no row.
    // A file whose title is edited after this fails here — and would also make
    // seed-blog.mjs create a second post instead of updating the live one.
    const fromFiles = pairs.filter(([, slug]) => existsSync(join(REPO_ROOT, `content/blog/${slug}.md`)));
    expect(fromFiles).toHaveLength(20);
    for (const [title, slug] of fromFiles) {
      expect(parseArticle(read(`content/blog/${slug}.md`)).title, `${slug}.md`).toBe(title);
    }
  });

  it("names the two live articles older than the repo files", () => {
    const bySlug = new Map(pairs.map(([title, slug]) => [slug, title]));
    expect(bySlug.get("bituach-briut-digitali")).toBe("ביטוח בריאות דיגיטלי: אבחון מרחוק וכיסוי מיידי");
    expect(bySlug.get("pensia-beidan-ha-ai")).toBe("פנסיה בעידן ה-AI: האם הרובוט יודע לתכנן עבורכם טוב יותר?");
  });

  it("maps 22 distinct titles to 22 distinct slugs", () => {
    expect(pairs).toHaveLength(22);
    expect(new Set(pairs.map(([title]) => title)).size).toBe(22);
    expect(new Set(pairs.map(([, slug]) => slug)).size).toBe(22);
  });
});

describe("every article link goes through articlePath", () => {
  const walk = (dir: string): string[] =>
    readdirSync(join(REPO_ROOT, dir)).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(join(REPO_ROOT, p)).isDirectory()) return walk(p);
      return /\.(ts|tsx|js|jsx)$/.test(name) ? [p] : [];
    });
  const files = [...walk("src"), ...walk("api")];

  it("builds no /blog/<…> address by hand", () => {
    // `/blog/${post.id}` in five files is how links to the same article came to
    // disagree. One builder; a link built anywhere else fails here.
    const handBuilt = /\/blog\/\$\{|["'`]\/blog\/["'`]\s*\+/;
    const offenders = files.filter((f) => f !== "src/lib/articlePath.ts" && handBuilt.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it.each([
    "src/components/dorit/blog/ArticleCard.tsx",
    "src/components/dorit/blog/FeaturedRow.tsx",
    "src/pages/Blog.tsx",
    "src/pages/BlogPost.tsx",
    "src/lib/blogSeo.ts",
  ])("%s links articles through articlePath", (file) => {
    expect(read(file)).toMatch(/\barticlePath\(/);
  });
});
