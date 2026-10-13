// The SEO files a build writes from the published articles: sitemap.xml,
// llms.txt and llms-full.txt. Pure string work, so it is tested without a
// build; scripts/build-seo-files.mjs does the reading and writing.
//
// The templates are the emitted copies of public/sitemap.xml and
// public/llms.txt, which the site-url plugin has already pointed at the
// configured host. Reading the host back from them means these files cannot
// name a different host from the rest of the build.

import { articleRoute } from './published-articles.mjs'

const PAGES_HEADING = '## דפים'
const CRAWLER_NOTE = '## הערה למנועי חיפוש ולסוכני AI'

const xmlEscape = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** One line of text: line breaks and runs of spaces become one space. */
const oneLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()

/** A link label: square brackets would end the Markdown link early, so they become parentheses. */
const linkLabel = (value) => oneLine(value).replace(/\[/g, '(').replace(/\]/g, ')')

/** The origin of the first https <loc> — the home page in public/sitemap.xml. */
export function originFromSitemap(xml) {
  const loc = /<loc>(https:\/\/[^<]+)<\/loc>/.exec(xml)
  if (!loc) throw new Error('sitemap.xml has no <loc> with an https URL to take the host from')
  return new URL(loc[1]).origin
}

/** An article's last change as an ISO timestamp, or null when it has no usable date. */
export function lastmodOf(row) {
  const raw = row?.updated_at ?? row?.updated_date ?? row?.created_at ?? row?.created_date
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * The template sitemap plus one entry per article. Static routes keep no
 * lastmod — there is no honest value for them; /blog takes its newest article's.
 */
export function buildSitemap(templateXml, articles) {
  if (articles.length === 0) return templateXml
  const origin = originFromSitemap(templateXml)
  const blogLoc = `<loc>${origin}/blog</loc>`
  if (!templateXml.includes(blogLoc)) throw new Error(`sitemap.xml template has no ${blogLoc}`)
  if (!templateXml.includes('</urlset>')) throw new Error('sitemap.xml template has no </urlset>')

  const newest = articles.map(lastmodOf).filter(Boolean).sort().at(-1)
  let xml = newest ? templateXml.replace(blogLoc, `${blogLoc}\n    <lastmod>${newest}</lastmod>`) : templateXml

  const entries = articles
    .map((article) => {
      const lastmod = lastmodOf(article)
      return (
        '  <url>\n' +
        `    <loc>${xmlEscape(origin + articleRoute(article.slug))}</loc>\n` +
        (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '') +
        '    <changefreq>monthly</changefreq>\n' +
        '    <priority>0.6</priority>\n' +
        '  </url>\n'
      )
    })
    .join('')
  return xml.replace('</urlset>', `${entries}</urlset>`)
}

/**
 * The template llms.txt with an "מאמרים" section before the crawler note, and
 * a pointer to llms-full.txt at the end of that note. Everything above the
 * inserted section is the template, byte for byte.
 */
export function buildLlms(template, origin, articles) {
  const at = template.indexOf(CRAWLER_NOTE)
  if (at === -1) throw new Error(`llms.txt template has no "${CRAWLER_NOTE}" heading`)
  const lines = articles.map((article) => {
    const excerpt = oneLine(article.excerpt)
    return `- [${linkLabel(article.title)}](${origin}${articleRoute(article.slug)})${excerpt ? ` — ${excerpt}` : ''}`
  })
  const section = articles.length ? `## מאמרים\n\n${lines.join('\n')}\n\n` : ''
  const full =
    `\nהטקסט המלא של השאלות והתשובות ושל כל המאמרים, בקובץ אחד: [llms-full.txt](${origin}/llms-full.txt).\n`
  return template.slice(0, at) + section + template.slice(at).replace(/\n*$/, '\n') + full
}

/**
 * The full text an assistant can read in one request: the template's header
 * (identity, contact, disclosure, limitations — everything before "## דפים"),
 * every question and answer, and every article's body under its title and
 * address.
 */
export function buildLlmsFull(template, origin, faq, articles) {
  const at = template.indexOf(PAGES_HEADING)
  if (at === -1) throw new Error(`llms.txt template has no "${PAGES_HEADING}" heading`)
  const parts = [template.slice(0, at).replace(/\n*$/, '\n\n')]

  parts.push(`## שאלות ותשובות\n\nמקור: ${origin}/faq\n\n`)
  for (const { q, a } of faq) parts.push(`### ${oneLine(q)}\n\n${String(a).trim()}\n\n`)

  if (articles.length) {
    parts.push('## מאמרים\n\n')
    for (const article of articles) {
      const lastmod = lastmodOf(article)
      const dated = lastmod ? ` · עודכן ${lastmod.slice(0, 10)}` : ''
      parts.push(
        `### ${oneLine(article.title)}\n\n${origin}${articleRoute(article.slug)}${dated}\n\n${String(article.body ?? '').trim()}\n\n`,
      )
    }
  }
  return parts.join('').replace(/\n+$/, '\n')
}
