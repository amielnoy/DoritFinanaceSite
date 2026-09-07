import React from "react";
import { Image } from "@/components/ui/image";
import { Phone, Mail, MapPin } from "lucide-react";

const HANDSHAKE =
  "https://media.base44.com/images/public/6a9e6144d2bee5cdfb4ddf74/8f139c5ff_generated_14b746d4.jpg";

export default function Footer() {
  return (
    <footer className="relative bg-primary text-primary-foreground">
      <div className="grid grid-cols-1 md:grid-cols-2 h-64 md:h-80">
        <div className="lens-hover overflow-hidden h-full">
          <Image
            src={HANDSHAKE}
            alt="לחיצת יד באור טבעי"
            className="w-full h-full object-cover"
            fittingType="fill"
          />
        </div>
        <div className="flex flex-col justify-center px-8 md:px-16 bg-primary">
          <p className="font-heading text-3xl md:text-4xl leading-tight">
            "ביטחון אמיתי מתחיל
            <br />
            בשיחה אחת כנה."
          </p>
          <p className="mt-4 text-primary-foreground/60 text-sm">— דורית גוב ארי</p>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-14 grid grid-cols-1 md:grid-cols-3 gap-10 border-t border-primary-foreground/15">
        <div>
          <p className="font-heading text-2xl mb-2">דורית גוב ארי</p>
          <p className="text-[11px] tracking-[0.3em] uppercase text-primary-foreground/50">
            Architecture of Security
          </p>
          <p className="mt-6 text-primary-foreground/70 leading-relaxed max-w-xs">
            ייעוץ ביטוחי ופיננסי אישי. ליווי לקוחות לאורך כל החיים.
          </p>
        </div>

        <div>
          <p className="text-[11px] tracking-[0.25em] uppercase text-primary-foreground/50 mb-5">
            ניווט
          </p>
          <ul className="space-y-3 text-primary-foreground/80">
            {[
              { l: "אודות", h: "#about" },
              { l: "שירותים", h: "#services" },
              { l: "תיקי הצלחה", h: "#proof" },
              { l: "קביעת ייעוץ", h: "#consultation" },
            ].map((n) => (
              <li key={n.h}>
                <a href={n.h} className="hover:text-[#C4A484] transition-colors">
                  {n.l}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-[11px] tracking-[0.25em] uppercase text-primary-foreground/50 mb-5">
            צרו קשר
          </p>
          <ul className="space-y-4 text-primary-foreground/80">
            <li className="flex items-center gap-3">
              <Phone size={16} className="text-[#C4A484]" />
              <span dir="ltr">050-000-0000</span>
            </li>
            <li className="flex items-center gap-3">
              <Mail size={16} className="text-[#C4A484]" />
              <span dir="ltr">dorit@gov-ari.co.il</span>
            </li>
            <li className="flex items-center gap-3">
              <MapPin size={16} className="text-[#C4A484]" />
              <span>תל אביב · פגישות גם בזום</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-primary-foreground/15">
        <div className="max-w-[1400px] mx-auto px-6 md:px-10 py-6 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-primary-foreground/40">
          <p>© {new Date().getFullYear()} דורית גוב ארי. כל הזכויות שמורות.</p>
          <p className="tracking-[0.2em] uppercase">Designed with Structural Serenity</p>
        </div>
      </div>
    </footer>
  );
}