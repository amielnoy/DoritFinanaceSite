// The published articles, as the build sees them.
//
// One module for every build step that needs the list, so they cannot disagree
// about what is published: scripts/prerender.mjs today (a prebuilt page per
// article), and the sitemap and llms.txt generator after it.
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

/**
 * Every published article's row, newest first.
 *
 * `columns` must include `slug`. Throws — never returns an empty list — when
 * the read fails or the answer cannot be trusted: "no articles" would build a
 * site with no article pages and look like success.
 */
export async function fetchPublishedArticles({ url, key, columns = 'slug,updated_at', fetchImpl = fetch }) {
  const params = new URLSearchParams({ select: columns, published: 'eq.true', order: 'created_at.desc' })
  const res = await fetchImpl(`${url.replace(/\/+$/, '')}/rest/v1/blog_posts?${params}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`blog_posts read failed: HTTP ${res.status}`)
  const rows = await res.json().catch(() => null)
  if (!Array.isArray(rows)) throw new Error('blog_posts read failed: the answer is not a list')
  assertSlugs(rows, 'blog_posts')
  return rows
}

/**
 * Which articles this build prebuilds, decided from the build's environment.
 *
 *   PRERENDER_ARTICLES_FIXTURE   A JSON file of Base44-shaped rows with a slug,
 *                                for the e2e build: hermetic, no Supabase. The
 *                                page's Base44 read is answered from it. Refused
 *                                in a Vercel build and in a bundle that reads
 *                                Supabase, so test articles never ship.
 *   VITE_SUPABASE_URL +
 *   VITE_SUPABASE_PUBLISHABLE_KEY  The live list.
 *   PRERENDER_REQUIRED=1         A list that cannot be had fails the build —
 *                                production must not ship a blog without its
 *                                pages. Without it the build warns and
 *                                prebuilds the static routes only.
 *
 * Returns the routes to add, the fixture rows (null outside fixture mode) and a
 * warning to print (null when there is nothing to say). Throws when the build
 * must stop.
 */
export async function planArticles(env, { fetchImpl = fetch, readFileImpl = readFile } = {}) {
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
    return { routes: rows.map((r) => articleRoute(r.slug)), fixtureRows: rows, warning: null }
  }

  if (!url || !key) {
    const why =
      'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not both set, so the published articles cannot be listed'
    if (required) throw new Error(`${why}.`)
    return { routes: [], fixtureRows: null, warning: `${why}; articles are not prebuilt.` }
  }

  try {
    const rows = await fetchPublishedArticles({ url, key, fetchImpl })
    return { routes: [...new Set(rows.map((r) => articleRoute(r.slug)))], fixtureRows: null, warning: null }
  } catch (err) {
    if (required) throw err
    return {
      routes: [],
      fixtureRows: null,
      warning: `Could not list the published articles (${err.message}); articles are not prebuilt.`,
    }
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
