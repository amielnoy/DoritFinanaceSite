import React from "react";
import { Link } from "react-router-dom";
import { Calculator, FileSearch, MessageCircle } from "lucide-react";
import { CONTACT } from "@/config/contact";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import type { Article } from "@/services";
import { articleCtaHeadline, articleOffer, articleWhatsappText } from "@/lib/articleCta";

type Placement = "article_inline" | "article_end";

/**
 * A contact box inside an article: after its third paragraph and again at its
 * end. One question, one way to ask it — WhatsApp, pre-filled with the
 * article's title — and the one next step its topic calls for (articleOffer). The click
 * is counted by initClickTracking as click_whatsapp at this placement.
 */
export default function ArticleContactBox({
  post,
  placement,
}: {
  post: Pick<Article, "title" | "tags" | "cta_headline">;
  placement: Placement;
}) {
  const titleId = `article-cta-${placement}`;
  const offer = articleOffer(post);
  return (
    <aside
      aria-labelledby={titleId}
      data-track-location={placement}
      data-testid={placement}
      className="not-prose my-10 border border-accent/40 bg-secondary/40 px-6 py-6 md:px-8"
    >
      <p id={titleId} className="font-heading text-xl md:text-2xl leading-snug">
        {articleCtaHeadline(post)}
      </p>
      <p className="mt-2 text-muted-foreground leading-relaxed">
        כותבים לה בוואטסאפ, והיא חוזרת אליכם בעצמה — בלי התחייבות.
      </p>
      <div className="mt-5 flex flex-col sm:flex-row gap-3">
        <a
          href={`https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(articleWhatsappText(post.title))}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 min-h-12 px-[26px] rounded-md bg-whatsapp text-foreground font-heading font-medium text-lg hover:bg-whatsapp/90 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <MessageCircle size={20} aria-hidden="true" />
          שאלה לדורית בוואטסאפ
        </a>
        {offer ? (
          <Link to={offer.href} className={ctaClass(undefined, { muted: true })}>
            {offer.kind === "tools" ? <Calculator size={18} aria-hidden="true" /> : <FileSearch size={18} aria-hidden="true" />}
            {offer.label}
          </Link>
        ) : null}
      </div>
    </aside>
  );
}
