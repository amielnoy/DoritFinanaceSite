import React, { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { services } from "@/services";
import { AccountLoadError, type ClientAnswer, type ClientSnapshot, type Enquiry } from "@/services/ports";
import SnapshotView from "@/components/dorit/account/SnapshotView";
import { SNAPSHOT_HOME } from "@/config/snapshot";
import { PENSION_CHECK } from "@/config/offers";

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

/**
 * The "תמונת מצב" tab: the snapshot Dorit published to this address, or a way
 * to ask for one. Answers go straight to her (respond_to_recommendation).
 */
function SnapshotTab({ userKey, load, respond }: {
  userKey: string;
  load: () => Promise<ClientSnapshot | null>;
  respond: (itemId: string, status: ClientAnswer, note?: string) => Promise<void>;
}) {
  const client = useQueryClient();
  const key = ["account", "snapshot", userKey] as const;
  const query = useQuery<ClientSnapshot | null, unknown>({ queryKey: key, queryFn: load, retry: false });
  if (query.isPending) return <p role="status" className="text-muted-foreground">טוען…</p>;
  if (query.isError) {
    return (
      <div role="alert">
        לא הצלחנו לטעון את תמונת המצב.{" "}
        <button type="button" className="underline" onClick={() => void query.refetch()}>ניסיון נוסף</button>
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className="rounded-[4px] border border-border p-6">
        <p className="font-heading text-xl">עוד אין כאן תמונת מצב</p>
        <p className="mt-2 text-muted-foreground">
          אחרי שתמסרו קוד מהמסלקה ודורית תעבור על הנתונים, תמונת המצב וההמלצות שלה יופיעו כאן.
        </p>
        <a href={PENSION_CHECK.path} className="mt-4 inline-flex min-h-11 items-center rounded-md border border-highlight px-5 text-accent">
          ל{PENSION_CHECK.name}
        </a>
      </div>
    );
  }
  return (
    <SnapshotView
      data={query.data}
      onAnswer={async (itemId, status, note) => {
        await respond(itemId, status, note);
        await client.invalidateQueries({ queryKey: key });
      }}
    />
  );
}

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
export default function Account({
  loadEnquiries = () => services.account.myEnquiries(),
  loadSnapshot = () => services.account.mySnapshot(),
  respond = (itemId, status, note) => services.account.respondToRecommendation(itemId, status, note),
  snapshotEnabled = SNAPSHOT_HOME,
  now = new Date(),
}: {
  loadEnquiries?: () => Promise<Enquiry[]>;
  loadSnapshot?: () => Promise<ClientSnapshot | null>;
  respond?: (itemId: string, status: ClientAnswer, note?: string) => Promise<void>;
  /** VITE_SNAPSHOT_HOME: the "תמונת מצב" tab comes first; off, the page is as it was. */
  snapshotEnabled?: boolean;
  now?: Date;
}) {
  const [tab, setTab] = useState<"snapshot" | "enquiries">(snapshotEnabled ? "snapshot" : "enquiries");
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

        {snapshotEnabled ? (
          <div role="tablist" aria-label="האזור שלי" className="flex gap-2 border-b border-border">
            {([["snapshot", "תמונת מצב"], ["enquiries", "הפניות שלי"]] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`panel-${id}`}
                onClick={() => setTab(id)}
                className={`min-h-11 px-4 -mb-px border-b-2 ${tab === id ? "border-highlight text-accent" : "border-transparent text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {snapshotEnabled && tab === "snapshot" ? (
          <div role="tabpanel" id="panel-snapshot" aria-labelledby="tab-snapshot">
            <SnapshotTab userKey={String(user?.id ?? user?.email ?? "anonymous")} load={loadSnapshot} respond={respond} />
          </div>
        ) : (
        // The enquiries, as they were; a tab panel only when there are tabs.
        <div {...(snapshotEnabled ? { role: "tabpanel", id: "panel-enquiries", "aria-labelledby": "tab-enquiries" } : {})} className="space-y-12">
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
        </div>
        )}

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
