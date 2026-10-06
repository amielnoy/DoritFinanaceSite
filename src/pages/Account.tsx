import React from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { services } from "@/services";
import { AccountLoadError, type Enquiry } from "@/services/ports";

// A row with no stored date arrives as "" — print nothing rather than "Invalid Date".
const fmt = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "medium", timeStyle: "short" });
};

const SOURCE_LABELS: Record<string, string> = {
  quick: "טופס יצירת קשר",
  detailed: "פנייה מפורטת",
  consultation: "בקשת פגישה",
  claim: "דיווח על תביעה",
  escalation: "בקשה לשיחה עם דורית",
};

const time = (iso?: string) => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? null : t;
};

// Upcoming (soonest first), then past (most recent first), then undated (as given).
function orderMeetings(list: Enquiry[], now: Date): Enquiry[] {
  const at = now.getTime();
  const dated = list.filter((e) => time(e.scheduledAt) !== null);
  const undated = list.filter((e) => time(e.scheduledAt) === null);
  const upcoming = dated.filter((e) => time(e.scheduledAt)! >= at).sort((a, b) => time(a.scheduledAt)! - time(b.scheduledAt)!);
  const past = dated.filter((e) => time(e.scheduledAt)! < at).sort((a, b) => time(b.scheduledAt)! - time(a.scheduledAt)!);
  return [...upcoming, ...past, ...undated];
}

/**
 * האזור האישי — מה שהמבקר מסר, ומתי הוא נפגש עם דורית.
 *
 * Read only. An enquiry appears when its email equals the signed-in user's
 * verified address; see docs/superpowers/specs/2026-10-06-personal-area-design.md.
 * Everything is rendered as text — never markdown or HTML — so nothing stored
 * can turn into markup on this page.
 */
export default function Account({ loadEnquiries = () => services.account.myEnquiries(), now = new Date() }: {
  loadEnquiries?: () => Promise<Enquiry[]>;
  now?: Date;
}) {
  const { user, logout } = useAuth();
  const query = useQuery<Enquiry[], unknown>({
    // Keyed by the signed-in user, so a session switch cannot show the previous user's rows.
    queryKey: ["account", "enquiries", user?.id ?? user?.email ?? "anonymous"],
    queryFn: loadEnquiries,
    // Only a "failed" load is worth retrying (once); signed-out and unverified will not change.
    retry: (count, err) => !(err instanceof AccountLoadError && err.reason !== "failed") && count < 1,
  });
  const enquiries = query.data ?? [];
  const meetings = orderMeetings(enquiries.filter((e) => e.scheduledAt || e.meetingTopic), now);
  const others = enquiries.filter((e) => e.source !== "interview" && !e.scheduledAt && !e.meetingTopic);
  const interviews = enquiries.filter((e) => e.source === "interview");
  const error = query.error instanceof AccountLoadError ? query.error : query.error ? new AccountLoadError("failed") : null;
  // The session ended between the route guard and the request: sign in again.
  if (error?.reason === "signed_out") return <Navigate to="/login?returnTo=/account" replace />;

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 pt-32 pb-24 space-y-12">
        <header>
          <h1 className="font-heading text-4xl">האזור שלי</h1>
        </header>

        <section aria-labelledby="details">
          <h2 id="details" className="font-heading text-2xl mb-3">הפרטים שלי</h2>
          <p>{String(user?.full_name ?? "")}</p>
          <p dir="ltr" className="text-start text-muted-foreground">{String(user?.email ?? "")}</p>
          {/* Google remembers the account; the sign-in that follows asks which
              one (prompt=select_account), so this is how a visitor switches. */}
          <button
            type="button"
            onClick={() => logout(true, `${window.location.origin}/login?returnTo=/account`)}
            className="mt-3 text-sm border border-accent/40 text-accent hover:bg-accent/10 px-3 py-1.5 transition-colors"
          >
            יציאה והתחברות עם חשבון אחר
          </button>
        </section>

        {query.isPending ? <p role="status" className="text-muted-foreground">טוען…</p> : null}

        {error?.reason === "unverified" ? (
          <p role="status">כתובת המייל בחשבון עדיין לא אומתה. אחרי האימות יופיעו כאן הפניות שנשלחו ממנה.</p>
        ) : error ? (
          <div role="alert">
            לא הצלחנו לטעון את הפרטים. אפשר לנסות שוב.
            {error.rid ? <> מזהה לבירור: <span dir="ltr">{error.rid}</span></> : null}
          
            {" "}
            <button type="button" className="underline" onClick={() => void query.refetch()}>ניסיון נוסף</button>
          </div>
        ) : null}

        {!query.isPending && !error && enquiries.length === 0 ? <p>עוד אין כאן פניות</p> : null}

        {!query.isPending && !error && enquiries.length > 0 ? (
          <>
            <section aria-labelledby="meetings">
              <h2 id="meetings" className="font-heading text-2xl mb-3">הפגישות שלי</h2>
              {meetings.length === 0 ? <p>אין כאן פגישות</p> : (
                <ul className="space-y-3">
                  {meetings.map((e, i) => (
                    <li key={`m-${i}`} className="border border-border/60 p-4">
                      <p className="font-medium">{e.meetingTopic ?? e.trackLabel ?? "פגישה"}</p>
                      <p className="text-sm text-muted-foreground">{(e.scheduledAt ? fmt(e.scheduledAt) : e.timing) || "המועד טרם נקבע"}</p>
                      <p className="text-sm mt-1">{e.inCalendar ? "ביומן" : "ממתינה לאישור דורית"}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="interviews">
              <h2 id="interviews" className="font-heading text-2xl mb-3">סיכומי ההיכרות שלי</h2>
              {interviews.length === 0 ? <p>אין כאן סיכומי היכרות</p> : (
                <ul className="space-y-4">
                  {interviews.map((e, i) => (
                    <li key={`i-${i}`} className="border border-border/60 p-4">
                      <p className="font-medium">{[e.trackLabel ?? "ראיון היכרות", fmt(e.createdAt)].filter(Boolean).join(" · ")}</p>
                      {!e.completed ? <p className="text-sm text-muted-foreground mt-1">לא הושלם</p> : null}
                      {e.summary ? <p className="mt-2">{e.summary}</p> : null}
                      {e.profile.length ? (
                        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                          {e.profile.map(([label, value], n) => (
                            <React.Fragment key={`${label}-${n}`}>
                              <dt className="text-muted-foreground">{label}</dt>
                              <dd>{value}</dd>
                            </React.Fragment>
                          ))}
                        </dl>
                      ) : e.completed ? (
                        <p className="text-sm text-muted-foreground mt-2">הסיכום לא נשמר לפנייה הזו — היא קודמת לאזור האישי.</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {others.length > 0 ? (
              <section aria-labelledby="others">
                <h2 id="others" className="font-heading text-2xl mb-3">פניות נוספות</h2>
                <ul className="space-y-3">
                  {others.map((e, i) => (
                    <li key={`o-${i}`} className="border border-border/60 p-4">
                      <p>{[SOURCE_LABELS[e.source] ?? "פנייה", fmt(e.createdAt)].filter(Boolean).join(" · ")}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}

        <section aria-labelledby="rights" className="text-sm text-muted-foreground space-y-2">
          <h2 id="rights" className="sr-only">פרטיות</h2>
          <p>פניות שנשלחו בלי כתובת מייל, או מכתובת אחרת, אינן מופיעות כאן.</p>
          <p>
            <Link to="/privacy" className="underline">בקשת עיון, תיקון או מחיקה</Link> — כמפורט במדיניות הפרטיות.
          </p>
        </section>
      </div>
    </main>
  );
}
