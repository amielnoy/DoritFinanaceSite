import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Image } from "@/components/ui/image";
import ReactMarkdown from "react-markdown";
import { Loader2, ArrowRight, Calendar } from "lucide-react";
import FloatingHeader from "@/components/dorit/FloatingHeader";
import Footer from "@/components/dorit/Footer";

export default function BlogPost() {
  const { id } = useParams();
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await base44.entities.BlogPost.get(id);
        setPost(data);
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

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
        </div>
      </div>
      <Footer />
    </article>
  );
}