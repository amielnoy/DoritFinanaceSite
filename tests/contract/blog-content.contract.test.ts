import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, loadEntity, validateAgainstEntity } from "../helpers/entity-schema";

/**
 * The repo-held blog articles.
 *
 * Marketing content published by a licensed agency is regulated speech: it must
 * disclose the licence and the affiliation, and it must not promise a return.
 * Keeping the articles in the repo is what makes that reviewable, and these
 * tests are what keep a future edit from quietly dropping the disclosure.
 */

const CONTENT_DIR = join(REPO_ROOT, "content/blog");

interface Article {
  file: string;
  title: string;
  excerpt: string;
  tags: string;
  published: boolean;
  body: string;
}

function parseArticle(file: string): Article {
  const raw = readFileSync(join(CONTENT_DIR, file), "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^"(.*)"$/, "$1").trim();
  }
  return {
    file,
    title: meta.title,
    excerpt: meta.excerpt ?? "",
    tags: meta.tags ?? "",
    published: meta.published === "true",
    body: m[2].trim(),
  };
}

const articles = readdirSync(CONTENT_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map(parseArticle);

describe("repo-held blog articles", () => {
  it("there are articles to check", () => {
    expect(articles.length).toBeGreaterThanOrEqual(2);
  });

  for (const article of articles) {
    describe(article.file, () => {
      it("has a title, an excerpt and tags", () => {
        expect(article.title?.length ?? 0).toBeGreaterThan(0);
        expect(article.excerpt.length).toBeGreaterThan(0);
        expect(article.tags.length).toBeGreaterThan(0);
      });

      it("is a real article, not a stub", () => {
        expect(article.body.length).toBeGreaterThan(1500);
      });

      it("carries the mandatory disclosure", () => {
        expect(article.body).toMatch(/גילוי נאות/);
        expect(article.body).toMatch(/L-00107009/);
        expect(article.body).toMatch(/זיקה לגופים מוסדיים/);
        expect(article.body).toMatch(/שיווק פנסיוני/);
        expect(article.body).toMatch(/אינו ייעוץ|אין בו ייעוץ/);
      });

      it("promises no return or outcome", () => {
        // Wording a compliance review would strike out on sight.
        for (const banned of [
          /מובטח(ת)? תשואה/,
          /תשואה מובטחת/,
          /רווח מובטח/,
          /נחסוך לך \d/,
          /תרוויח(ו)? \d/,
        ]) {
          expect(article.body, `${article.file} → ${banned}`).not.toMatch(banned);
        }
      });

      it("maps onto the BlogPost entity without stray fields", () => {
        const issues = validateAgainstEntity(loadEntity("BlogPost"), {
          title: article.title,
          excerpt: article.excerpt,
          body: article.body,
          tags: article.tags,
          image_url: "",
          published: article.published,
        });
        expect(issues).toEqual([]);
      });

      it("ships as a draft — publishing is a human decision", () => {
        expect(article.published).toBe(false);
      });
    });
  }
});
