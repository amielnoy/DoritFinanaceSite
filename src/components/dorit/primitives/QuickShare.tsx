import React, { useState } from "react";
import { MessageCircle, Linkedin, Link2, Check } from "lucide-react";
import { SITE_URL } from "@/lib/seo";

const SHARE_TEXT =
  "ממליצים בחום על דורית גוב ארי — ייעוץ פיננסי וביטוחי אישי, מקצועי ואנושי. מומלץ ביותר.";
/* The canonical origin, not a second copy of it. A share link that outlived a host
   change would send every recommendation to the old site. */
const SHARE_URL = SITE_URL;

export default function QuickShare() {
  const [copied, setCopied] = useState<boolean>(false);

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`${SHARE_TEXT} ${SHARE_URL}`)}`;
  const linkedinHref = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SHARE_URL)}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      /* clipboard לא זמין — מתעלם */
    }
  };

  return (
    <section className="relative py-20 md:py-24 border-t border-border/60 bg-secondary/30">
      <div className="max-w-2xl mx-auto px-6 text-center">
        <span className="text-[11px] tracking-[0.12em] text-accent">
          שיתוף
        </span>
        <h2 className="font-heading text-3xl md:text-4xl mt-4 leading-tight">
          מכירים מישהו שזקוק לייעוץ?
        </h2>
        <p className="mt-5 text-foreground/70 leading-relaxed">
          שיתוף אחד קטן יכול לעשות סדר בחיים של מישהו. שלחו את ההמלצה בקלות —
          בוואטסאפ או בלינקדאין.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2.5 px-7 py-3.5 bg-primary text-primary-foreground font-medium hover:bg-accent transition-colors w-full sm:w-auto justify-center"
          >
            <MessageCircle size={18} />
            שיתוף בוואטסאפ
          </a>
          <a
            href={linkedinHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2.5 px-7 py-3.5 bg-card border border-border text-foreground font-medium hover:border-accent hover:text-accent transition-colors w-full sm:w-auto justify-center"
          >
            <Linkedin size={18} />
            שיתוף בלינקדאין
          </a>
          <button
            onClick={copyLink}
            className="inline-flex items-center gap-2.5 px-7 py-3.5 text-foreground/70 font-medium hover:text-accent transition-colors w-full sm:w-auto justify-center"
          >
            {copied ? <Check size={18} className="text-accent" /> : <Link2 size={18} />}
            {copied ? "הקישור הועתק" : "העתקת קישור"}
          </button>
        </div>
      </div>
    </section>
  );
}