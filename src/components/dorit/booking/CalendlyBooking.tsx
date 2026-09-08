import React, { useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";

// החלף/י בכתובת השיבוץ שלך ב-Calendly (לדוגמה: https://calendly.com/dorit-gov-ari/30min)
const CALENDLY_URL = "https://calendly.com/your-username/30min";

interface CalendlyWindow {
  initPopupWidget: (opts: { url: string }) => void;
}

declare global {
  interface Window {
    Calendly?: CalendlyWindow;
  }
}

export default function CalendlyBooking() {
  const [ready, setReady] = useState<boolean>(false);

  useEffect(() => {
    if (window.Calendly) {
      setReady(true);
      return;
    }
    const src = "https://assets.calendly.com/assets/external/widget.js";
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
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
      className="inline-flex items-center gap-3 px-7 py-4 bg-highlight text-primary font-heading text-lg hover:bg-highlight-strong transition-colors"
    >
      {ready ? <CalendarClock size={20} /> : <Loader2 size={20} className="animate-spin" />}
      קביעת שיחה ביומן
    </button>
  );
}