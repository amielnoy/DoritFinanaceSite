import React, { useState } from "react";
import { useArticles } from "@/hooks/useContent";
import { Loader2, Newspaper, Search, X } from "lucide-react";
import FloatingHeader from "@/components/dorit/layout/FloatingHeader";
import Footer from "@/components/dorit/layout/Footer";
import MobileStickyBar from "@/components/dorit/layout/MobileStickyBar";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import ArticleCard, { FOCUS_RING } from "@/components/dorit/blog/ArticleCard";
import FeaturedRow from "@/components/dorit/blog/FeaturedRow";
import BlogRecommender from "@/components/dorit/blog/BlogRecommender";
import BlogContactBand from "@/components/dorit/blog/BlogContactBand";
import { readRecommendation } from "@/lib/blog-recommendation";
import {
  FEATURED,
  FEATURED_TOPICS,
  TOPICS,
  type TopicId,
  actionMinutes,
  isFeaturedLive,
  topicCounts,
  topicOf,
} from "@/config/blog-topics";
import type { Article } from "@/services";
import { SITE_NAME, absoluteUrl, breadcrumbLd, useSeo } from "@/lib/seo";

const RECOMMENDED_BANNER_ID = "blog-recommended";
/** Cards before "show all": a phone gets the shorter list. */
const PAGE_DESKTOP = 9;
const PAGE_MOBILE = 6;

const TOPIC_LABEL = Object.fromEntries(TOPICS.map((t) => [t.id, t.label])) as Record<TopicId, string>;

const articlesLabel = (n: number) => (n === 1 ? "מאמר אחד" : `${n} מאמרים`);
const moreLabel = (n: number) => (n === 1 ? "מאמר נוסף" : `${n} נוספים`);

export default function Blog() {
  const { data, isPending: loading } = useArticles();
  const posts = (data ?? null) as Article[] | null;
  const [query, setQuery] = useState<string>("");
  const [topic, setTopic] = useState<TopicId>("all");
  const [expanded, setExpanded] = useState<boolean>(false);
  /** Post ids the reading-recommender chose, read from its `recommended`
   *  block — see src/lib/blog-recommendation.ts. While set, the grid shows
   *  only these posts. */
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);

  // `useArticles()` may not have resolved the instant a recommendation
  // arrives — keep looking for the banner until it mounts, same pattern as
  // ScrollToTop.jsx's hash handling. The banner rather than the first card, so
  // the way back to every post is on screen too.
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

  const counts = React.useMemo(() => topicCounts(posts ?? []), [posts]);

  const filtered = React.useMemo(() => {
    if (!posts) return [];
    const q = query.trim().toLowerCase();
    return posts.filter((p) => {
      const matchesQuery =
        !q ||
        p.title.toLowerCase().includes(q) ||
        (p.excerpt || "").toLowerCase().includes(q) ||
        (p.tags || "").toLowerCase().includes(q);
      const matchesTopic = topic === "all" || topicOf(p.tags) === topic;
      return matchesQuery && matchesTopic;
    });
  }, [posts, query, topic]);

  // In the order the agent ranked them. Ids with no matching post (one taken
  // down since, or a model slip) are dropped; if none match, nothing is
  // filtered — an empty page answers the visitor's question worse than all.
  const recommended = React.useMemo(() => {
    if (!posts || !recommendedIds.length) return [];
    const byId = new Map(posts.map((p) => [p.id, p]));
    return [...new Set(recommendedIds)]
      .map((id) => byId.get(id))
      .filter((p): p is Article => Boolean(p));
  }, [posts, recommendedIds]);

  const showingRecommended = recommended.length > 0;
  const visiblePosts = showingRecommended ? recommended : filtered;

  const featured = React.useMemo(
    () => (isFeaturedLive() ? posts?.find((p) => p.title === FEATURED.title) : undefined),
    [posts]
  );
  const fastest = React.useMemo(
    () =>
      (posts ?? [])
        .filter((p) => p !== featured && Number.isFinite(actionMinutes(p.action_time)))
        .sort((a, b) => actionMinutes(a.action_time) - actionMinutes(b.action_time))
        .slice(0, 3),
    [posts, featured]
  );
  const showFeatured =
    Boolean(featured) && !showingRecommended && !query.trim() && FEATURED_TOPICS.includes(topic);

  // One filter at a time: a recommendation intersected with an unrelated
  // search or topic would usually leave nothing on screen.
  const clearRecommendation = () => setRecommendedIds([]);
  const chooseTopic = (id: TopicId) => {
    setTopic(id);
    setExpanded(false);
    clearRecommendation();
  };

  const total = visiblePosts.length;
  const limited = !showingRecommended && !expanded;
  const shown = limited ? visiblePosts.slice(0, PAGE_DESKTOP) : visiblePosts;
  const hasMore = limited && total > PAGE_MOBILE;

  const gridTitle = showingRecommended
    ? "מאמרים שהומלצו בצ'אט"
    : topic === "all"
      ? "כל המאמרים"
      : TOPIC_LABEL[topic];

  return (
    // `pb-14`: room for the phone's sticky bar under the footer, as on Home.
    <div className="relative bg-background min-h-screen pb-14 md:pb-0">
      <FloatingHeader />

      <main>
        {/* No fade-in here: text that arrives late moves the cards under a
            reader's thumb. */}
        <section data-track-location="blog_hero" className="pt-28 md:pt-36 pb-8 md:pb-10">
          <div className="max-w-[1400px] mx-auto px-6 md:px-10 md:pl-20">
            <Eyebrow>בלוג · מידע שאפשר לפעול לפיו</Eyebrow>
            <h1 className="font-heading text-3xl md:text-5xl mt-4 leading-tight text-foreground max-w-4xl">
              מה אפשר לסדר השבוע — ברוב המקרים בפחות מחצי שעה
            </h1>
            <p className="mt-4 max-w-2xl text-base md:text-lg leading-relaxed text-foreground">
              מדריכים קצרים לפנסיה, לביטוח ולמס. בכל מאמר: כמה זמן לוקח לבצע, מה בודקים, ואיפה כדאי
              לעצור ולהתייעץ.
            </p>

            {!loading && posts && posts.length > 0 ? (
              <div className="mt-6 space-y-4">
                <div className="relative max-w-xl">
                  <label htmlFor="blog-search" className="sr-only">
                    חיפוש מאמרים
                  </label>
                  <Search
                    size={18}
                    aria-hidden="true"
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                  />
                  <input
                    id="blog-search"
                    type="text"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setExpanded(false);
                      clearRecommendation();
                    }}
                    placeholder="חיפוש מאמרים…"
                    className="w-full min-h-12 bg-card border border-border rounded-md pr-12 pl-12 py-3 text-base text-foreground focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/40 transition-colors"
                  />
                  {query ? (
                    <button
                      onClick={() => setQuery("")}
                      aria-label="ניקוי חיפוש"
                      className={`absolute left-1 top-1/2 -translate-y-1/2 w-11 h-11 inline-flex items-center justify-center text-muted-foreground hover:text-accent transition-colors ${FOCUS_RING}`}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>

                <div
                  role="group"
                  aria-label="סינון לפי נושא"
                  className="-mx-6 px-6 md:mx-0 md:px-0 flex gap-2 overflow-x-auto pb-1"
                >
                  {TOPICS.map((t) => {
                    const selected = topic === t.id && !showingRecommended;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => chooseTopic(t.id)}
                        className={`shrink-0 whitespace-nowrap min-h-11 px-4 rounded-md border text-[15px] transition-colors ${FOCUS_RING} ${
                          selected
                            ? "bg-foreground text-background border-foreground"
                            : "bg-card text-foreground border-border hover:border-accent"
                        }`}
                      >
                        {t.label}
                        <span className="ms-1.5 tabular-nums">{counts[t.id]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <div className="max-w-[1400px] mx-auto px-6 md:px-10 md:pl-20 pb-16 md:pb-24 space-y-12 md:space-y-16">
          {showFeatured && featured ? (
            <FeaturedRow
              featured={featured}
              badge={FEATURED.badge}
              topicLabel={topicLabelOf(featured)}
              fastest={fastest}
            />
          ) : null}

          <section aria-labelledby="blog-grid-title" data-track-location="blog_grid">
            {loading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="animate-spin text-accent" aria-label="טוען מאמרים" />
              </div>
            ) : !posts || posts.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border rounded-md">
                <Newspaper size={28} className="mx-auto text-highlight mb-4" strokeWidth={1.25} aria-hidden="true" />
                <p className="text-muted-foreground">עדיין אין מאמרים — בקרוב יעלו כאן עדכונים חדשים.</p>
              </div>
            ) : (
              <>
                <div
                  id={RECOMMENDED_BANNER_ID}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 scroll-mt-28"
                >
                  <h2 id="blog-grid-title" className="font-heading text-2xl md:text-3xl text-foreground">
                    {gridTitle}
                    <span className="ms-3 text-base font-body text-muted-foreground tabular-nums">
                      {articlesLabel(total)}
                    </span>
                  </h2>
                  {showingRecommended ? (
                    <button
                      onClick={clearRecommendation}
                      className={`min-h-11 text-sm text-accent underline underline-offset-4 hover:text-highlight transition-colors ${FOCUS_RING}`}
                    >
                      חזרה לכל המאמרים
                    </button>
                  ) : null}
                </div>

                {total === 0 ? (
                  <div className="mt-6 text-center py-20 border border-dashed border-border rounded-md">
                    <Search size={28} className="mx-auto text-highlight mb-4" strokeWidth={1.25} aria-hidden="true" />
                    <p className="text-muted-foreground">
                      לא נמצאו מאמרים התואמים את החיפוש. ניתן לנסות מילים אחרות או נושא אחר.
                    </p>
                    <button
                      onClick={() => {
                        setQuery("");
                        chooseTopic("all");
                      }}
                      className={`mt-4 min-h-11 text-sm text-accent underline underline-offset-4 hover:text-highlight transition-colors ${FOCUS_RING}`}
                    >
                      ניקוי החיפוש
                    </button>
                  </div>
                ) : (
                  <div className="mt-4 md:mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 md:gap-6 border-b border-border md:border-b-0">
                    {shown.map((p, i) => (
                      <ArticleCard
                        key={p.id}
                        post={p}
                        topicLabel={topicLabelOf(p)}
                        className={limited && i >= PAGE_MOBILE ? "max-md:hidden" : undefined}
                      />
                    ))}
                  </div>
                )}

                {hasMore ? (
                  <div className={`mt-8 flex justify-center ${total <= PAGE_DESKTOP ? "md:hidden" : ""}`}>
                    <button
                      onClick={() => setExpanded(true)}
                      className={`min-h-12 px-6 rounded-md border border-foreground text-foreground hover:bg-foreground/[0.06] transition-colors ${FOCUS_RING}`}
                    >
                      הצגת כל המאמרים{" "}
                      <span className="md:hidden">({moreLabel(total - PAGE_MOBILE)})</span>
                      <span className="hidden md:inline">({moreLabel(Math.max(0, total - PAGE_DESKTOP))})</span>
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>

          <BlogRecommender
            onAssistantMessage={(content) => {
              const { ids } = readRecommendation(content);
              if (!ids.length) return;
              setRecommendedIds(ids);
              setQuery("");
              setTopic("all");
            }}
          />
        </div>
      </main>

      <BlogContactBand />
      <MobileStickyBar />
      <Footer />
    </div>
  );
}

function topicLabelOf(post: Article): string | undefined {
  const t = topicOf(post.tags);
  return t ? TOPIC_LABEL[t] : undefined;
}
