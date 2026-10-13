import { describe, expect, it, vi } from "vitest";
// @ts-expect-error — plain .mjs tooling.
import { INDEXNOW_KEY, indexNowBody, recentUrls, submit } from "../../scripts/indexnow.mjs";

const ORIGIN = "https://govari-fin.co.il";
const NOW = new Date("2026-10-13T12:00:00Z");
const SITEMAP = `<urlset>
  <url><loc>${ORIGIN}/</loc><changefreq>weekly</changefreq></url>
  <url><loc>${ORIGIN}/blog</loc><lastmod>2026-10-13T08:00:00.000Z</lastmod></url>
  <url><loc>${ORIGIN}/blog/fresh</loc><lastmod>2026-10-13T08:00:00.000Z</lastmod></url>
  <url><loc>${ORIGIN}/blog/yesterday</loc><lastmod>2026-10-12T13:00:00.000Z</lastmod></url>
  <url><loc>${ORIGIN}/blog/old</loc><lastmod>2026-10-01T00:00:00.000Z</lastmod></url>
</urlset>`;

describe("recentUrls", () => {
  it("returns only articles changed within the window", () => {
    expect(recentUrls(SITEMAP, NOW)).toEqual([`${ORIGIN}/blog/fresh`, `${ORIGIN}/blog/yesterday`]);
  });
  it("never submits static routes, even /blog with a fresh lastmod", () => {
    expect(recentUrls(SITEMAP, NOW)).not.toContain(`${ORIGIN}/blog`);
  });
  it("is empty when nothing changed", () => {
    expect(recentUrls(SITEMAP, new Date("2026-11-30T00:00:00Z"))).toEqual([]);
  });
});

describe("indexNowBody", () => {
  it("names the host, the key and where the key file is", () => {
    expect(indexNowBody(ORIGIN, ["u"])).toEqual({
      host: "govari-fin.co.il",
      key: INDEXNOW_KEY,
      keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`,
      urlList: ["u"],
    });
  });
});

describe("submit — never fails the deploy", () => {
  const sitemapThen = (indexnow: Response | Error) =>
    vi.fn(async (url: string) => {
      if (url.endsWith("/sitemap.xml")) return new Response(SITEMAP, { status: 200 });
      if (indexnow instanceof Error) throw indexnow;
      return indexnow;
    });
  const log = { info: vi.fn(), warn: vi.fn() };

  it("posts the recent articles to IndexNow", async () => {
    const fetchImpl = sitemapThen(new Response(null, { status: 202 }));
    await expect(submit({ origin: ORIGIN, fetchImpl, now: NOW, log })).resolves.toEqual({ submitted: 2 });
    const [url, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("https://api.indexnow.org/indexnow");
    expect(JSON.parse(String(init.body)).urlList).toHaveLength(2);
  });

  it("submits nothing when no article changed", async () => {
    const fetchImpl = sitemapThen(new Response(null, { status: 200 }));
    await expect(
      submit({ origin: ORIGIN, fetchImpl, now: new Date("2026-11-30T00:00:00Z"), log }),
    ).resolves.toEqual({ submitted: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("warns and resolves on a refused submission", async () => {
    const warn = vi.fn();
    await expect(
      submit({ origin: ORIGIN, fetchImpl: sitemapThen(new Response("bad", { status: 422 })), now: NOW, log: { info: vi.fn(), warn } }),
    ).resolves.toEqual({ submitted: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("422"));
  });

  it("warns and resolves when IndexNow cannot be reached", async () => {
    const warn = vi.fn();
    await expect(
      submit({ origin: ORIGIN, fetchImpl: sitemapThen(new Error("ENOTFOUND")), now: NOW, log: { info: vi.fn(), warn } }),
    ).resolves.toEqual({ submitted: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ENOTFOUND"));
  });

  it("warns and resolves without an origin", async () => {
    const warn = vi.fn();
    await expect(submit({ origin: "", fetchImpl: vi.fn(), now: NOW, log: { info: vi.fn(), warn } })).resolves.toEqual({
      submitted: 0,
    });
    expect(warn).toHaveBeenCalled();
  });
});
