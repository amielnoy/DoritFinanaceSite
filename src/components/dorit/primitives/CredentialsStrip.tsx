import React from "react";
import { Phone, Mail, MessageCircle, BadgeCheck } from "lucide-react";
import { useAgencyContent } from "@/hooks/useAgencyContent";
import { useT } from "@/i18n/LocaleContext";

export default function CredentialsStrip() {
  const { contact, agent } = useAgencyContent();
  const t = useT("common");
  return (
    <div className="card-raised">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 py-5 px-6 md:px-10">
        <div className="flex items-center gap-3">
          <BadgeCheck size={20} className="text-highlight shrink-0" />
          <span className="text-sm text-foreground/80">
            {t("credentials.licence")}{" "}
            <bdi className="whitespace-nowrap font-medium text-foreground tracking-wide lining-nums tabular-nums" dir="ltr">
              {agent.licenceNumber}
            </bdi>
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
          <a
            href={`tel:${contact.phoneE164}`}
            className="flex items-center gap-2 text-foreground/80 hover:text-accent transition-colors"
          >
            <Phone size={16} className="text-highlight" />
            <span dir="ltr">{contact.phoneDisplay}</span>
          </a>
          <a
            href={`https://wa.me/${contact.whatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-foreground/80 hover:text-accent transition-colors"
          >
            <MessageCircle size={16} className="text-whatsapp" />
            WhatsApp
          </a>
          <a
            href={`mailto:${contact.email}`}
            className="flex items-center gap-2 text-foreground/80 hover:text-accent transition-colors"
          >
            <Mail size={16} className="text-highlight" />
            <span dir="ltr">{contact.email}</span>
          </a>
        </div>
      </div>
    </div>
  );
}