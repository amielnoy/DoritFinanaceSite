import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useArticles } from "@/hooks/useContent";
import { Image } from "@/components/ui/image";
import { Loader2, ArrowLeft, Newspaper, Search, X } from "lucide-react";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import AgentChat from "@/components/dorit/chat/AgentChat";
import { AGENTS } from "@/config/agents";
import { readRecommendation } from "@/lib/blog-recommendation";
import Footer from "@/components/dorit/layout/Footer";
import Reveal from "@/components/dorit/primitives/Reveal";
import CredentialsStrip from "@/components/dorit/primitives/CredentialsStrip";
import { SITE_NAME, absoluteUrl, breadcrumbLd, useSeo } from "@/lib/seo";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";

const RECOMMENDED_BANNER_ID = "blog-recommended";

interface BlogListItem {
  id: string;
  title: string;
  excerpt?: string;
  image_url?: string;
  tags?: string;
  created_date: string;
}

export default function Blog() {
  const { data, isPending: loading } = useArticles();
  const posts = (data ?? null) as BlogListItem[] | null;
  const [query, setQuery] = useState<string>("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  /** Post ids the reading-recommender chose, read from its `recommended`
   *  block — see src/lib/blog-recommendation.ts. While set, the grid shows
   *  only these posts. */
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);

  // The grid is further down the same page, and `useArticles()` may not have
  // resolved the instant a recommendation arrives — keep looking for the
  // banner until it mounts, same pattern as ScrollToTop.jsx's hash handling.
  // The banner rather than the first card, so the way back to every post is
  // on screen too.
  React.useEffect(() => {
    if (!recommendedIds.length) return;
    const deadline = Date.now() + 3000;
    let timer: number;
    const tryScroll = () => {
      const target = document.getElementById(RECOMMENDED_BANNER_ID);
      if (target) {
        target.scrollIntoView({ behavior: "smooth" });
        return;
      }
      if (Date.now() < deadline) timer = window.setTimeout(tryScroll, 50);
    };
    timer = window.setTimeout(tryScroll, 50);
    return () => window.clearTimeout(timer);
  }, [recommendedIds]);

  useSeo({
    title: "בלוג — חידושים ותובנות בביטוח ובפיננסים | דורית גוב ארי",
    description:
      "מאמרים קצרים על פנסיה, דמי ניהול, ביטוחי חיים ובריאות וליווי תביעות — תובנות מהשטח שיעזרו לכם לקבל החלטות פיננסיות מושכלות.",
    path: "/blog",
    jsonLd: [
      breadcrumbLd([
        { name: "ראשי", path: "/" },
        { name: "בלוג", path: "/blog" },
      ]),
      {
        "@context": "https://schema.org",
        "@type": "Blog",
        name: `בלוג · ${SITE_NAME}`,
        url: absoluteUrl("/blog"),
        inLanguage: "he-IL",
        ...(posts?.length
          ? {
              blogPost: posts.slice(0, 20).map((post) => ({
                "@type": "BlogPosting",
                headline: post.title,
                url: absoluteUrl(`/blog/${post.id}`),
                datePublished: post.created_date,
                ...(post.image_url ? { image: post.image_url } : {}),
              })),
            }
          : {}),
      },
    ],
  });


  const allTags = React.useMemo(() => {
    if (!posts) return [];
    const set = new Set<string>();
    posts.forEach((p) => {
      if (p.tags) {
        p.tags.split(",").forEach((t) => {
          const trimmed = t.trim();
          if (trimmed) set.add(trimmed);
        });
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "he"));
  }, [posts]);

  const filtered = React.useMemo(() => {
    if (!posts) return [];
    const q = query.trim().toLowerCase();
    return posts.filter((p) => {
      const matchesQuery =
        !q ||
        p.title.toLowerCase().includes(q) ||
        (p.excerpt || "").toLowerCase().includes(q) ||
        (p.tags || "").toLowerCase().includes(q);
      const matchesTag =
        !activeTag ||
        (p.tags || "")
          .split(",")
          .map((t) => t.trim())
          .includes(activeTag);
      return matchesQuery && matchesTag;
    });
  }, [posts, query, activeTag]);

  // In the order the agent ranked them. Ids with no matching post (one taken
  // down since, or a model slip) are dropped; if none match, nothing is
  // filtered — an empty page answers the visitor's question worse than all.
  const recommended = React.useMemo(() => {
    if (!posts || !recommendedIds.length) return [];
    const byId = new Map(posts.map((p) => [p.id, p]));
    return [...new Set(recommendedIds)]
      .map((id) => byId.get(id))
      .filter((p): p is BlogListItem => Boolean(p));
  }, [posts, recommendedIds]);

  const showingRecommended = recommended.length > 0;
  const visiblePosts = showingRecommended ? recommended : filtered;

  // One filter at a time: a recommendation intersected with an unrelated
  // search or tag would usually leave nothing on screen.
  const clearRecommendation = () => setRecommendedIds([]);

  return (
    <div className="relative bg-background min-h-screen">
      <FloatingHeader />
      <div className="pt-32 md:pt-36 pb-24">
        <div className="max-w-[1400px] mx-auto px-6 md:px-10">
          <Reveal>
            <Eyebrow>
              מאמרים ותובנות
            </Eyebrow>
            <h1 className="font-heading text-5xl md:text-6xl mt-5 leading-tight">
              בלוג · חידושים בעולם הביטוח
            </h1>
            <p className="mt-6 max-w-2xl text-foreground/70 leading-relaxed text-lg">
              עדכונים קצרים מהשטח — חידושים, מגמות ותובנות שמשפיעים על ההחלטות
              הפיננסיות שלכם.
            </p>
          </Reveal>

          <CredentialsStrip />
        </div>
      </div>

      {/* The reading recommender, where the reading is.
          It sat on the home page between a contact form and an FAQ, recommending
          articles to people who had not said they wanted to read anything. Here
          it answers the question the visitor arrived with. */}
      <AgentChat
        descriptor={AGENTS.blogRecommender}
        onAssistantMessage={(content) => {
          const { ids } = readRecommendation(content);
          if (!ids.length) return;
          setRecommendedIds(ids);
          setQuery("");
          setActiveTag(null);
        }}
      />

      <div className="pb-24">
        <div className="max-w-[1400px] mx-auto px-6 md:px-10">

          {!loading && posts && posts.length > 0 && (
            <div className="mt-12 space-y-6">
              <div className="relative max-w-xl">
                <Search size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    clearRecommendation();
                  }}
                  placeholder="חיפוש מאמרים…"
                  className="w-full bg-card border border-border pr-12 pl-12 py-3.5 text-base focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    aria-label="ניקוי חיפוש"
                    className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-accent transition-colors"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              {allTags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      setActiveTag(null);
                      clearRecommendation();
                    }}
                    className={`text-xs tracking-[0.15em] uppercase px-3.5 py-1.5 border transition-colors ${
                      !activeTag
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-accent hover:text-accent"
                    }`}
                  >
                    הכל
                  </button>
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => {
                        setActiveTag((cur) => (cur === tag ? null : tag));
                        clearRecommendation();
                      }}
                      className={`text-xs tracking-[0.15em] uppercase px-3.5 py-1.5 border transition-colors ${
                        activeTag === tag
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:border-accent hover:text-accent"
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}

              {showingRecommended && (
                <div
                  id={RECOMMENDED_BANNER_ID}
                  className="flex flex-wrap items-center justify-between gap-3 border border-highlight bg-highlight-muted/15 px-5 py-3 scroll-mt-28"
                >
                  <p className="text-sm text-foreground">
                    {recommended.length === 1
                      ? "מוצג מאמר אחד שהומלץ בצ'אט"
                      : `מוצגים ${recommended.length} מאמרים שהומלצו בצ'אט`}
                  </p>
                  <button
                    onClick={clearRecommendation}
                    className="text-sm text-accent underline underline-offset-4 hover:text-highlight transition-colors"
                  >
                    הצגת כל המאמרים
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="mt-8 border-t border-border/60">
            {loading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="animate-spin text-accent" />
              </div>
            ) : !posts || posts.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border">
                <Newspaper size={28} className="mx-auto text-highlight mb-4" strokeWidth={1.25} />
                <p className="text-muted-foreground">
                  עדיין אין מאמרים — בקרוב יעלו כאן עדכונים חדשים.
                </p>
              </div>
            ) : visiblePosts.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border">
                <Search size={28} className="mx-auto text-highlight mb-4" strokeWidth={1.25} />
                <p className="text-muted-foreground">
                  לא נמצאו מאמרים התואמים את החיפוש. ניתן לנסות מילים אחרות או נושא אחר.
                </p>
                <button
                  onClick={() => { setQuery(""); setActiveTag(null); }}
                  className="mt-4 text-sm text-accent underline underline-offset-4 hover:text-highlight transition-colors"
                >
                  ניקוי החיפוש
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 py-12">
                {visiblePosts.map((p) => (
                  <Link
                    key={p.id}
                    id={`post-${p.id}`}
                    to={`/blog/${p.id}`}
                    className="group flex flex-col border overflow-hidden transition-colors bg-card border-border/60 hover:border-accent"
                  >
                    <div className="h-48 overflow-hidden bg-secondary">
                      {p.image_url ? (
                        <Image
                          src={p.image_url}
                          alt={p.title}
                          className="w-full h-full object-cover"
                          fittingType="fill"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          <Newspaper size={28} strokeWidth={1.25} />
                        </div>
                      )}
                    </div>
                    <div className="p-6 flex flex-col flex-1">
                      <p className="text-sm text-muted-foreground">
                        {new Date(p.created_date).toLocaleDateString("he-IL", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      </p>
                      <h2 className="font-heading text-2xl mt-3 leading-snug group-hover:text-accent transition-colors">
                        {p.title}
                      </h2>
                      {p.excerpt && (
                        <p className="mt-3 text-foreground/70 leading-relaxed text-sm">
                          {p.excerpt}
                        </p>
                      )}
                      {p.tags && (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {p.tags
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
                      <span className="mt-5 inline-flex items-center gap-1 text-sm text-accent">
                        קריאת המאמר <ArrowLeft size={14} />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}