import React, { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";

// החלף/י בכתובת השיבוץ שלך ב-Calendly (לדוגמה: https://calendly.com/dorit-gov-ari/30min)
const CALENDLY_URL = "https://calendly.com/your-username/30min";

export default function CalendlyBooking() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (window.Calendly) {
      setReady(true);
      return;
    }
    const src = "https://assets.calendly.com/assets/external/widget.js";
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => setReady(true));
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => setReady(true);
    document.body.appendChild(s);
  }, []);

  const open = () => {
    if (window.Calendly) {
      window.Calendly.initPopupWidget({ url: CALENDLY_URL });
    } else {
      window.open(CALENDLY_URL, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <button
      onClick={open}
      className="inline-flex items-center gap-3 px-7 py-4 bg-[#C4A484] text-primary font-heading text-lg hover:bg-[#b8916f] transition-colors"
    >
      {ready ? <CalendarClock size={20} /> : <Loader2 size={20} className="animate-spin" />}
      קביעת שיחה ביומן
    </button>
  );
}