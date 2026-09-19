// Prerender the public routes to real HTML files.
//
// The app is client-rendered: `dist/index.html` ships one static <head> and an
// empty `<div id="root">`, and every path returns that same file. `useSeo`
// writes the right title, canonical and JSON-LD once React mounts — which only
// helps a crawler that executes JavaScript.
//
// Google does. GPTBot, ClaudeBot, PerplexityBot and CCBot largely do not, so to
// an AI assistant the whole site was one page, and `/faq` — the richest content
// here — did not exist. Verified against live production before this was
// written: `/`, `/faq` and `/claims` returned byte-identical HTML, all three
// declaring the home page as their canonical.
//
// So: run the real app in a real browser at build time, let `useSeo` and the
// components do exactly what they do for a visitor, and write the resulting DOM
// to `dist/<route>/index.html`. No second copy of the metadata to drift, because
// nothing here knows what any route's title should be — it renders and asks.
//
// Two files, deliberately:
//
//   dist/index.html — the prerendered home page, served at `/`.
//   dist/app.html   — the untouched SPA shell, the rewrite target for anything
//                     without a prerendered file (blog posts, 404s).
//
// Without the split, the SPA fallback would be the prerendered *home* page, and
// a crawler fetching /blog/some-post would be served the home page's content
// under that URL. An empty shell is the honest answer for a route we have not
// prerendered.

import { createRequire } from 'node:module'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const DIST = join(process.cwd(), 'dist')
const PORT = Number(process.env.PRERENDER_PORT ?? 4183)

// The public, statically-routed pages — the sitemap's contents.
//
// Blog posts are deliberately absent: they come from the Base44 backend at
// runtime, so prerendering them would bake a snapshot of live content into the
// bundle and go stale the moment a post is edited. They keep the SPA shell.
const ROUTES = [
  '/',
  '/faq',
  '/tools',
  '/perspective',
  '/claims',
  '/blog',
  '/privacy',
  '/accessibility',
]

/** The route is rendered when its own canonical has replaced the static one. */
const canonicalFor = (route) => (route === '/' ? '/' : route.replace(/\/+$/, ''))

/**
 * Undo the font preload's self-promotion.
 *
 * `index.html` loads the fonts with `rel="preload" as="style"` and an `onload`
 * that flips it to `rel="stylesheet"` — the standard trick for keeping the
 * stylesheet off the critical path. By the time the DOM is captured that flip
 * has already happened, so a naive snapshot writes `rel="stylesheet"` into the
 * file and every prerendered page ships a render-blocking stylesheet: the exact
 * cost the pattern exists to avoid, reintroduced by the step meant to help.
 *
 * Detected by the `onload` handler rather than the URL, so it keeps working if
 * the font host changes. `SEO-MOB-007` asserts the same property on the served
 * HTML and is what fails if this stops working.
 */
function restoreAsyncFont(html) {
  return html.replace(
    /<link([^>]*?)rel="stylesheet"([^>]*?onload="this\.onload=null;this\.rel='stylesheet'"[^>]*)>/g,
    '<link$1rel="preload"$2>',
  )
}

async function main() {
  const { preview } = await import('vite')
  const { chromium } = await import('@playwright/test')

  // Keep the shell before anything overwrites index.html.
  await cp(join(DIST, 'index.html'), join(DIST, 'app.html'))

  const server = await preview({
    preview: { port: PORT, host: '127.0.0.1', strictPort: true },
    logLevel: 'warn',
  })

  // A build host without the Chromium binary is a reason to ship the plain SPA
  // — which is what every build shipped before this script existed — not a
  // reason to fail the deploy. `app.html` is already in place above, so the
  // rewrite target exists either way.
  //
  // Loud, though: a silent skip is how this step would quietly stop running and
  // nobody would notice until rankings moved. `e2e/seo/prerender.spec.ts` is the
  // other half of that — it fails if the served HTML is not per-route.
  let browser
  try {
    browser = await chromium.launch()
  } catch (err) {
    await server.close()
    console.warn(
      `\n::warning::Prerendering skipped — could not launch Chromium (${err.message.split('\n')[0]}).\n` +
        `The build ships the client-rendered SPA, exactly as it did before.\n` +
        `Install the browser with: npx playwright install chromium`,
    )
    return
  }

  const results = []

  try {
    for (const route of ROUTES) {
      const page = await browser.newPage()
      try {
        await page.goto(`http://127.0.0.1:${PORT}${route}`, {
          waitUntil: 'networkidle',
          timeout: 45_000,
        })

        // Wait for the route's own metadata rather than a fixed delay: the
        // whole point is to capture the head `useSeo` writes, and a timeout
        // that fires early would bake the static head back in.
        const want = canonicalFor(route)
        await page.waitForFunction(
          (expected) => {
            const href = document
              .querySelector('link[rel="canonical"]')
              ?.getAttribute('href')
            if (!href) return false
            try {
              return new URL(href).pathname.replace(/(.)\/+$/, '$1') === expected
            } catch {
              return false
            }
          },
          want,
          { timeout: 20_000 },
        )

        // Vite's runtime adds `modulepreload` hints for the route's chunks
        // using the *absolute* origin it was loaded from, so capturing the DOM
        // bakes `http://127.0.0.1:4183/assets/…` into the shipped HTML. The
        // hints are worth keeping — they are the route's own chunks — so make
        // them root-relative rather than dropping them.
        const html = restoreAsyncFont(
          (await page.content()).replaceAll(`http://127.0.0.1:${PORT}/`, '/'),
        )
        if (html.includes(`127.0.0.1:${PORT}`)) {
          throw new Error(`${route}: the preview origin survived into the HTML`)
        }
        // `<route>.html`, not `<route>/index.html`. Measured, not assumed: the
        // directory form is only served at `/faq/` with the trailing slash —
        // `/faq` falls straight through to the SPA fallback, which would have
        // shipped eight prerendered files that nothing ever requested. The
        // sibling file answers `/faq`, `/faq/` and `/faq.html` alike, on
        // `vite preview` and on Vercel, and every copy declares `/faq` as its
        // canonical so the spare spellings consolidate.
        const target =
          route === '/' ? join(DIST, 'index.html') : join(DIST, `${route.slice(1)}.html`)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, html, 'utf8')

        const title = await page.title()
        results.push({ route, bytes: html.length, title })
        console.log(
          `  ${route.padEnd(16)} ${String(html.length).padStart(7)} bytes  ${title.slice(0, 48)}`,
        )
      } finally {
        await page.close()
      }
    }
  } finally {
    await browser.close()
    await server.close()
  }

  // Every route serving the same title is the exact defect this step exists to
  // remove, and it would fail silently — eight files, all of them the home
  // page. Assert it here rather than discover it in Search Console.
  const titles = new Set(results.map((r) => r.title))
  if (titles.size !== results.length) {
    console.error(
      `\nPrerender produced ${titles.size} distinct titles for ${results.length} routes — ` +
        `the per-route head did not apply. Refusing to ship a directory of identical pages.`,
    )
    process.exit(1)
  }

  console.log(`\nPrerendered ${results.length} routes, ${titles.size} distinct titles.`)
}

await main()
