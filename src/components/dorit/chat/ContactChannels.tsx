import React from "react";
import { Mail, MessageCircle, Phone } from "lucide-react";
import type { HumanContact } from "@/services";
import { HUMAN_HANDOFF } from "@/config/compliance";

/**
 * The three ways to reach Dorit, when the automation has stopped being useful.
 *
 * This was three markdown links joined by newlines. Markdown collapses a single
 * newline into a soft break, so on a phone they rendered as one cramped line —
 * the number, the word וואטסאפ and the address run together — directly beneath a
 * sentence that had already named the number and the address. The visitor read
 * both twice, at the one moment they had just been told they could not be
 * helped. Two of the three were also untappable at that size.
 *
 * Markdown could not fix it: no control over weight, family or target size, and
 * `tel:` had to be allow-listed past the renderer's sanitiser just to survive
 * (A-60). So this is a component.
 *
 * The value leads, in the serif, because the number is the thing you came for
 * and the thing you will read aloud. The label is quiet, in the body face,
 * answering "what happens if I press this" rather than repeating the value.
 */
export default function ContactChannels({
  contact,
  className = "",
}: {
  contact: HumanContact;
  className?: string;
}) {
  const { phone, email, whatsapp } = HUMAN_HANDOFF.channels;

  const rows = [
    {
      key: "phone",
      href: `tel:${contact.phoneE164}`,
      value: contact.phoneDisplay,
      label: phone.label,
      Icon: Phone,
      // Latin digits in an RTL line reorder without this.
      dir: "ltr" as const,
    },
    {
      key: "email",
      href: `mailto:${contact.email}`,
      value: contact.email,
      label: email.label,
      Icon: Mail,
      dir: "ltr" as const,
    },
    {
      key: "whatsapp",
      href: `https://wa.me/${contact.whatsapp}`,
      value: whatsapp.title,
      label: whatsapp.label,
      Icon: MessageCircle,
      dir: "rtl" as const,
    },
  ];

  return (
    <div className={`border border-border/60 bg-background ${className}`}>
      {rows.map(({ key, href, value, label, Icon, dir }, i) => (
        <a
          key={key}
          href={href}
          // `noopener` on the only one that leaves the site.
          {...(key === "whatsapp" ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className={`flex items-center gap-4 px-5 py-3.5 min-h-[56px] transition-colors hover:bg-secondary/50 focus-visible:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
            i < rows.length - 1 ? "border-b border-border/60" : ""
          }`}
        >
          <Icon size={18} className="text-accent shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span
              dir={dir}
              // Wrapping, not truncating. At 19px the address does not fit a
              // phone, and `truncate` cut it to `dorit@govari-fin.c…` — the one
              // thing on the row the visitor needs in full. Two lines is a
              // smaller cost than an address nobody can read or copy.
              className="block font-heading text-[19px] font-bold leading-tight text-foreground break-words text-start"
            >
              {value}
            </span>
            <span className="block font-body text-[13px] text-muted-foreground mt-0.5">
              {label}
            </span>
          </span>
        </a>
      ))}
    </div>
  );
}
