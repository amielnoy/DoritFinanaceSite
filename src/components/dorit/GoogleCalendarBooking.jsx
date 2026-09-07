import React from "react";
import { CalendarClock } from "lucide-react";

export default function GoogleCalendarBooking({ data = {} }) {
  const buildUrl = () => {
    const topic = data.topic ? ` — ${data.topic}` : "";
    const name = data.name ? ` · ${data.name}` : "";
    const text = `ייעוץ עם דורית גוב ארי${topic}${name}`;

    const lines = [
      data.name ? `שם: ${data.name}` : "",
      data.phone ? `טלפון: ${data.phone}` : "",
      data.email ? `אימייל: ${data.email}` : "",
      data.topic ? `תחום ייעוץ: ${data.topic}` : "",
      data.timing ? `עיתוי מבוקש: ${data.timing}` : "",
      data.notes ? `הערות: ${data.notes}` : "",
    ].filter(Boolean);
    const details =
      lines.length > 0
        ? lines.join("\n")
        : "ייעוץ ביטוחי ופיננסי אישי עם דורית גוב ארי.";

    // תאריך יומני להיום (יום שלם) — השעה נשארת פתוחה לבחירת המשתמש
    const start = new Date();
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const fmt = (d) =>
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
        d.getDate()
      ).padStart(2, "0")}`;
    const dates = `${fmt(start)}/${fmt(end)}`;

    const params = new URLSearchParams({
      action: "TEMPLATE",
      text,
      dates,
      details,
      location: "פגישת ייעוץ · טלפון או זום",
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  };

  return (
    <a
      href={buildUrl()}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-3 px-7 py-4 bg-[#C4A484] text-primary font-heading text-lg hover:bg-[#b8916f] transition-colors"
    >
      <CalendarClock size={20} />
      קביעת שיחה ביומן
    </a>
  );
}