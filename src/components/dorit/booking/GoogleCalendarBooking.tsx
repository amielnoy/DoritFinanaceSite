import React from "react";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { CalendarClock } from "lucide-react";

interface BookingData {
  topic?: string;
  name?: string;
  phone?: string;
  email?: string;
  timing?: string;
  notes?: string;
}

interface GoogleCalendarBookingProps {
  data?: BookingData;
}

export default function GoogleCalendarBooking({ data = {} }: GoogleCalendarBookingProps) {
  const openCalendar = () => {
    const topic = data.topic ? ` — ${data.topic}` : "";
    const name = data.name ? ` · ${data.name}` : "";
    const text = `פגישה עם דורית גוב ארי${topic}${name}`;

    const lines = [
      data.name ? `שם: ${data.name}` : "",
      data.phone ? `טלפון: ${data.phone}` : "",
      data.email ? `אימייל: ${data.email}` : "",
      data.topic ? `נושא הפגישה: ${data.topic}` : "",
      data.timing ? `עיתוי מבוקש: ${data.timing}` : "",
      data.notes ? `הערות: ${data.notes}` : "",
    ].filter(Boolean);
    const details =
      lines.length > 0
        ? lines.join("\n")
        : "פגישה לתכנון פיננסי וביטוחי עם דורית גוב ארי.";

    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const params = new URLSearchParams({
      action: "TEMPLATE",
      text,
      dates: `${fmt(start)}/${fmt(end)}`,
      details,
      location: "פגישה · טלפון או זום",
    });
    window.open(
      `https://calendar.google.com/calendar/render?${params.toString()}`,
      "_blank",
      "noopener"
    );
  };

  return (
    <button
      type="button"
      onClick={openCalendar}
      className={ctaClass("gap-3")}
    >
      <CalendarClock size={20} />
      קביעת שיחה ביומן
    </button>
  );
}