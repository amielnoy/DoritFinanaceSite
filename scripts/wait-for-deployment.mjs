// Wait until the host actually serves the release that was just published.
//
// `check-production-publish.mjs` answers a different question: did a publish
// happen in this run. It cannot answer whether the edge is serving it yet, and
// on Base44 it often is not — the CLI returns, the job reports success, and the
// CDN keeps handing out the previous bundle for a while.
//
// The smoke suite then opens a browser against the old release and fails on
// whatever the new one added. That is what happened to `#start`: red at publish
// time, green against the same URL hours later, with nothing in between but
// propagation. A retry does not help, because Playwright's retries are seconds
// apart and this is minutes.
//
// So: remember which asset bundle the host served *before* publishing, and wait
// for it to change. The bundle name carries Vite's content hash, which makes it
// a release fingerprint that needs no build stamp and no cooperation from the
// publisher — it works the same whether Base44 or Vercel did the deploy.
//
// An unchanged bundle is not necessarily a stall: a commit that touches only
// backend functions or documentation produces byte-identical frontend output,
// and then there is nothing to wait for. That is why the timeout is not a
// failure — it warns and lets the smoke run. The smoke is what decides whether
// the deployment is good; this only decides when it is fair to ask.

const url = process.env.PRODUCTION_URL;
const previous = (process.env.PREVIOUS_ASSET || '').trim();
const timeoutMs = Number(process.env.WAIT_TIMEOUT_MS || 8 * 60 * 1000);
const intervalMs = Number(process.env.WAIT_INTERVAL_MS || 15 * 1000);

if (!url) {
  console.error('::error::PRODUCTION_URL is unset; cannot wait for a deployment.');
  process.exit(1);
}

/** The main bundle the page references, which changes when its content does. */
export async function servedAsset(target) {
  const res = await fetch(target, {
    headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null;
}

if (!previous) {
  // Nothing to compare against — the capture step was skipped or the host was
  // unreachable before the publish. Say so rather than waiting on nothing.
  console.log('::notice::No pre-publish asset recorded; smoking whatever is served now.');
  process.exit(0);
}

const deadline = Date.now() + timeoutMs;
let current = null;

while (Date.now() < deadline) {
  try {
    current = await servedAsset(url);
    if (current && current !== previous) {
      console.log(`Serving a new release: ${previous} -> ${current}`);
      process.exit(0);
    }
  } catch (error) {
    // A host mid-deploy can refuse or 5xx. That is a reason to keep waiting,
    // not to fail — the deadline is what ends this.
    console.log(`waiting (${error.message})`);
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

console.log(
  `::warning::${url} still serves ${current ?? 'an unreadable page'} after ` +
    `${Math.round(timeoutMs / 1000)}s. If this commit changed no frontend code the bundle is ` +
    'identical and there is nothing to wait for; otherwise the publish has not reached the edge ' +
    'and the smoke below is testing the previous release.',
);
