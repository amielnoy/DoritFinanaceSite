/**
 * Notices that the browser is running a build the server has replaced.
 *
 * The site's `index.html` is served with no `Cache-Control`, no `ETag` and no
 * `Last-Modified` — nothing a browser can revalidate against — while every
 * hashed asset beside it carries `max-age=604800`. A phone that opened the site
 * once keeps that HTML, the HTML names last week's bundle, and the bundle is
 * still served for a week. The device then runs last week's app indefinitely,
 * and nothing about it looks broken.
 *
 * It was not a theory. On 2026-10-04 interviews from a desktop sent Dorit her
 * mail and interviews from an Android phone did not: the phone was running a
 * build whose closing step called `createConsultationEvent`, which writes a
 * calendar entry and sends nothing. `prod` logs show exactly that — the call,
 * rejected for missing contact fields, with no `submitLead` anywhere near it.
 * A publish does not reach such a device. See A-57.
 *
 * So the page asks, once on load and again whenever it is brought back to the
 * foreground, which bundle the server is naming now. The comparison is between
 * the module script this document loaded and the one the fresh HTML lists.
 *
 * Caveats worth keeping in mind rather than hiding:
 *   - A device already holding a stale `index.html` is running code that
 *     predates this check, so it cannot run it. Those need one manual reload.
 *   - `location.reload()` may be answered from the same stale cache entry, so
 *     the escape is a navigation to a URL the cache has never seen.
 */

/** The `src` of the module script this document actually loaded. */
function loadedEntry(doc: Document): string | null {
  const el = doc.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return el ? new URL(el.src, doc.baseURI).pathname : null;
}

/** The entry the server names right now, or null if it could not be asked. */
async function publishedEntry(signal?: AbortSignal): Promise<string | null> {
  try {
    // `no-store` so the question is not answered by the very cache in question.
    const res = await fetch(`${window.location.origin}/?_fresh=${Date.now()}`, {
      cache: "no-store",
      signal,
    });
    if (!res.ok) return null;
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    return loadedEntry(doc);
  } catch {
    // Offline, blocked, or the navigation was cancelled. Staleness is not
    // urgent enough to be worth reporting to the visitor.
    return null;
  }
}

/** Set once we have navigated, so a wrong answer cannot become a reload loop. */
const ESCAPED = "freshness:escaped";

function alreadyEscaped(): boolean {
  try {
    return window.sessionStorage.getItem(ESCAPED) === "1";
  } catch {
    // Private mode, or storage blocked. Treat as "not yet" — the worst case is
    // one extra navigation, which is still better than a week of stale code.
    return false;
  }
}

function markEscaped(): void {
  try {
    window.sessionStorage.setItem(ESCAPED, "1");
  } catch {
    /* nothing to do; see above */
  }
}

/**
 * Compares the two, and leaves the stale build if they differ.
 *
 * Exported for the tests, which drive it directly rather than through a timer.
 */
export async function checkFreshness(): Promise<"fresh" | "unknown" | "stale"> {
  if (alreadyEscaped()) return "fresh";
  const loaded = loadedEntry(document);
  if (!loaded) return "unknown";
  const published = await publishedEntry();
  if (!published || published === loaded) return published ? "fresh" : "unknown";

  markEscaped();
  // Not `reload()`: the stale `index.html` has no validator, so a reload can be
  // answered from the same cache entry that caused this. A URL the cache has
  // not seen cannot be.
  const url = new URL(window.location.href);
  url.searchParams.set("_v", published.replace(/\D+/g, "").slice(-8) || "1");
  window.location.replace(url.toString());
  return "stale";
}

/** Wires the check to load and to the tab being brought back. */
export function watchFreshness(): void {
  void checkFreshness();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkFreshness();
  });
}
