// Tell IndexNow (Bing, Yandex, Seznam, Naver…) which articles changed, right
// after a production deploy. Reads the live sitemap, so it submits exactly what
// is now served. Articles only: static routes are submitted once, by hand, from
// the launch checklist. Never fails the deploy — every problem is a ::warning::.
//
// The key is public by design: IndexNow proves ownership by fetching
// <origin>/<key>.txt, which is public/<key>.txt.

import { pathToFileURL } from 'node:url'

export const INDEXNOW_KEY = '871ea90b6bf1cbdeeb392aa9705d1246'
const ENDPOINT = 'https://api.indexnow.org/indexnow'

/** Article URLs (`/blog/<slug>`) whose lastmod falls within the last `hours`. */
export function recentUrls(sitemapXml, now = new Date(), hours = 48) {
  const since = now.getTime() - hours * 3600 * 1000
  const urls = []
  for (const [, block] of sitemapXml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>([^<]+)<\/loc>/.exec(block)?.[1]
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(block)?.[1]
    if (!loc || !lastmod || !/\/blog\/[^/]+$/.test(loc)) continue
    const at = new Date(lastmod).getTime()
    if (!Number.isNaN(at) && at >= since) urls.push(loc)
  }
  return urls
}

export function indexNowBody(origin, urls) {
  return { host: new URL(origin).host, key: INDEXNOW_KEY, keyLocation: `${origin}/${INDEXNOW_KEY}.txt`, urlList: urls }
}

export async function submit({ origin, fetchImpl = fetch, now = new Date(), log = console }) {
  const site = String(origin ?? '').replace(/\/+$/, '')
  if (!site) {
    log.warn('::warning::IndexNow: PRODUCTION_URL is not set; nothing submitted.')
    return { submitted: 0 }
  }
  try {
    const sitemap = await fetchImpl(`${site}/sitemap.xml`)
    if (!sitemap.ok) {
      log.warn(`::warning::IndexNow: ${site}/sitemap.xml answered HTTP ${sitemap.status}; nothing submitted.`)
      return { submitted: 0 }
    }
    const recent = recentUrls(await sitemap.text(), now)
    const urls = recent.filter((u) => u.startsWith(`${site}/`))
    if (recent.length > 0 && urls.length === 0) {
      log.warn(`::warning::IndexNow: the sitemap's article URLs are not on ${site}; nothing submitted.`)
      return { submitted: 0 }
    }
    if (urls.length === 0) {
      log.info('IndexNow: no article changed in the last 48 hours; nothing to submit.')
      return { submitted: 0 }
    }
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(indexNowBody(site, urls)),
    })
    if (res.status !== 200 && res.status !== 202) {
      log.warn(`::warning::IndexNow refused the submission: HTTP ${res.status} ${await res.text().catch(() => '')}`.trim())
      return { submitted: 0 }
    }
    log.info(`IndexNow: submitted ${urls.length} article URL(s).`)
    return { submitted: urls.length }
  } catch (err) {
    log.warn(`::warning::IndexNow could not be reached: ${err.message}`)
    return { submitted: 0 }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await submit({ origin: process.env.PRODUCTION_URL })
}
