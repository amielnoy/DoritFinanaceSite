import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Star, ExternalLink, Loader2, Quote } from "lucide-react";

// TODO: השתמש/י בקישורים האמיתיים של הפרופיל העסקי ב-Google וב-Midrag.
const GOOGLE_URL = "https://www.google.com/search?q=דורית+גוב+ארי+ביטוח+חוות+דעת";
const MIDRAG_URL = "https://www.midrag.co.il/";

const SOURCE_LABEL = { google: "Google", midrag: "Midrag" };

function Stars({ n }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${n} מתוך 5 כוכבים`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={15}
          className={
            i <= Math.round(n)
              ? "fill-[#C4A484] text-[#C4A484]"
              : "text-border"
          }
          strokeWidth={1.5}
        />
      ))}
    </div>
  );
}

export default function ReviewsWidget() {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await base44.entities.Testimonial.list("-created_date", 50);
        setItems(data || []);
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const rated = (items || []).filter((t) => t.rating);
  const avg = rated.length
    ? rated.reduce((s, t) => s + Number(t.rating), 0) / rated.length
    : null;
  const top = rated.slice(0, 3);

  return (
    <section className="relative py-20 md:py-24 border-b border-border/60">
      <div className="max-w-[1400px] mx-auto px-6 md:px-10">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-12">
          <div>
            <span className="text-[11px] tracking-[0.35em] uppercase text-accent">
              Verified Reputation
            </span>
            <h2 className="font-heading text-4xl md:text-5xl mt-4 leading-tight">
              לקוחות ממליצים,
              <br />
              בצד שלישי
            </h2>
          </div>
          <div className="flex flex-col md:flex-row md:items-center gap-6">
            {avg && (
              <div className="text-center md:text-right">
                <div className="flex items-center gap-2 justify-center md:justify-start">
                  <span className="font-heading text-3xl text-accent leading-none">
                    {avg.toFixed(1)}
                  </span>
                  <Stars n={avg} />
                </div>
                <p className="mt-1 text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
                  על סמך {rated.length} חוות דעת
                </p>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <a
                href={GOOGLE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-border hover:border-accent hover:text-accent transition-colors text-sm"
              >
                חוות דעת ב-Google <ExternalLink size={13} />
              </a>
              <a
                href={MIDRAG_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-border hover:border-accent hover:text-accent transition-colors text-sm"
              >
                חוות דעת ב-Midrag <ExternalLink size={13} />
              </a>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-accent" />
          </div>
        ) : top.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border">
            <Quote size={26} className="mx-auto text-[#C4A484] mb-3" strokeWidth={1.25} />
            <p className="text-foreground/60">
              חוות הדעת המקוריות מופיעות ב-Google וב-Midrag. ניתן לקרוא אותן דרך הקישורים.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {top.map((t) => (
              <article
                key={t.id}
                className="bg-card border border-border/60 p-7 flex flex-col"
              >
                <div className="flex items-center justify-between mb-4">
                  <Stars n={t.rating} />
                  <span className="text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                    {SOURCE_LABEL[t.source] || "לקוח/ה"}
                  </span>
                </div>
                <Quote size={18} className="text-[#C4A484] mb-3" strokeWidth={1.25} />
                <p className="text-foreground/80 leading-relaxed flex-1">{t.quote}</p>
                <p className="mt-5 font-heading text-base">{t.name}</p>
                {t.role && (
                  <p className="text-xs tracking-[0.1em] uppercase text-muted-foreground mt-1">
                    {t.role}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}