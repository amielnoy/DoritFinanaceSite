import React from "react";
import { CONTACT } from "@/config/contact";
import { CalendarClock } from "lucide-react";

interface BookingData {
  topic?: string;
  name?: string;
  phone?: string;
  email?: string;
  timing?: string;
  notes?: string;
}

interface OutlookCalendarBookingProps {
  data?: BookingData;
}

const ORGANIZER_EMAIL = CONTACT.email;

export default function OutlookCalendarBooking({ data = {} }: OutlookCalendarBookingProps) {
  const openCalendar = () => {
    const topic = data.topic ? ` — ${data.topic}` : "";
    const name = data.name ? ` · ${data.name}` : "";
    const subject = `ייעוץ עם דורית גוב ארי${topic}${name}`;

    const lines = [
      data.name ? `שם: ${data.name}` : "",
      data.phone ? `טלפון: ${data.phone}` : "",
      data.email ? `אימייל: ${data.email}` : "",
      data.topic ? `תחום ייעוץ: ${data.topic}` : "",
      data.timing ? `עיתוי מבוקש: ${data.timing}` : "",
      data.notes ? `הערות: ${data.notes}` : "",
      `מתוכננת עבור: ${ORGANIZER_EMAIL}`,
    ].filter(Boolean);
    const body = lines.join("\n");

    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(10, 0, 0, 0);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

    const params = new URLSearchParams({
      path: "/calendar/action/compose",
      rru: "addevent",
      startdt: fmt(start),
      enddt: fmt(end),
      subject,
      body,
      location: "פגישת ייעוץ · טלפון או זום",
    });
    window.open(
      `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`,
      "_blank",
      "noopener"
    );
  };

  return (
    <button
      type="button"
      onClick={openCalendar}
      className="inline-flex items-center gap-3 px-7 py-4 border border-highlight text-highlight-ink font-heading text-lg hover:bg-highlight hover:text-primary transition-colors"
    >
      <CalendarClock size={20} />
      קביעת שיחה ב-Outlook
    </button>
  );
}