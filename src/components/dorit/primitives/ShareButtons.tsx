import React, { useState } from "react";
import {
  MessageCircle,
  Facebook,
  Twitter,
  Linkedin,
  Mail,
  Link as LinkIcon,
  Check,
} from "lucide-react";

interface ShareButtonsProps {
  title?: string;
  url?: string;
}

interface ShareLink {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  href: string;
}

export default function ShareButtons({ title, url }: ShareButtonsProps) {
  const [copied, setCopied] = useState<boolean>(false);

  const shareUrl = url || (typeof window !== "undefined" ? window.location.href : "");
  const shareTitle = title || "";
  const enc = (s: string): string => encodeURIComponent(s || "");

  const links: ShareLink[] = [
    {
      label: "WhatsApp",
      icon: MessageCircle,
      href: `https://wa.me/?text=${enc(`${shareTitle} ${shareUrl}`)}`,
    },
    {
      label: "Facebook",
      icon: Facebook,
      href: `https://www.facebook.com/sharer/sharer.php?u=${enc(shareUrl)}`,
    },
    {
      label: "X",
      icon: Twitter,
      href: `https://twitter.com/intent/tweet?url=${enc(shareUrl)}&text=${enc(shareTitle)}`,
    },
    {
      label: "LinkedIn",
      icon: Linkedin,
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(shareUrl)}`,
    },
    {
      label: "מייל",
      icon: Mail,
      href: `mailto:?subject=${enc(shareTitle)}&body=${enc(shareUrl)}`,
    },
  ];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      /* clipboard לא זמין — מתעלם */
    }
  };

  return (
    <div className="mt-12 pt-8 border-t border-border/60">
      <p className="text-[11px] tracking-[0.25em] uppercase text-muted-foreground mb-4">
        שיתוף המאמר
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {links.map((s) => (
          <a
            key={s.label}
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`שיתוף ב-${s.label}`}
            className="inline-flex items-center gap-2 px-4 py-2.5 border border-border text-sm text-foreground/80 hover:border-accent hover:text-accent transition-colors"
          >
            <s.icon size={16} />
            <span className="hidden sm:inline">{s.label}</span>
          </a>
        ))}
        <button
          type="button"
          onClick={copy}
          aria-label="העתקת קישור"
          className="inline-flex items-center gap-2 px-4 py-2.5 border border-border text-sm text-foreground/80 hover:border-accent hover:text-accent transition-colors"
        >
          {copied ? <Check size={16} className="text-accent" /> : <LinkIcon size={16} />}
          <span className="hidden sm:inline">{copied ? "הקישור הועתק" : "העתקת קישור"}</span>
        </button>
      </div>
    </div>
  );
}