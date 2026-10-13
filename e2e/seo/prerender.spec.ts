import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, test_step } from "../fixtures/app";

/**
 * The one article the e2e build prebuilds (PRERENDER_ARTICLES_FIXTURE, set in
 * playwright.config.ts, scripts/run-tests.sh and CI's build job). The build
 * has no Supabase, so the prerender answers the page's read from this file —
 * hermetic, and refused anywhere it could reach a deployment.
 */
const [ARTICLE] = JSON.parse(
  readFileSync(join(process.cwd(), "e2e/fixtures/prerender-articles.json"), "utf8"),
) as Array<{ slug: string; title: string; body: string }>;
const ARTICLE_PATH = `/blog/${ARTICLE.slug}`;
/** The first prose line of the body — what a crawler must be able to quote. */
const ARTICLE_SENTENCE = ARTICLE.body
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l && !l.startsWith("#"))!;

/**
 * Prerendering, asserted the way a crawler experiences it.
 *
 * Every other spec in this folder drives a browser, so it measures what Google
 * sees — Google runs JavaScript. GPTBot, ClaudeBot, PerplexityBot and CCBot
 * largely do not, and before `scripts/prerender.mjs` they received the home
 * page's title and canonical on every route: verified against live production,
 * where `/`, `/faq` and `/claims` returned byte-identical HTML.
 *
 * So these tests use `request`, never `page`. Nothing here may pass because a
 * browser repaired it afterwards — that is the entire point.
 */

const PRERENDERED = [
  { path: "/", titleContains: "דורית גוב ארי" },
  { path: "/faq", titleContains: "שאלות ותשובות" },
  { path: "/tools", titleContains: "כלים" },
  { path: "/perspective", titleContains: "נקודת מבט" },
  { path: "/claims", titleContains: "תביעות" },
  { path: "/blog", titleContains: "בלוג" },
  { path: "/privacy", titleContains: "פרטיות" },
  { path: "/accessibility", titleContains: "נגישות" },
  { path: ARTICLE_PATH, titleContains: ARTICLE.title },
];

const titleOf = (html: string) => html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? "";

const canonicalOf = (html: string) => {
  const tag = html.match(/<link[^>]*rel=["']canonical["'][^>]*>/)?.[0] ?? "";
  return tag.match(/href=["']([^"']+)["']/)?.[1] ?? "";
};

const jsonLdOf = (html: string) =>
  [...html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1])
  );

test.describe("Prerendered HTML — what a crawler that does not run JavaScript receives", () => {
  for (const route of PRERENDERED) {
    test(`${route.path} is served with its own title and canonical`, async ({ request }) => {
      const html = await test_step(`fetch ${route.path} without a browser`, async () => {
        const res = await request.get(route.path);
        expect(res.status(), `${route.path} did not return 200`).toBe(200);
        return res.text();
      });

      await test_step("the title is the route's own, not the shell's", async () => {
        expect(titleOf(html)).toContain(route.titleContains);
      });

      await test_step("the canonical names this route, not the home page", async () => {
        const path = new URL(canonicalOf(html)).pathname.replace(/(.)\/+$/, "$1");
        expect(path).toBe(route.path === "/" ? "/" : route.path);
      });
    });
  }

  test("no two routes are served the same title or canonical", async ({ request }) => {
    // The regression that would return if prerendering silently stopped running:
    // eight files, all of them the home page. One assertion catches all of it.
    const served = await test_step("fetch every prerendered route", async () =>
      Promise.all(
        PRERENDERED.map(async (r) => {
          const html = await (await request.get(r.path)).text();
          return { path: r.path, title: titleOf(html), canonical: canonicalOf(html) };
        })
      )
    );

    await test_step("every title and canonical is distinct", async () => {
      expect(new Set(served.map((s) => s.title)).size).toBe(served.length);
      expect(new Set(served.map((s) => s.canonical)).size).toBe(served.length);
    });
  });

  test("the FAQ answers are in the HTML, not only in the JavaScript", async ({ request }) => {
    // /faq is the richest content on the site and the reason an assistant would
    // cite it. Its FAQPage markup is injected at runtime, so before prerendering
    // both the questions and the answers were invisible to every AI crawler.
    const html = await test_step("fetch /faq without a browser", async () =>
      (await request.get("/faq")).text()
    );

    const questions = await test_step("read the FAQPage markup out of the served HTML", async () => {
      const faq = jsonLdOf(html).find((b) => b["@type"] === "FAQPage");
      expect(faq, "no FAQPage markup in the served HTML").toBeTruthy();
      return faq.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>;
    });

    await test_step("every declared question and answer is present as text", async () => {
      const text = html.replace(/<[^>]+>/g, " ");
      for (const q of questions) {
        expect(text, `question missing from the HTML: ${q.name}`).toContain(q.name);
        expect(text, `answer missing for: ${q.name}`).toContain(
          q.acceptedAnswer.text.slice(0, 40)
        );
      }
    });
  });

  test("an article is served as full HTML: its body, its canonical and its BlogPosting", async ({ request }) => {
    // The point of prebuilding articles: an assistant that does not run
    // JavaScript can quote the article itself, under its own address.
    const html = await test_step(`fetch ${ARTICLE_PATH} without a browser`, async () => {
      const res = await request.get(ARTICLE_PATH);
      expect(res.status(), `${ARTICLE_PATH} did not return 200`).toBe(200);
      return res.text();
    });

    await test_step("the body text is in the HTML", async () => {
      expect(html.replace(/<[^>]+>/g, " ")).toContain(ARTICLE_SENTENCE);
    });

    await test_step("the canonical is the article's slug address", async () => {
      expect(new URL(canonicalOf(html)).pathname).toBe(ARTICLE_PATH);
    });

    await test_step("BlogPosting names the article and the same address", async () => {
      const posting = jsonLdOf(html).find((b) => b["@type"] === "BlogPosting");
      expect(posting, "no BlogPosting markup in the served HTML").toBeTruthy();
      expect(posting.headline).toBe(ARTICLE.title);
      expect(new URL(posting.mainEntityOfPage["@id"]).pathname).toBe(ARTICLE_PATH);
    });
  });

  test("the prerendered pages carry no build-host URLs", async ({ request }) => {
    // The DOM is captured from a local preview server, so Vite's own
    // `modulepreload` hints arrive absolute. Shipping them would point every
    // page at 127.0.0.1.
    for (const route of PRERENDERED) {
      await test_step(`${route.path} names no build host`, async () => {
        // Per route rather than in one loop, so a failure says which page
        // leaked rather than only that one did.
        const html = await (await request.get(route.path)).text();
        expect(html, `${route.path} leaks a localhost URL`).not.toMatch(
          /https?:\/\/(127\.0\.0\.1|localhost)/
        );
      });
    }
  });
});
