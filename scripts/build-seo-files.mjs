// After the prerender: sitemap.xml and llms.txt with every published article,
// and llms-full.txt with the FAQ and every article's text.
//
// Runs as the last step of `npm run build:prerender` (Vercel and CI). The
// Base44 Builder's `npm run build` does not run it and ships public/ as is.
//
// Templates are the dist/ copies, already pointed at the configured host by the
// site-url plugin (scripts/vite-site-url-plugin.mjs). The article list follows
// the prerender's rules (scripts/published-articles.mjs): production
// (PRERENDER_REQUIRED=1) fails without it; a preview warns and ships the
// static files.

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FAQ_ENTRIES } from '../src/content/faq.ts'
import { enabledLocales, translatedRoutes } from '../src/i18n/locales.ts'
import { buildEnv, loadPublishedArticles } from './published-articles.mjs'
import { buildLlms, buildLlmsFull, buildSitemap, originFromSitemap, withBuiltPages } from './seo-files.mjs'

const DIST = join(process.cwd(), 'dist')
const COLUMNS = 'slug,title,excerpt,body,updated_at,created_at'

async function main() {
  let loaded
  let env
  try {
    env = await buildEnv()
    loaded = await loadPublishedArticles(env, { columns: COLUMNS })
  } catch (err) {
    console.error(`\n::error::SEO files: ${err.message}`)
    process.exit(1)
  }
  if (loaded.warning) console.warn(`::warning::SEO files: ${loaded.warning}`)
  // Never list an article whose page was not built (a preview, or an article
  // published between the prerender and this step).
  const { kept: articles, dropped } = withBuiltPages(loaded.rows, (slug) =>
    existsSync(join(DIST, 'blog', `${slug}.html`)),
  )
  if (dropped.length) {
    console.warn(
      `::warning::SEO files: ${dropped.length} published article(s) have no prebuilt page and are left out: ${dropped.join(', ')}`,
    )
  }

  const sitemapTemplate = await readFile(join(DIST, 'sitemap.xml'), 'utf8')
  const llmsTemplate = await readFile(join(DIST, 'llms.txt'), 'utf8')
  const origin = originFromSitemap(sitemapTemplate)
  const faq = FAQ_ENTRIES.map(({ q, a }) => ({ q, a }))

  // The English and French pages, only when the build serves them (VITE_LOCALES).
  const localeRoutes = translatedRoutes(enabledLocales(env.VITE_LOCALES))
  await writeFile(join(DIST, 'sitemap.xml'), buildSitemap(sitemapTemplate, articles, localeRoutes), 'utf8')
  await writeFile(join(DIST, 'llms.txt'), buildLlms(llmsTemplate, origin, articles), 'utf8')
  await writeFile(join(DIST, 'llms-full.txt'), buildLlmsFull(llmsTemplate, origin, faq, articles), 'utf8')

  console.log(
    `SEO files: ${articles.length} articles, ${faq.length} questions and ${localeRoutes.length} English/French pages on ${origin}.`,
  )
}

main().catch((err) => {
  console.error(`\n::error::SEO files: ${err.stack ?? err.message}`)
  process.exit(1)
})
