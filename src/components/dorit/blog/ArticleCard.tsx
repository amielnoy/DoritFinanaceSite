import React from "react";
import { Link } from "react-router-dom";
import { Image } from "@/components/ui/image";
import type { Article } from "@/services";
import { cn } from "@/lib/utils";
import ArticleMeta from "./ArticleMeta";

export const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight";

/**
 * One article in the grid: a full card from `md`, a compact row on a phone
 * (title and times only), so the list reads as a list at 375px instead of a
 * stack of 300px cards. Text only — the image appears only when the article
 * has a real one; a grey placeholder on every card said nothing.
 */
export default function ArticleCard({
  post,
  topicLabel,
  className,
}: {
  post: Article;
  topicLabel?: string;
  className?: string;
}) {
  return (
    <Link
      id={`post-${post.id}`}
      data-testid="article-card"
      to={`/blog/${post.id}`}
      className={cn(
        "group flex flex-col border-t border-border py-5",
        "md:border md:border-border md:bg-card md:p-6 md:rounded-md md:hover:border-accent md:transition-colors",
        FOCUS_RING,
        className
      )}
    >
      {post.image_url ? (
        <div className="hidden md:block aspect-video -mx-6 -mt-6 mb-5 overflow-hidden rounded-t-md bg-secondary">
          <Image src={post.image_url} alt="" className="w-full h-full object-cover" fittingType="fill" />
        </div>
      ) : null}
      {topicLabel ? <p className="text-sm font-semibold text-accent">{topicLabel}</p> : null}
      <h3 className="font-heading text-xl mt-1.5 leading-snug text-foreground group-hover:text-accent transition-colors">
        {post.title}
      </h3>
      {post.excerpt ? (
        // `md:line-clamp-2` carries its own `display`; a separate `md:block`
        // would override it and unclamp the text.
        <p className="hidden md:line-clamp-2 mt-3 text-sm leading-relaxed text-foreground/80">{post.excerpt}</p>
      ) : null}
      <ArticleMeta actionTime={post.action_time} body={post.body} className="mt-3 md:mt-auto md:pt-5" />
    </Link>
  );
}
