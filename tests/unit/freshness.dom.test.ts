/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkFreshness } from "@/lib/freshness";

/**
 * The check that notices a browser is running a build the server has replaced.
 *
 * The site's `index.html` is served with no `Cache-Control`, no `ETag` and no
 * `Last-Modified`, while the hashed bundles beside it carry `max-age=604800`.
 * A phone that opened the site once keeps that HTML, the HTML names last week's
 * bundle, and the bundle is still served. On 2026-10-04 that is exactly what
 * happened: interviews from a desktop mailed Dorit and interviews from an
 * Android phone did not, because the phone was running a build whose closing
 * step called `createConsultationEvent` — which books a calendar entry and
 * sends nothing. A publish cannot reach such a device. See A-57.
 */
describe("freshness — leaving a build the server has replaced", () => {
  const html = (entry: string) =>
    `<!doctype html><html><head><script type="module" src="${entry}"></script></head><body></body></html>`;

  let replaced: string[];

  beforeEach(() => {
    document.head.innerHTML = `<script type="module" src="/assets/index-OLD.js"></script>`;
    window.sessionStorage.clear();
    replaced = [];
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        href: "https://example.test/interview",
        origin: "https://example.test",
        replace: (url: string) => replaced.push(url),
      },
    });
  });

  const serverSays = (entry: string | Error) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (entry instanceof Error) throw entry;
        return { ok: true, text: async () => html(entry) } as unknown as Response;
      }),
    );

  it("stays put when the server names the same bundle", async () => {
    serverSays("/assets/index-OLD.js");
    expect(await checkFreshness()).toBe("fresh");
    expect(replaced, "navigated away from a build that was current").toEqual([]);
  });

  it("leaves when the server names a different one", async () => {
    serverSays("/assets/index-NEW42.js");
    expect(await checkFreshness()).toBe("stale");
    expect(replaced).toHaveLength(1);
    // Not `reload()`: the stale HTML has no validator, so a reload can be
    // answered from the very cache entry that caused this. The escape has to be
    // a URL the cache has never seen.
    expect(replaced[0]).toMatch(/[?&]_v=/);
    expect(replaced[0], "left the page the visitor was on").toContain("/interview");
  });

  it("asks the server in a way its own cache cannot answer", async () => {
    serverSays("/assets/index-OLD.js");
    await checkFreshness();
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init).toMatchObject({ cache: "no-store" });
    expect(String(url), "the probe is itself cacheable").toMatch(/[?&]_fresh=/);
  });

  it("does nothing when the server cannot be reached", async () => {
    // Offline is the common case on a phone, and staleness is never urgent
    // enough to be worth a reload the visitor did not ask for.
    serverSays(new Error("offline"));
    expect(await checkFreshness()).toBe("unknown");
    expect(replaced).toEqual([]);
  });

  it("never navigates twice, however wrong the answer is", async () => {
    // The guard that keeps a mistake from becoming a reload loop, which on a
    // phone is worse than the staleness it was meant to cure.
    serverSays("/assets/index-NEW42.js");
    expect(await checkFreshness()).toBe("stale");
    expect(await checkFreshness()).toBe("fresh");
    expect(replaced).toHaveLength(1);
  });
});
