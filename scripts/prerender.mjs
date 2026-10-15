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
// to `dist/<route>.html`. No second copy of the metadata to drift, because
// nothing here knows what any route's title should be — it renders and asks.
//
// Two files, deliberately:
//
//   dist/index.html — the prerendered home page, served at `/`.
//   dist/app.html   — the untouched SPA shell, the rewrite target (`/app`) for anything
//                     without a prerendered file (an article published since
//                     the last build, 404s).
//
// Without the split, the SPA fallback would be the prerendered *home* page, and
// a crawler fetching an article not yet prebuilt would be served the home
// page's content under that URL. An empty shell is the honest answer for a
// route we have not prerendered.

import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { buildEnv, duplicateTitles, fixtureArticleFor, hebrewTitledLocalePages, planArticles } from './published-articles.mjs'
import { enabledLocales, translatedRoutes } from '../src/i18n/locales.ts'

const DIST = join(process.cwd(), 'dist')
const PORT = Number(process.env.PRERENDER_PORT ?? 4183)

/**
 * Stamped into every file this script writes, so a later run can tell a
 * prerendered page from the shell `vite build` emits.
 *
 * Without it, running the script twice against one build destroys the fallback:
 * the second run copies the already-prerendered `index.html` over `app.html`,
 * and every route that is *not* prerendered starts being served the home
 * page's content under its own URL. `npm run build:prerender` happens to be
 * safe because `vite build` rewrites `index.html` first; running
 * `npm run prerender` on its own is not, and that is the command someone
 * reaches for when iterating.
 */
const MARKER = '<!-- prerendered by scripts/prerender.mjs -->'

const exists = async (p) => access(p).then(() => true, () => false)

// The public, statically-routed pages — the sitemap's contents.
//
// Published articles are added to these at build time (`planArticles` in
// scripts/published-articles.mjs): each becomes `dist/blog/<slug>.html`, which
// Vercel serves before any rewrite. A page is a snapshot, so an article edited
// since the last build is stale until the next production deploy — the publish
// workflow and the nightly CI run are what make one (README, "When an article's
// page is rebuilt").
const ROUTES = [
  '/',
  '/faq',
  '/tools',
  '/pension-check',
  '/atzmaim-31-12',
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

/**
 * Drop the beacon `@vercel/analytics` injects into the live DOM.
 *
 * `<Analytics />` appends `<script src="/_vercel/insights/script.js">` on
 * mount, so the captured DOM carries it and every prerendered page ships it as
 * static markup. Nothing under `/_vercel/` is a file in this build: the path is
 * synthesised by Vercel's edge, and production is Base44, which has never heard
 * of it. There the tag resolves to the SPA fallback — `index.html`, 200,
 * `text/html` — and the browser refuses to execute a document as a script on
 * every page load, for a beacon that collects nothing on that host anyway.
 *
 * Removing it costs nothing on Vercel either: the component re-injects the tag
 * when React mounts, which is how it works for a client-rendered visit today.
 *
 * Matched on the `/_vercel/` prefix rather than the one filename, because
 * `@vercel/speed-insights` places its beacon there too and would arrive the
 * same way. `API-SUR-…` in `e2e/api/http-surface.spec.ts` — "every same-origin
 * file referenced by index.html actually exists" — is what fails if this stops
 * working.
 */
function dropVercelBeacon(html) {
  return html.replace(/<script\b[^>]*\bsrc="\/_vercel\/[^"]*"[^>]*><\/script>/g, '')
}

/**
 * Answer a prerendered article page's Base44 read from the fixture file.
 *
 * Only in the e2e build (`PRERENDER_ARTICLES_FIXTURE`), whose bundle has no
 * Supabase and so reads the article through the Base44 SDK, which nothing
 * serves at build time. `planArticles` refuses the fixture anywhere it could
 * reach a deployment.
 */
async function serveFixtureArticles(page, rows) {
  await page.route(/\/entities\/BlogPost\/[^/?#]+/, (route) => {
    const row = fixtureArticleFor(route.request().url(), rows)
    return route.fulfill({
      status: row ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(row ?? { error: 'not found' }),
    })
  })
}

async function main() {
  const { preview } = await import('vite')
  const { chromium } = await import('@playwright/test')

  // Keep the shell before anything overwrites index.html — but only when
  // `index.html` still *is* the shell. See MARKER.
  const indexPath = join(DIST, 'index.html')
  const shellPath = join(DIST, 'app.html')
  if ((await readFile(indexPath, 'utf8')).includes(MARKER)) {
    if (!(await exists(shellPath))) {
      console.error(
        `\n::error::dist/index.html is already prerendered and dist/app.html is missing, ` +
          `so the SPA shell cannot be recovered. Run a fresh build: npm run build:prerender`,
      )
      process.exit(1)
    }
    // app.html was written from the pristine shell by the run that prerendered
    // index.html, so it is already correct. Copying now would overwrite it with
    // the home page.
  } else {
    await cp(indexPath, shellPath)
  }

  // Which articles to prebuild. The environment is read the way `vite build`
  // read it — the env files, with the process environment winning — so the list
  // comes from the same Supabase project the bundle reads.
  const env = await buildEnv()
  let articles
  try {
    articles = await planArticles(env)
  } catch (err) {
    console.error(`\n::error::The published articles cannot be prebuilt: ${err.message}`)
    process.exit(1)
  }
  if (articles.warning) console.warn(`\n::warning::${articles.warning}`)
  // English and French, when the build serves them (VITE_LOCALES): the same
  // pages under /en and /fr, each written to dist/en/<route>.html. Unset, this
  // adds nothing and the build is what it was.
  const routes = [...ROUTES, ...translatedRoutes(enabledLocales(env.VITE_LOCALES)), ...articles.routes]

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
    const why = err.message.split('\n')[0]

    // Where the artifact is *tested* for being prerendered, a skip is not a
    // degraded build — it is a build that will fail a later job with nine
    // opaque failures in a suite that is working correctly. That is exactly how
    // this was found. `PRERENDER_REQUIRED=1` moves the error to where the cause
    // is, in the job that could have installed the browser.
    if (process.env.PRERENDER_REQUIRED === '1') {
      console.error(
        `\n::error::Prerendering was required and could not run: ${why}\n` +
          `Install the browser before building: npx playwright install --with-deps chromium`,
      )
      process.exit(1)
    }

    console.warn(
      `\n::warning::Prerendering skipped — could not launch Chromium (${why}).\n` +
        `The build ships the client-rendered SPA, exactly as it did before.\n` +
        `Install the browser with: npx playwright install chromium`,
    )
    return
  }

  const results = []

  try {
    for (const route of routes) {
      const page = await browser.newPage()
      try {
        // Hermetic, like e2e/fixtures/app.ts: a build must not send a page_view
        // to Google Analytics for every route it renders.
        await page.route(/googletagmanager\.com|google-analytics\.com/, (r) => r.abort())

        if (articles.fixtureRows && route.startsWith('/blog/')) {
          await serveFixtureArticles(page, articles.fixtureRows)
        }

        await page.goto(`http://127.0.0.1:${PORT}${route}`, {
          waitUntil: 'networkidle',
          timeout: 45_000,
        })

        // Wait for the route's own metadata rather than a fixed delay: the
        // whole point is to capture the head `useSeo` writes, and a timeout
        // that fires early would bake the static head back in. An article that
        // does not load keeps the not-found canonical (`/blog`), times out
        // here, and fails the build rather than shipping a "not found" page.
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

        // The live page marks itself as mounted (src/components/RouteCommitted.tsx).
        // The saved copy is not live until the browser has run the bundle over it,
        // and e2e's gotoApp waits for exactly that marker, so it must not ship.
        await page.evaluate(() => {
          delete document.documentElement.dataset.routeCommitted
        })

        // Vite's runtime adds `modulepreload` hints for the route's chunks
        // using the *absolute* origin it was loaded from, so capturing the DOM
        // bakes `http://127.0.0.1:4183/assets/…` into the shipped HTML. The
        // hints are worth keeping — they are the route's own chunks — so make
        // them root-relative rather than dropping them.
        const html = `${MARKER}\n${dropVercelBeacon(
          restoreAsyncFont((await page.content()).replaceAll(`http://127.0.0.1:${PORT}/`, '/')),
        )}`
        if (html.includes(`127.0.0.1:${PORT}`)) {
          throw new Error(`${route}: the preview origin survived into the HTML`)
        }
        if (html.includes('data-route-committed')) {
          throw new Error(`${route}: the live-page marker survived into the HTML`)
        }
        // `<route>.html`, not `<route>/index.html`. Measured, not assumed: the
        // directory form is only served at `/faq/` with the trailing slash —
        // `/faq` falls straight through to the SPA fallback, which would have
        // shipped eight prerendered files that nothing ever requested. The
        // sibling file answers `/faq` and `/faq/` on `vite preview`, and on
        // Vercel because `vercel.json` sets `cleanUrls: true` — without it no
        // file named `faq` exists and the catch-all rewrite serves the empty
        // shell. With it the literal `/faq.html` answers a 308 to `/faq`.
        // Every copy declares `/faq` as its canonical. An article is
        // `dist/blog/<slug>.html`, beside `dist/blog.html`.
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

  // Two routes with one title is the defect this step exists to remove — every
  // page the home page — or two articles competing for one search result.
  // Either way it would fail silently, so assert it here rather than discover
  // it in Search Console.
  const dupes = duplicateTitles(results)
  if (dupes.length) {
    console.error(
      `\nPrerender gave more than one route the same title — the per-route head did not apply, ` +
        `or two published articles share a title. Refusing to ship pages that compete with each other:\n` +
        dupes.map((d) => `  "${d.title}": ${d.routes.join(', ')}`).join('\n'),
    )
    process.exit(1)
  }

  // An English or French page whose title is Hebrew — whole, or a Hebrew site
  // name after an English title — is the head of the wrong language (it was
  // "Self-check tools | דורית גוב ארי — …" before siteNameIn).
  const wrongLanguage = hebrewTitledLocalePages(results)
  if (wrongLanguage.length) {
    console.error(
      `
Prerender gave an English or French page a Hebrew title:\n` +
        wrongLanguage.map((r) => `  ${r.route}: "${r.title}"`).join('\n'),
    )
    process.exit(1)
  }

  // The fallback is the one output nothing downstream inspects — no route
  // serves it under `vite preview`, so a corrupted `app.html` would reach
  // production silently and hand crawlers the home page under every
  // not-yet-built article URL. Assert it is still an empty shell rather than
  // assume.
  const shell = await readFile(shellPath, 'utf8')
  const shellRoot = shell.match(/<div id="root">([\s\S]*?)<\/div>/)?.[1] ?? ''
  if (shell.includes(MARKER) || shellRoot.trim() !== '') {
    console.error(
      `\n::error::dist/app.html is not an empty SPA shell (${shellRoot.trim().length} chars in #root). ` +
        `Every route without a prerendered file would be served this content. ` +
        `Run a fresh build: npm run build:prerender`,
    )
    process.exit(1)
  }

  console.log(
    `\nPrerendered ${results.length} routes (${articles.routes.length} articles), every title distinct.`,
  )
}

await main()
