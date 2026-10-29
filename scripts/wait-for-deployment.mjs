// Wait until the host actually serves the release that was just published.
//
// `check-production-publish.mjs` answers a different question: did a publish
// happen in this run. It cannot answer whether the edge is serving it yet, and
// often it is not — the CLI returns, the job reports success, and the CDN
// keeps handing out the previous bundle for a while.
//
// The smoke suite then opens a browser against the old release and fails on
// whatever the new one added. That is what happened to `#start`: red at publish
// time, green against the same URL hours later, with nothing in between but
// propagation. A retry does not help, because Playwright's retries are seconds
// apart and this is minutes.
//
// So: wait until the host serves the release this run deployed. The bundle
// name carries Vite's content hash, which makes it a release fingerprint that
// needs no build stamp and no cooperation from the publisher.
//
// Two ways to know which release that is:
//
//   EXPECTED_ASSET  The bundle the Vercel job just built and deployed to
//                   production. Wait until the host serves exactly that. When a
//                   commit touched no frontend code the bundle is the same as
//                   before, the host already serves it, and there is nothing to
//                   wait for — this used to sit out the full timeout instead,
//                   eight minutes on every backend-, docs- or SEO-file merge.
//   PREVIOUS_ASSET  What the host served before the publish. Without an
//                   expected asset (a preview run), wait for it
//                   to change, as before.
//
// The timeout is not a failure — it warns and lets the smoke run. The smoke is
// what decides whether the deployment is good; this only decides when it is
// fair to ask.

import { pathToFileURL } from 'node:url';

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

/**
 * Whether the host now serves this run's release: exactly the expected bundle
 * when there is one, otherwise anything other than the previous one.
 */
export function releaseServed({ served, expected, previous }) {
  if (!served) return false;
  return expected ? served === expected : served !== previous;
}

async function main() {
  const url = process.env.PRODUCTION_URL;
  const expected = (process.env.EXPECTED_ASSET || '').trim();
  const previous = (process.env.PREVIOUS_ASSET || '').trim();
  const timeoutMs = Number(process.env.WAIT_TIMEOUT_MS || 8 * 60 * 1000);
  const intervalMs = Number(process.env.WAIT_INTERVAL_MS || 15 * 1000);

  if (!url) {
    console.error('::error::PRODUCTION_URL is unset; cannot wait for a deployment.');
    process.exit(1);
  }

  if (!expected && !previous) {
    // Nothing to compare against — the capture steps were skipped or the host
    // was unreachable before the publish. Say so rather than waiting on nothing.
    console.log('::notice::No release fingerprint recorded; smoking whatever is served now.');
    return;
  }

  const deadline = Date.now() + timeoutMs;
  let current = null;

  while (Date.now() < deadline) {
    try {
      current = await servedAsset(url);
      if (releaseServed({ served: current, expected, previous })) {
        console.log(
          expected
            ? `Serving the deployed release: ${current}${current === previous ? ' (bundle unchanged)' : ''}`
            : `Serving a new release: ${previous} -> ${current}`,
        );
        return;
      }
    } catch (error) {
      // A host mid-deploy can refuse or 5xx. That is a reason to keep waiting,
      // not to fail — the deadline is what ends this.
      console.log(`waiting (${error.message})`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  console.log(
    expected
      ? `::warning::${url} still serves ${current ?? 'an unreadable page'} after ` +
          `${Math.round(timeoutMs / 1000)}s, not the deployed ${expected}; the smoke below may be testing the previous release.`
      : `::warning::${url} still serves ${current ?? 'an unreadable page'} after ` +
          `${Math.round(timeoutMs / 1000)}s. If this commit changed no frontend code the bundle is ` +
          'identical and there is nothing to wait for; otherwise the publish has not reached the edge ' +
          'and the smoke below is testing the previous release.',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
