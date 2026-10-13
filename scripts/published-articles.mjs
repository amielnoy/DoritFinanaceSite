// The published articles, as the build sees them.
//
// One module for every build step that needs the list, so they cannot disagree
// about what is published: scripts/prerender.mjs (a prebuilt page per article)
// and scripts/build-seo-files.mjs (the sitemap and llms.txt) both read the list
// through loadPublishedArticles.
//
// Read from Supabase's REST API with the publishable key — the same anonymous
// read the site makes — so row-level security returns published rows only. The
// `published=eq.true` filter says so explicitly as well.

import { readFile } from 'node:fs/promises'

/**
 * Latin kebab-case, never shaped like a Base44 id. The same rule as
 * src/lib/articlePath.ts, the slug migration's CHECK and contentAdmin —
 * tests/contract/article-slug.contract.test.ts fails when they drift.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/

export const isValidSlug = (slug) =>
  typeof slug === 'string' && SLUG_PATTERN.test(slug) && !BASE44_ID_PATTERN.test(slug)

/** The address an article is prebuilt at. */
export const articleRoute = (slug) => `/blog/${slug}`

/** A slug becomes a file name under dist/blog/, so one that is not kebab-case is never used. */
function assertSlugs(rows, source) {
  for (const row of rows) {
    if (!isValidSlug(row?.slug)) {
      throw new Error(`${source}: a published article has an unusable slug: ${JSON.stringify(row?.slug)}`)
    }
  }
}

/** PostgREST's page size here. Supabase caps a single answer (max-rows), so a list is read in pages. */
export const PAGE_SIZE = 1000

/**
 * Every published article's row, newest first.
 *
 * `columns` must include `slug`. Throws — never returns a short or empty list
 * it cannot vouch for — when a read fails, when an answer has no total
 * (`Content-Range: <from>-<to>/<total>`, asked for with `Prefer: count=exact`),
 * or when the rows read fall short of that total. A cut-off list would build a
 * sitemap missing articles and look like success.
 */
export async function fetchPublishedArticles({
  url,
  key,
  columns = 'slug,updated_at',
  fetchImpl = fetch,
  pageSize = PAGE_SIZE,
}) {
  const params = new URLSearchParams({ select: columns, published: 'eq.true', order: 'created_at.desc' })
  const endpoint = `${url.replace(/\/+$/, '')}/rest/v1/blog_posts?${params}`
  const rows = []
  let total = null
  for (let from = 0; total === null || from < total; from += pageSize) {
    const res = await fetchImpl(endpoint, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        Prefer: 'count=exact',
        'Range-Unit': 'items',
        Range: `${from}-${from + pageSize - 1}`,
      },
    })
    if (!res.ok) throw new Error(`blog_posts read failed: HTTP ${res.status}`)
    const page = await res.json().catch(() => null)
    if (!Array.isArray(page)) throw new Error('blog_posts read failed: the answer is not a list')
    const counted = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '')
    if (!counted) {
      throw new Error(
        'blog_posts read failed: no total in Content-Range, so a cut-off list could not be told from a complete one',
      )
    }
    total = Number(counted[1])
    rows.push(...page)
    if (page.length === 0) break
  }
  if (rows.length !== total) throw new Error(`blog_posts read is incomplete: ${rows.length} of ${total} rows`)
  assertSlugs(rows, 'blog_posts')
  return rows
}

/**
 * The published articles a build step works from, decided from the build's
 * environment. One function so the prerender and the SEO files cannot disagree
 * about what is published. Rules:
 *
 *   PRERENDER_ARTICLES_FIXTURE     A JSON file of rows with a slug, for the e2e
 *                                  build. Refused in a Vercel build and in a
 *                                  bundle that reads Supabase.
 *   VITE_SUPABASE_URL +
 *   VITE_SUPABASE_PUBLISHABLE_KEY  The live list, with the columns asked for.
 *   PRERENDER_REQUIRED=1           A list that cannot be had throws. Without it
 *                                  the step warns and goes on with no articles.
 */
export async function loadPublishedArticles(
  env,
  { columns = 'slug,updated_at', fetchImpl = fetch, readFileImpl = readFile } = {},
) {
  const required = env.PRERENDER_REQUIRED === '1'
  const url = (env.VITE_SUPABASE_URL ?? '').trim()
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim()
  const fixture = (env.PRERENDER_ARTICLES_FIXTURE ?? '').trim()

  if (fixture) {
    if (env.VERCEL === '1' || env.VERCEL_ENV) {
      throw new Error(
        'PRERENDER_ARTICLES_FIXTURE is set in a Vercel build — refusing to prebuild test articles into a deployment.',
      )
    }
    if (url && key) {
      throw new Error(
        'PRERENDER_ARTICLES_FIXTURE answers Base44 reads, but this bundle reads Supabase. ' +
          'Build with VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY empty.',
      )
    }
    const rows = JSON.parse(await readFileImpl(fixture, 'utf8'))
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${fixture}: expected a non-empty list of articles`)
    assertSlugs(rows, fixture)
    return { rows, fromFixture: true, warning: null }
  }

  if (!url || !key) {
    const why =
      'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not both set, so the published articles cannot be listed'
    if (required) throw new Error(`${why}.`)
    return { rows: [], fromFixture: false, warning: `${why}; articles are left out.` }
  }

  try {
    return { rows: await fetchPublishedArticles({ url, key, columns, fetchImpl }), fromFixture: false, warning: null }
  } catch (err) {
    if (required) throw err
    return {
      rows: [],
      fromFixture: false,
      warning: `Could not list the published articles (${err.message}); articles are left out.`,
    }
  }
}

/** Which articles this build prebuilds: routes, the fixture rows (null outside fixture mode) and a warning. */
export async function planArticles(env, opts = {}) {
  const { rows, fromFixture, warning } = await loadPublishedArticles(env, opts)
  return {
    routes: [...new Set(rows.map((r) => articleRoute(r.slug)))],
    fixtureRows: fromFixture ? rows : null,
    warning: warning && warning.replace('articles are left out', 'articles are not prebuilt'),
  }
}

/** The fixture row a prerendered page's Base44 read asks for, by the key at the end of its URL. */
export function fixtureArticleFor(requestUrl, rows) {
  const key = decodeURIComponent(new URL(requestUrl).pathname.split('/').pop() ?? '')
  return rows.find((r) => r.slug === key) ?? null
}

/** Each title more than one route was rendered with, and the routes that share it. */
export function duplicateTitles(results) {
  const byTitle = new Map()
  for (const { route, title } of results) byTitle.set(title, [...(byTitle.get(title) ?? []), route])
  return [...byTitle]
    .filter(([, routes]) => routes.length > 1)
    .map(([title, routes]) => ({ title, routes }))
}
