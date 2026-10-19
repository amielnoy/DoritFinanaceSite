import React from "react";
import Photo from "@/components/dorit/primitives/Photo";
import { ChevronDown, Phone, Mail, MapPin, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { CONTACT } from "@/config/contact";
import { WHATSAPP_CHANNEL_URL } from "@/config/offers";
import { useSectionNav } from "@/hooks/useSectionNav";
import { MD_UP, useMediaQuery } from "@/hooks/useMediaQuery";
import { useLocale, useLocalePath, useT } from "@/i18n/LocaleContext";
import type { KeyOf } from "@/i18n/resources";

// Half the 1400px band from md up; the band is hidden below md.
const HANDSHAKE = "/images/footer-handshake";
const HANDSHAKE_SIZES = "(min-width: 1400px) 660px, 50vw";

interface FooterLink {
  l: KeyOf<"common">;
  h: string;
  route?: boolean;
  /** Hebrew only — left out of the English and French footers. */
  hebrewOnly?: boolean;
}

const FOOT_LINK = "hover:text-highlight-on-dark transition-colors duration-200";

const NAV_LINKS: FooterLink[] = [
  { l: "nav.about", h: "#about" },
  { l: "nav.services", h: "#services" },
  { l: "nav.claimsGuide", h: "/claims", route: true },
  { l: "nav.faq", h: "/faq", route: true },
  { l: "nav.blog", h: "/blog", route: true, hebrewOnly: true },
  { l: "nav.tools", h: "/tools", route: true },
  { l: "nav.perspective", h: "/perspective", route: true, hebrewOnly: true },
  { l: "nav.shortCall", h: "#start" },
];

/** A contact row below md: two to a line, each a full 44px tap target. */
const CONTACT_ROW = "flex items-center gap-3 max-md:min-h-11";
const CONTACT_LINK = `${FOOT_LINK} max-md:inline-flex max-md:items-center max-md:min-h-11`;

export default function Footer() {
  // The footer sits on all seven pages, so its `#section` links point at
  // something that exists on only one of them. See the hook.
  const goToSection = useSectionNav();
  // Below md the menu folds into "ניווט באתר"; from md up it is the open
  // column it always was. The licence line below stays in view on both.
  const isDesktop = useMediaQuery(MD_UP, true);
  const t = useT("common");
  const lp = useLocalePath();
  const locale = useLocale();

  const navList = (
    <ul className="grid grid-cols-2 gap-x-5 gap-y-2.5 text-base text-[hsl(0_3%_84%)] max-md:gap-y-0">
      {NAV_LINKS.filter((n) => locale === "he" || !n.hebrewOnly).map((n) => (
        <li key={n.h}>
          {n.route ? (
            <Link to={lp(n.h)} className={`${FOOT_LINK} max-md:flex max-md:items-center max-md:min-h-11`}>{t(n.l)}</Link>
          ) : (
            <a
              href={lp(`/${n.h}`)}
              onClick={(e) => goToSection(e, n.h)}
              className={`${FOOT_LINK} max-md:flex max-md:items-center max-md:min-h-11`}
            >
              {t(n.l)}
            </a>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <footer className="relative bg-primary text-primary-foreground">
      {/* The colophon: the handshake in a dark plate beside the quote. Below
          md the whole band is hidden, not removed — the photo is decoration,
          and the quote alone was still 200px of a phone screen on every page. */}
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-[clamp(72px,9vw,112px)] grid grid-cols-1 md:grid-cols-2 gap-12 items-center border-b border-primary-foreground/[0.14] max-md:hidden">
        <div className="plate plate-dark h-[280px] max-md:hidden">
          <Photo base={HANDSHAKE} sizes={HANDSHAKE_SIZES} alt={t("footer.imageAlt")} className="w-full h-full object-cover" />
        </div>
        <div className="flex flex-col gap-[18px]">
          <p className="font-heading font-light text-[clamp(32px,3.6vw,46px)] leading-[1.25]">
            {t("footer.quoteLine1")}{" "}
            <br />
            {t("footer.quoteLine2")}
          </p>
          <p className="text-[15px] text-muted-foreground-on-dark">{t("footer.quoteBy")}</p>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-14 grid grid-cols-1 md:grid-cols-3 gap-10 max-md:py-8 max-md:gap-6">
        {/* Below md the name and the slogan are hidden: the header above says
            both, on every page. The line saying what she does stays, and the
            licence line at the bottom names her in full. */}
        <div>
          <p className="font-heading font-medium text-[26px] mb-2.5 max-md:hidden">{t("brand.name")}</p>
          <p className="text-sm text-muted-foreground-on-dark max-md:hidden">
            {t("brand.slogan")}
          </p>
          <p className="mt-3.5 text-base text-[hsl(0_3%_84%)] leading-[1.7] max-w-[300px] max-md:mt-0">
            {t("footer.tagline")}
          </p>
        </div>

        {isDesktop ? (
          <div>
            <p className="text-sm text-highlight-on-dark mb-4">
              {t("footer.nav")}
            </p>
            {navList}
          </div>
        ) : (
          <details className="group border-y border-primary-foreground/[0.14]">
            <summary className="flex items-center justify-between gap-3 min-h-12 cursor-pointer list-none text-[15px] text-highlight-on-dark [&::-webkit-details-marker]:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-highlight-on-dark">
              {t("footer.navMobile")}
              <ChevronDown size={18} strokeWidth={1.5} aria-hidden="true" className="shrink-0 motion-safe:transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <div className="pb-3">{navList}</div>
          </details>
        )}

        <div>
          <p className="text-sm text-highlight-on-dark mb-4 max-md:mb-2">
            {t("footer.contact")}
          </p>
          <ul className="flex flex-col gap-3 text-base text-[hsl(0_3%_84%)] max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-0">
            <li className={CONTACT_ROW}>
              <Phone size={16} strokeWidth={1.5} className="text-highlight-on-dark" />
              <a href={`tel:${CONTACT.phoneE164}`} className={CONTACT_LINK}>
                <span dir="ltr" className="[unicode-bidi:isolate]">{CONTACT.phoneDisplay}</span>
              </a>
            </li>
            <li className={CONTACT_ROW}>
              <MessageCircle size={16} strokeWidth={1.5} className="text-highlight-on-dark" />
              <a href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noopener noreferrer" dir="ltr" className={CONTACT_LINK}>WhatsApp</a>
            </li>
            {/* The email address and the place take the whole row: at 390px either
                one in a half-width cell would break mid-word. */}
            <li className={`${CONTACT_ROW} max-md:col-span-2`}>
              <Mail size={16} strokeWidth={1.5} className="text-highlight-on-dark" />
              <a href={`mailto:${CONTACT.email}`} dir="ltr" className={CONTACT_LINK}>{CONTACT.email}</a>
            </li>
            <li className={`${CONTACT_ROW} max-md:col-span-2`}>
              <MapPin size={16} strokeWidth={1.5} className="text-highlight-on-dark" />
              <span>{t("footer.place")}</span>
            </li>
          </ul>
          {/* Dorit's WhatsApp channel, on every page, once VITE_WHATSAPP_CHANNEL_URL
              is set (growth brief, 2026-10-14). The site only links to it. */}
          {WHATSAPP_CHANNEL_URL ? (
            <p data-track-location="footer_channel" className="mt-5 text-[15px] text-[hsl(0_3%_84%)] leading-relaxed max-md:mt-4">
              {t("footer.channelLead")}{" "}
              <a href={WHATSAPP_CHANNEL_URL} target="_blank" rel="noopener noreferrer" className={CONTACT_LINK}>
                {t("footer.channelLink")}
              </a>
            </p>
          ) : null}
        </div>
      </div>

      <div className="border-t border-primary-foreground/[0.14]">
        <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-5 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-muted-foreground-on-dark">
          <p>
            {t("footer.licence")}{" "}
            <bdi className="whitespace-nowrap lining-nums tabular-nums">L-00107009</bdi>
          </p>
          <div className="flex items-center gap-5">
            <Link to={lp("/faq")} className={FOOT_LINK}>{t("nav.faq")}</Link>
            <Link to="/privacy" className={FOOT_LINK}>{t("footer.privacy")}{locale === "he" ? "" : ` ${t("lang.hebrewOnly")}`}</Link>
            <Link to="/accessibility" className={FOOT_LINK}>{t("footer.accessibility")}{locale === "he" ? "" : ` ${t("lang.hebrewOnly")}`}</Link>
          </div>
        </div>
        <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] pb-6 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-muted-foreground-on-dark">
          <p>{t("footer.rights", { year: new Date().getFullYear() })}</p>
        </div>
      </div>
    </footer>
  );
}
