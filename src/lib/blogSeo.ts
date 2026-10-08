// A single place to turn an Article into its SeoConfig — used by the client
// route (src/pages/BlogPost.tsx, via useSeo) and by the server-side bot
// response (api/og/blog/[id].ts, via renderSeoHtml). One function, so the
// two can never disagree about what a post's title, description or image is.

import type { Article } from "@/services";
import {
  DEFAULT_OG_IMAGE,
  SITE_NAME,
  absoluteUrl,
  breadcrumbLd,
  clampDescription,
  type SeoConfig,
} from "./seo";

/** Markdown stripped to prose — a description is read, not rendered. */
function stripMarkdown(body: string): string {
  return body.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#*_>`~-]/g, " ");
}

export function blogSummary(post: Pick<Article, "body">): string {
  return clampDescription(stripMarkdown(post.body ?? ""));
}

export function blogTagList(post: Pick<Article, "tags">): string[] {
  return (post.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function computeBlogSeoConfig(post: Article): SeoConfig {
  const summary = blogSummary(post);
  const tagList = blogTagList(post);
  const path = `/blog/${post.id}`;

  return {
    title: `${post.title} | בלוג · דורית גוב ארי`,
    description: summary || `מאמר מאת דורית גוב ארי — ${post.title}`,
    path,
    type: "article",
    image: post.image_url || DEFAULT_OG_IMAGE,
    imageAlt: post.title,
    publishedTime: post.created_date,
    tags: tagList,
    jsonLd: [
      breadcrumbLd([
        { name: "ראשי", path: "/" },
        { name: "בלוג", path: "/blog" },
        { name: post.title, path },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: post.title,
        description: summary,
        datePublished: post.created_date,
        dateModified: post.created_date,
        inLanguage: "he-IL",
        mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(path) },
        author: {
          "@type": "Person",
          name: "דורית גוב ארי",
          jobTitle: "מתכננת פיננסית וסוכנת ביטוח",
          url: absoluteUrl("/"),
        },
        publisher: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
        ...(post.image_url ? { image: post.image_url } : {}),
        ...(tagList.length ? { keywords: tagList.join(", ") } : {}),
      },
    ],
  };
}

/** The not-found case — kept beside the real one so both live where the data does. */
export const BLOG_POST_NOT_FOUND_SEO: SeoConfig = {
  title: "המאמר לא נמצא | דורית גוב ארי",
  description: "המאמר המבוקש אינו קיים או הוסר.",
  path: "/blog",
  noIndex: true,
};
