// נתונים מובנים משותפים. Structured data shared across routes.
//
// FAQPage markup may only appear on a page that actually renders those
// questions. It used to sit in index.html, which meant every route — /privacy,
// /blog, each post — claimed an FAQ it did not display. It now belongs to the
// home page alone, injected by its useSeo() call.
//
// The organisation-level FinancialService and Person blocks stay in index.html:
// they describe the business itself and are valid site-wide, and keeping them
// static means crawlers that do not execute JavaScript still see them.

/**
 * FAQPage markup, built from the questions the page actually renders.
 *
 * The previous block was a hand-written copy of six questions that lived on
 * /faq and was emitted on the home page, which rendered a list of tips instead.
 * Google's policy is that the answer must be visible on the URL claiming it, so
 * that markup described content that was not there — and duplicated an FAQ that
 * a second URL was also entitled to claim.
 *
 * Deriving it from the same array the page maps over makes the two incapable of
 * disagreeing: a question removed from the page leaves the markup with it.
 */
export function faqLd(items: Array<{ q: string; a: string }>): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

