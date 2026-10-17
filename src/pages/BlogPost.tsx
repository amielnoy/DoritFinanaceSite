import React from "react";
import { useParams, Link, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { contentKeys, useArticle } from "@/hooks/useContent";
import type { Article } from "@/services";
import { Image } from "@/components/ui/image";
import ReactMarkdown from "react-markdown";
import { Loader2, ArrowRight, Calendar } from "lucide-react";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import ShareButtons from "@/components/dorit/primitives/ShareButtons";
import CredentialsStrip from "@/components/dorit/primitives/CredentialsStrip";
import { useSeo } from "@/lib/seo";
import { articlePath } from "@/lib/articlePath";
import { BLOG_POST_NOT_FOUND_SEO, computeBlogSeoConfig } from "@/lib/blogSeo";
import { splitAfterParagraph } from "@/lib/articleCta";
import ArticleContactBox from "@/components/dorit/blog/ArticleContactBox";
import { GlossedChildren } from "@/components/dorit/primitives/Glossed";
import { newGlossScope, type GlossScope } from "@/lib/glossary";

export default function BlogPost() {
  /** A slug, or — from a link made before slugs — a Base44 id or a uuid. */
  const { key } = useParams<{ key: string }>();
  const { data, isPending: loading, isError: notFound } = useArticle(key);
  const post: Article | null = data ?? null;
  const navigate = useNavigate();
  const { search, hash } = useLocation();
  const queryClient = useQueryClient();

  // A missing post must never be indexed as a real article — same rule
  // api/og/blog.ts falls back to when Supabase has nothing for the key.
  useSeo(post ? computeBlogSeoConfig(post) : notFound ? BLOG_POST_NOT_FOUND_SEO : null);

  // Reached by an old address (a Base44 id from a bookmark, a search result
  // or an agent's answer): show the article, then take the address it lives
  // at, so what the visitor copies or shares is the slug. `replace`, so Back
  // does not return to the old form and bounce forward again. The query and
  // hash the link carried come along (utm_* tags among them). The article is
  // put under its new key first, so the switch costs no second read.
  React.useEffect(() => {
    if (!post?.slug || post.slug === key) return;
    queryClient.setQueryData(contentKeys.article(post.slug), post);
    navigate(`${articlePath(post)}${search}${hash}`, { replace: true });
  }, [post, key, search, hash, navigate, queryClient]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin text-accent" />
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <main id="main" className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <h1 className="font-heading text-3xl">המאמר לא נמצא</h1>
        <Link
          to="/blog"
          className="mt-6 inline-flex items-center gap-2 text-accent hover:underline"
        >
          חזרה לבלוג <ArrowRight size={16} />
        </Link>
      </main>
    );
  }

  // The header and footer outside `<main id="main">`, and the article inside it: the
  // whole page used to be one `<article>` with no `<main id="main">` (D-08, manual test
  // 2026-10-14).
  return (
    <div className="relative bg-background min-h-screen">
      <FloatingHeader />
      <main id="main" className="pt-32 md:pt-36 pb-24">
        <article className="max-w-3xl mx-auto px-6 md:px-10">
          <Link
            to="/blog"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-accent transition-colors"
          >
            <ArrowRight size={16} /> חזרה לבלוג
          </Link>

          <div className="mt-8">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar size={13} />
              {new Date(post.created_date).toLocaleDateString("he-IL", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </div>
            <h1 className="font-heading text-4xl md:text-5xl mt-4 leading-tight">
              {post.title}
            </h1>
            {post.tags && (
              <div className="mt-4 flex flex-wrap gap-2">
                {post.tags
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
                  .map((t) => (
                    <span
                      key={t}
                      className="text-sm px-2 py-0.5 border border-border text-muted-foreground"
                    >
                      {t}
                    </span>
                  ))}
              </div>
            )}
          </div>

          {post.image_url && (
            <div className="mt-8 overflow-hidden">
              <Image
                src={post.image_url}
                alt={post.title}
                className="w-full h-64 md:h-80 object-cover"
                fittingType="fill"
              />
            </div>
          )}

          <ArticleBody post={post} />
          <ArticleContactBox post={post} placement="article_end" />

          <div className="mt-10">
            <CredentialsStrip />
          </div>

          <ShareButtons title={post.title} />
        </article>
      </main>
      <Footer />
    </div>
  );
}

/** The body, with a contact box after its third paragraph when more follows. */
function ArticleBody({ post }: { post: Article }) {
  const split = splitAfterParagraph(post.body || "", 3);
  // One underline per term across the whole article, not one per paragraph.
  const components = React.useMemo(() => glossedMarkdown(newGlossScope()), [post.body]);
  if (!split) {
    return (
      <div className="mt-10 blog-body">
        <ReactMarkdown components={components}>{post.body || ""}</ReactMarkdown>
      </div>
    );
  }
  return (
    <div className="mt-10 blog-body">
      <ReactMarkdown components={components}>{split[0]}</ReactMarkdown>
      <ArticleContactBox post={post} placement="article_inline" />
      <ReactMarkdown components={components}>{split[1]}</ReactMarkdown>
    </div>
  );
}

/**
 * Paragraphs and list items gloss their plain text; headings, links and
 * emphasis are left as written. The `node` prop react-markdown passes is
 * dropped so it does not reach the DOM.
 */
function glossedMarkdown(scope: GlossScope) {
  return {
    p: ({ node: _node, children, ...rest }: React.ComponentPropsWithoutRef<"p"> & { node?: unknown }) => (
      <p {...rest}>
        <GlossedChildren scope={scope}>{children}</GlossedChildren>
      </p>
    ),
    li: ({ node: _node, children, ...rest }: React.ComponentPropsWithoutRef<"li"> & { node?: unknown }) => (
      <li {...rest}>
        <GlossedChildren scope={scope}>{children}</GlossedChildren>
      </li>
    ),
  };
}
