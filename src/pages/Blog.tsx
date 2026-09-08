import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";
import { Loader2, ArrowLeft, Newspaper } from "lucide-react";
import FloatingHeader from "@/components/dorit/FloatingHeader";
import Footer from "@/components/dorit/Footer";
import Reveal from "@/components/dorit/Reveal";

interface BlogListItem {
  id: string;
  title: string;
  excerpt?: string;
  image_url?: string;
  tags?: string;
  created_date: string;
}

export default function Blog() {
  const [posts, setPosts] = useState<BlogListItem[] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await base44.entities.BlogPost.filter(
          { published: true },
          "-created_date",
          50
        );
        setPosts(data as unknown as BlogListItem[]);
      } catch {
        setPosts([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="relative bg-background min-h-screen">
      <FloatingHeader />
      <div className="pt-32 md:pt-36 pb-24">
        <div className="max-w-[1400px] mx-auto px-6 md:px-10">
          <Reveal>
            <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
              Insights &amp; Innovation
            </span>
            <h1 className="font-heading text-5xl md:text-6xl mt-5 leading-tight">
              בלוג · חידושים בעולם הביטוח
            </h1>
            <p className="mt-6 max-w-2xl text-foreground/70 leading-relaxed text-lg">
              עדכונים קצרים מהשטח — חידושים, מגמות ותובנות שמשפיעים על ההחלטות
              הפיננסיות שלכם.
            </p>
          </Reveal>

          <div className="mt-14 border-t border-border/60">
            {loading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="animate-spin text-accent" />
              </div>
            ) : !posts || posts.length === 0 ? (
              <div className="text-center py-20 border border-dashed border-border">
                <Newspaper size={28} className="mx-auto text-[#C4A484] mb-4" strokeWidth={1.25} />
                <p className="text-foreground/60">
                  עדיין אין מאמרים — בקרוב יעלו כאן עדכונים חדשים.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 py-12">
                {posts.map((p) => (
                  <Link
                    key={p.id}
                    to={`/blog/${p.id}`}
                    className="group flex flex-col bg-card border border-border/60 overflow-hidden hover:border-accent transition-colors"
                  >
                    <div className="h-48 overflow-hidden lens-hover bg-secondary">
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
                      <p className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
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
                                className="text-[10px] tracking-[0.15em] uppercase px-2 py-0.5 border border-border text-muted-foreground"
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