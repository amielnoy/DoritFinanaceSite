import React, { useEffect, useState } from "react";
import { BarChart3, Check, ExternalLink, X } from "lucide-react";
import {
  GA4_MEASUREMENT_ID,
  LEAD_EVENTS,
  isInternalBrowser,
  isTagLoaded,
  setInternalBrowser,
} from "@/lib/analytics";

const GA4_REPORTS = "https://analytics.google.com/analytics/web/";

/**
 * What the site reports to Google Analytics, for the people who read it.
 *
 * The numbers live in GA4, not here — this panel says which events exist, what
 * each one means, which to mark as Key Events, and whether this browser is
 * counted. The last matters most: Dorit testing the site from her own phone
 * would otherwise show up as leads.
 */
export default function LeadTrackingPanel() {
  const [internal, setInternal] = useState(false);
  const [tagLoaded, setTagLoaded] = useState(false);

  useEffect(() => {
    setInternal(isInternalBrowser());
    setTagLoaded(isTagLoaded());
  }, []);

  const toggleInternal = () => {
    setInternalBrowser(!internal);
    setInternal(isInternalBrowser());
  };

  return (
    <section aria-labelledby="lead-tracking-title" className="mb-10 border border-border/60 bg-card">
      <div className="px-6 py-5 border-b border-border/60 flex items-center gap-3">
        <BarChart3 size={20} className="text-accent shrink-0" aria-hidden="true" />
        <div>
          <h2 id="lead-tracking-title" className="font-heading text-xl">
            מעקב לידים ב-Google Analytics
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            מה האתר מדווח, ואיך רואים את זה. המספרים עצמם נמצאים ב-Google Analytics.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 border-b border-border/60">
        <Status
          ok={tagLoaded}
          title="התג פעיל בדפדפן הזה"
          yes="כן — אירועים נשלחים"
          no="לא — כנראה חוסם פרסומות. מבקרים אחרים לא מושפעים."
        />
        <div className="p-5 border-t md:border-t-0 md:border-x border-border/60">
          <p className="text-[13px] text-muted-foreground">הדפדפן הזה</p>
          <p className="mt-1 font-medium">{internal ? "מסומן כגלישה פנימית" : "נספר כמבקר רגיל"}</p>
          <button
            type="button"
            onClick={toggleInternal}
            className="mt-3 text-sm border border-accent/40 text-accent hover:bg-accent/10 px-3 py-1.5 transition-colors"
          >
            {internal ? "ביטול הסימון" : "סמנו כגלישה פנימית"}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            כדי שהבדיקות שלכם לא ייספרו כלידים. פעם אחת בכל מכשיר.
          </p>
        </div>
        <div className="p-5 border-t md:border-t-0 border-border/60">
          <p className="text-[13px] text-muted-foreground">נכס ב-Google Analytics</p>
          <p className="mt-1 font-medium" dir="ltr">
            {GA4_MEASUREMENT_ID}
          </p>
          <a
            href={GA4_REPORTS}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
          >
            פתיחת הדוחות <ExternalLink size={14} aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">האירועים שהאתר שולח ל-Google Analytics</caption>
          <thead className="bg-secondary/40 text-right">
            <tr>
              <th scope="col" className="px-6 py-3 font-medium">אירוע</th>
              <th scope="col" className="px-6 py-3 font-medium">מה זה אומר</th>
              <th scope="col" className="px-6 py-3 font-medium">מתי נשלח</th>
              <th scope="col" className="px-6 py-3 font-medium">Key Event</th>
            </tr>
          </thead>
          <tbody>
            {LEAD_EVENTS.map((e) => (
              <tr key={e.name} className="border-t border-border/50 align-top">
                <td className="px-6 py-3 font-mono text-[13px]" dir="ltr">{e.name}</td>
                <td className="px-6 py-3">{e.meaning}</td>
                <td className="px-6 py-3 text-muted-foreground">{e.when}</td>
                <td className="px-6 py-3">{e.keyEvent ? "מומלץ" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-6 py-4 border-t border-border/60 text-xs text-muted-foreground leading-relaxed space-y-1">
        <p>
          לראות לידים: ב-Google Analytics ← Reports ← Engagement ← Events. לסמן Key Event: Admin ← Events,
          ולהפעיל את המתג ליד כל אירוע שמסומן כאן "מומלץ".
        </p>
        <p>לא נשלחים ל-Google שם, טלפון, מייל, תוכן הודעה או תוכן שיחה — רק שם האירוע ומאיפה בדף הוא קרה.</p>
      </div>
    </section>
  );
}

function Status({ ok, title, yes, no }: { ok: boolean; title: string; yes: string; no: string }) {
  return (
    <div className="p-5">
      <p className="text-[13px] text-muted-foreground">{title}</p>
      <p className="mt-1 font-medium inline-flex items-center gap-1.5">
        {ok ? (
          <Check size={16} className="text-accent" aria-hidden="true" />
        ) : (
          <X size={16} className="text-destructive" aria-hidden="true" />
        )}
        {ok ? yes : no}
      </p>
    </div>
  );
}
