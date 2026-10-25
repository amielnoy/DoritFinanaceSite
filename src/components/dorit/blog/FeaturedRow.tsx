import React from "react";
import { Link } from "react-router-dom";
import type { Article } from "@/services";
import { Zap } from "lucide-react";
import { articlePath } from "@/lib/articlePath";
import ArticleMeta from "./ArticleMeta";
import { FOCUS_RING } from "./ArticleCard";

/**
 * The deadline article beside the three quickest to act on.
 *
 * The large card is one link: its "לקריאת המדריך" stretches over the whole
 * card, so the card is clickable everywhere without reading the same link
 * twice to a screen reader.
 */
export default function FeaturedRow({
  featured,
  badge,
  topicLabel,
  fastest,
}: {
  featured: Article;
  badge: string;
  topicLabel?: string;
  fastest: readonly Article[];
}) {
  return (
    <section
      aria-label="מומלץ עכשיו"
      data-track-location="blog_featured"
      className="grid grid-cols-1 md:grid-cols-3 gap-6"
    >
      <article
        data-testid="article-card"
        className="relative md:col-span-2 card-raised !border-s-4 !border-s-primary p-6 md:p-8 flex flex-col transition-shadow hover:shadow-md"
      >
        <span className="self-start bg-primary text-primary-foreground text-sm font-semibold px-3 py-1 rounded-lg">
          {badge}
        </span>
        {topicLabel ? <p className="mt-5 text-sm font-semibold text-accent">{topicLabel}</p> : null}
        <h3 className="font-heading font-bold text-2xl md:text-3xl mt-1.5 leading-snug text-foreground">{featured.title}</h3>
        {featured.excerpt ? (
          <p className="mt-3 text-base leading-relaxed text-foreground/80 line-clamp-3 md:line-clamp-none">
            {featured.excerpt}
          </p>
        ) : null}
        <ArticleMeta actionTime={featured.action_time} body={featured.body} className="mt-5" />
        <Link
          to={articlePath(featured)}
          className={`mt-5 self-start inline-flex items-center min-h-11 text-accent font-semibold underline underline-offset-4 decoration-highlight/50 hover:decoration-highlight after:absolute after:inset-0 after:content-[''] ${FOCUS_RING}`}
        >
          לקריאת המדריך ←
        </Link>
      </article>

      {fastest.length > 0 ? (
        <div className="card-raised p-6">
          <h3 className="flex items-center gap-2 font-heading font-bold text-xl text-foreground">
            <Zap size={20} className="text-accent" aria-hidden="true" />
            הכי מהיר לביצוע
          </h3>
          <ul className="mt-2">
            {fastest.map((p) => (
              <li key={p.id} className="border-t border-border first:border-t-0">
                <Link to={articlePath(p)} className={`group block py-3.5 min-h-11 ${FOCUS_RING}`}>
                  <span className="text-sm font-medium text-accent bg-highlight/15 px-2 py-0.5 rounded-md">
                    ביצוע: {p.action_time}
                  </span>
                  <span className="block mt-1.5 font-heading font-semibold text-lg leading-snug text-foreground group-hover:text-accent transition-colors">
                    {p.title}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
