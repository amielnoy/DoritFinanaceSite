import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";
import ReactMarkdown from "react-markdown";
import { Loader2, ArrowRight, Calendar } from "lucide-react";
import FloatingHeader from "@/components/dorit/FloatingHeader";
import Footer from "@/components/dorit/Footer";
import ShareButtons from "@/components/dorit/ShareButtons";
import {
  DEFAULT_OG_IMAGE,
  SITE_NAME,
  absoluteUrl,
  breadcrumbLd,
  clampDescription,
  useSeo,
} from "@/lib/seo";

interface BlogPostData {
  id: string;
  title: string;
  body?: string;
  image_url?: string;
  tags?: string;
  created_date: string;
}

export default function BlogPost() {
  const { id } = useParams<string>();
  const [post, setPost] = useState<BlogPostData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [notFound, setNotFound] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await base44.entities.BlogPost.get(id as string);
        setPost(data as unknown as BlogPostData);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const tagList = (post?.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  // Strip markdown so the description is prose, not syntax.
  const summary = post
    ? clampDescription(
        (post.body ?? "")
          .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/[#*_>`~-]/g, " ")
      )
    : "";

  useSeo(
    post
      ? {
          title: `${post.title} | בלוג · דורית גוב ארי`,
          description: summary || `מאמר מאת דורית גוב ארי — ${post.title}`,
          path: `/blog/${post.id}`,
          type: "article",
          image: post.image_url || DEFAULT_OG_IMAGE,
          imageAlt: post.title,
          publishedTime: post.created_date,
          tags: tagList,
          jsonLd: [
            breadcrumbLd([
              { name: "ראשי", path: "/" },
              { name: "בלוג", path: "/blog" },
              { name: post.title, path: `/blog/${post.id}` },
            ]),
            {
              "@context": "https://schema.org",
              "@type": "BlogPosting",
              headline: post.title,
              description: summary,
              datePublished: post.created_date,
              dateModified: post.created_date,
              inLanguage: "he-IL",
              mainEntityOfPage: {
                "@type": "WebPage",
                "@id": absoluteUrl(`/blog/${post.id}`),
              },
              author: {
                "@type": "Person",
                name: "דורית גוב ארי",
                jobTitle: "יועצת ביטוחית ופיננסית",
                url: absoluteUrl("/"),
              },
              publisher: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
              ...(post.image_url ? { image: post.image_url } : {}),
              ...(tagList.length ? { keywords: tagList.join(", ") } : {}),
            },
          ],
        }
      : notFound
        ? {
            // A missing post must never be indexed as a real article.
            title: "המאמר לא נמצא | דורית גוב ארי",
            description: "המאמר המבוקש אינו קיים או הוסר.",
            path: "/blog",
            noIndex: true,
          }
        : null
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin text-accent" />
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
        <p className="font-heading text-3xl">המאמר לא נמצא</p>
        <Link
          to="/blog"
          className="mt-6 inline-flex items-center gap-2 text-accent hover:underline"
        >
          חזרה לבלוג <ArrowRight size={16} />
        </Link>
      </div>
    );
  }

  return (
    <article className="relative bg-background min-h-screen">
      <FloatingHeader />
      <div className="pt-32 md:pt-36 pb-24">
        <div className="max-w-3xl mx-auto px-6 md:px-10">
          <Link
            to="/blog"
            className="inline-flex items-center gap-2 text-sm text-foreground/60 hover:text-accent transition-colors"
          >
            <ArrowRight size={16} /> חזרה לבלוג
          </Link>

          <div className="mt-8">
            <div className="flex items-center gap-2 text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
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
                      className="text-[10px] tracking-[0.15em] uppercase px-2 py-0.5 border border-border text-muted-foreground"
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

          <div className="mt-10 blog-body">
            <ReactMarkdown>{post.body || ""}</ReactMarkdown>
          </div>

          <ShareButtons title={post.title} />
        </div>
      </div>
      <Footer />
    </article>
  );
}