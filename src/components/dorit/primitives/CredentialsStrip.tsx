import React from "react";
import { Phone, Mail, MessageCircle, BadgeCheck } from "lucide-react";
import { CONTACT } from "@/config/contact";

const LICENSE = "L-00107009";

export default function CredentialsStrip() {
  return (
    <div className="border-y border-border/60 bg-secondary/40">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 py-5 px-6 md:px-10">
        <div className="flex items-center gap-3">
          <BadgeCheck size={20} className="text-highlight shrink-0" />
          <span className="text-sm text-foreground/80">
            רישיון סוכן מרשות שוק ההון מספר{" "}
            <span className="font-medium text-foreground tracking-wide" dir="ltr">
              {LICENSE}
            </span>
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
          <a
            href={`tel:${CONTACT.phoneE164}`}
            className="flex items-center gap-2 text-foreground/80 hover:text-accent transition-colors"
          >
            <Phone size={16} className="text-highlight" />
            <span dir="ltr">{CONTACT.phoneDisplay}</span>
          </a>
          <a
            href={`https://wa.me/${CONTACT.whatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-foreground/80 hover:text-accent transition-colors"
          >
            <MessageCircle size={16} className="text-[#25D366]" />
            WhatsApp
          </a>
          <a
            href={`mailto:${CONTACT.email}`}
            className="flex items-center gap-2 text-foreground/80 hover:text-accent transition-colors"
          >
            <Mail size={16} className="text-highlight" />
            <span dir="ltr">{CONTACT.email}</span>
          </a>
        </div>
      </div>
    </div>
  );
}