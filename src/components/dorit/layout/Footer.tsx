import React from "react";
import { Image } from "@/components/ui/image";
import { Phone, Mail, MapPin, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { CONTACT } from "@/config/contact";
import { useSectionNav } from "@/hooks/useSectionNav";

const HANDSHAKE =
  "https://media.base44.com/images/public/6a9e6144d2bee5cdfb4ddf74/8f139c5ff_generated_14b746d4.jpg";

interface FooterLink {
  l: string;
  h: string;
  route?: boolean;
}

const FOOT_LINK = "hover:text-highlight-on-dark transition-colors duration-200";

export default function Footer() {
  // The footer sits on all seven pages, so its `#section` links point at
  // something that exists on only one of them. See the hook.
  const goToSection = useSectionNav();

  return (
    <footer className="relative bg-primary text-primary-foreground">
      {/* The colophon: the handshake in a dark plate beside the quote. */}
      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-[clamp(72px,9vw,112px)] grid grid-cols-1 md:grid-cols-2 gap-12 items-center border-b border-primary-foreground/[0.14]">
        <div className="plate plate-dark h-[280px]">
          <Image
            src={HANDSHAKE}
            alt="לחיצת יד באור טבעי"
            className="w-full h-full object-cover"
            fittingType="fill"
          />
        </div>
        <div className="flex flex-col gap-[18px]">
          <p className="font-heading font-light text-[clamp(32px,3.6vw,46px)] leading-[1.25]">
            "ביטחון אמיתי מתחיל{" "}
            <br />
            בשיחה אחת כנה."
          </p>
          <p className="text-[15px] text-muted-foreground-on-dark">— דורית גוב ארי</p>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-14 grid grid-cols-1 md:grid-cols-3 gap-10">
        <div>
          <p className="font-heading font-medium text-[26px] mb-2.5">דורית גוב ארי</p>
          <p className="text-sm text-muted-foreground-on-dark">
            התכנון שלי — השקט שלך
          </p>
          <p className="mt-3.5 text-base text-[hsl(0_3%_84%)] leading-[1.7] max-w-[300px]">
            שיווק פנסיוני ותכנון פיננסי. ליווי לקוחות לאורך כל החיים.
          </p>
        </div>

        <div>
          <p className="text-sm text-highlight-on-dark mb-4">
            ניווט
          </p>
          <ul className="grid grid-cols-2 gap-x-5 gap-y-2.5 text-base text-[hsl(0_3%_84%)]">
            {([
              { l: "אודות", h: "#about" },
              { l: "שירותים", h: "#services" },
              { l: "מדריך תביעות", h: "/claims", route: true },
              { l: "שאלות ותשובות", h: "/faq", route: true },
              { l: "תיקי הצלחה", h: "#proof" },
              { l: "בלוג", h: "/blog", route: true },
              { l: "כלים", h: "/tools", route: true },
              { l: "נקודת מבט", h: "/perspective", route: true },
              { l: "לשיחה קצרה עם דורית", h: "#start" },
            ] as FooterLink[]).map((n) => (
              <li key={n.h}>
                {n.route ? (
                  <Link to={n.h} className={FOOT_LINK}>{n.l}</Link>
                ) : (
                  <a
                    href={`/${n.h}`}
                    onClick={(e) => goToSection(e, n.h)}
                    className={FOOT_LINK}
                  >
                    {n.l}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-sm text-highlight-on-dark mb-4">
            צרו קשר
          </p>
          <ul className="flex flex-col gap-3 text-base text-[hsl(0_3%_84%)]">
            <li className="flex items-center gap-3">
              <Phone size={16} strokeWidth={1.5} className="text-highlight-on-dark" />
              <a href={`tel:${CONTACT.phoneE164}`} className={FOOT_LINK}>
                <span dir="ltr" className="[unicode-bidi:isolate]">{CONTACT.phoneDisplay}</span>
              </a>
            </li>
            <li className="flex items-center gap-3">
              <MessageCircle size={16} strokeWidth={1.5} className="text-highlight-on-dark" />
              <a href={`https://wa.me/${CONTACT.whatsapp}`} target="_blank" rel="noopener noreferrer" dir="ltr" className={FOOT_LINK}>WhatsApp</a>
            </li>
            <li className="flex items-center gap-3">
              <Mail size={16} strokeWidth={1.5} className="text-highlight-on-dark" />
              <a href={`mailto:${CONTACT.email}`} dir="ltr" className={FOOT_LINK}>{CONTACT.email}</a>
            </li>
            <li className="flex items-center gap-3">
              <MapPin size={16} strokeWidth={1.5} className="text-highlight-on-dark" />
              <span>תל אביב · פגישות גם בזום</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-primary-foreground/[0.14]">
        <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] py-5 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-muted-foreground-on-dark">
          <p>
            דורית גוב ארי — מתכננת פיננסית וסוכנת ביטוח · רישיון סוכן מרשות שוק ההון מספר L-00107009
          </p>
          <div className="flex items-center gap-5">
            <Link to="/faq" className={FOOT_LINK}>שאלות ותשובות</Link>
            <Link to="/privacy" className={FOOT_LINK}>מדיניות פרטיות</Link>
            <Link to="/accessibility" className={FOOT_LINK}>הצהרת נגישות</Link>
          </div>
        </div>
        <div className="max-w-[1400px] mx-auto px-[clamp(20px,4vw,40px)] pb-6 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-muted-foreground-on-dark">
          <p>© {new Date().getFullYear()} דורית גוב ארי. כל הזכויות שמורות.</p>
        </div>
      </div>
    </footer>
  );
}
