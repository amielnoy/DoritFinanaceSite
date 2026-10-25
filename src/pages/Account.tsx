import React, { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/AuthContext";
import { services } from "@/services";
import { AccountLoadError, type ClientAnswer, type ClientMeeting, type ClientSnapshot, type Enquiry } from "@/services/ports";
import SnapshotView from "@/components/dorit/account/SnapshotView";
import MeetingsTab from "@/components/dorit/account/MeetingsTab";
import { SNAPSHOT_HOME } from "@/config/snapshot";
import { MEETINGS_CLIENT } from "@/config/meetings";
import type { MeetingRequestKind } from "@/lib/meetings";
import { PENSION_CHECK } from "@/config/offers";
import { CalendarDays, CircleCheck, Inbox, LogOut, MessageSquareText, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";

/** The page's cards and the rows inside them. */
const CARD = "card-raised p-5 md:p-7";
const ITEM = "rounded-xl border border-border bg-secondary/40 p-4";

/** A card's heading: an icon tile and the title. */
function CardTitle({ id, icon: Icon, children }: { id: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-5 flex items-center gap-3 font-heading text-2xl font-bold">
      <span aria-hidden="true" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-highlight/10 text-accent">
        <Icon size={20} />
      </span>
      {children}
    </h2>
  );
}

/** Up to two initials for the avatar; a person icon when there is no name. */
const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");

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
  staff: "פנייה דרך הצוות",
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
      <div className="card-raised p-6 md:p-8">
        <p className="font-heading text-xl font-bold">עוד אין כאן תמונת מצב</p>
        <p className="mt-2 text-muted-foreground">
          אחרי שתמסרו קוד מהמסלקה ודורית תעבור על הנתונים, תמונת המצב וההמלצות שלה יופיעו כאן.
        </p>
        <a href={PENSION_CHECK.path} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-primary px-5 font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90">
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
  loadMeetings = () => services.account.myMeetings(),
  requestChange = (meetingId, kind, note) => services.account.requestMeetingChange(meetingId, kind, note),
  snapshotEnabled = SNAPSHOT_HOME,
  meetingsEnabled = MEETINGS_CLIENT,
  now = new Date(),
}: {
  loadEnquiries?: () => Promise<Enquiry[]>;
  loadSnapshot?: () => Promise<ClientSnapshot | null>;
  respond?: (itemId: string, status: ClientAnswer, note?: string) => Promise<void>;
  loadMeetings?: () => Promise<ClientMeeting[]>;
  requestChange?: (meetingId: string, kind: MeetingRequestKind, note?: string) => Promise<void>;
  /** VITE_SNAPSHOT_HOME: the "תמונת מצב" tab comes first; off, the page is as it was. */
  snapshotEnabled?: boolean;
  /** VITE_MEETINGS_CLIENT: a "הפגישות שלי" tab from my_meetings(); off, the page is as it was. */
  meetingsEnabled?: boolean;
  now?: Date;
}) {
  type Tab = "snapshot" | "meetings" | "enquiries";
  const tabs: [Tab, string][] = [
    ...(snapshotEnabled ? [["snapshot", "תמונת מצב"] as [Tab, string]] : []),
    ...(meetingsEnabled ? [["meetings", "הפגישות שלי"] as [Tab, string]] : []),
    ["enquiries", "הפניות שלי"],
  ];
  const [tab, setTab] = useState<Tab>(tabs[0][0]);
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

  const name = String(user?.full_name ?? "");
  const initials = initialsOf(name);
  const loaded = !query.isPending && !error;
  // The overview row: what the page holds, in its own words. The meetings count only where they are listed here.
  const counts: [string, number][] = [
    ...(!meetingsEnabled ? [["הפגישות שלי", meetings.length] as [string, number]] : []),
    ["סיכומי ההיכרות שלי", interviews.length],
    ["פניות נוספות", others.length],
  ];

  return (
    <main id="main" className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 pt-32 pb-24 space-y-8">
        <header>
          <h1 className="font-heading font-extrabold text-4xl md:text-5xl">האזור שלי</h1>
        </header>

        <section aria-labelledby="details" className="card-raised relative overflow-hidden p-5 pt-7 md:p-7 md:pt-9">
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-l from-primary to-highlight" />
          <h2 id="details" className="sr-only">הפרטים שלי</h2>
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="flex min-w-0 items-center gap-4">
              <span
                aria-hidden="true"
                className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary font-heading text-2xl font-bold text-primary-foreground"
              >
                {initials || <UserRound size={28} />}
              </span>
              <div className="min-w-0">
                <p className="font-heading text-2xl font-bold">{name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2">
                  <span dir="ltr" className="text-start text-muted-foreground break-all">{String(user?.email ?? "")}</span>
                  {query.isSuccess ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-semibold text-green-700 dark:text-green-400">
                      <CircleCheck size={13} aria-hidden="true" />
                      מאומת
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
            {/* Google remembers the account; the sign-in that follows asks which
                one (prompt=select_account), so this is how a visitor switches. */}
            <button
              type="button"
              onClick={() => logout(true, `${window.location.origin}/login?returnTo=/account`)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium shadow-sm transition-colors hover:border-accent hover:text-accent"
            >
              <LogOut size={16} aria-hidden="true" className="ltr:rotate-180" />
              יציאה והתחברות עם חשבון אחר
            </button>
          </div>
          {loaded && enquiries.length > 0 ? (
            <dl className="mt-6 grid grid-cols-1 gap-4 border-t border-border pt-5 sm:grid-cols-3">
              {counts.map(([label, n]) => (
                <div key={label}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-heading text-3xl font-extrabold leading-none tabular-nums">{n}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>

        {tabs.length > 1 ? (
          <div role="tablist" aria-label="האזור שלי" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-secondary/60 p-1">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`panel-${id}`}
                onClick={() => setTab(id)}
                className={`min-h-11 shrink-0 rounded-lg px-4 text-sm font-semibold transition-colors ${
                  tab === id ? "bg-card text-accent shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
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
        ) : meetingsEnabled && tab === "meetings" ? (
          <div role="tabpanel" id="panel-meetings" aria-labelledby="tab-meetings">
            <MeetingsTab userKey={String(user?.id ?? user?.email ?? "anonymous")} load={loadMeetings} requestChange={requestChange} now={now} />
          </div>
        ) : (
        // The enquiries, as they were; a tab panel only when there are tabs.
        <div {...(tabs.length > 1 ? { role: "tabpanel", id: "panel-enquiries", "aria-labelledby": "tab-enquiries" } : {})} className="space-y-8">
        {query.isPending ? <p role="status" className="text-muted-foreground">טוען…</p> : null}

        {error?.reason === "unverified" ? (
          <p role="status" className="rounded-xl border border-highlight/40 bg-highlight/10 p-4">כתובת המייל בחשבון עדיין לא אומתה. אחרי האימות יופיעו כאן הפניות שנשלחו ממנה.</p>
        ) : error ? (
          <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
            לא הצלחנו לטעון את הפרטים. אפשר לנסות שוב.
            {error.rid ? <> מזהה לבירור: <span dir="ltr">{error.rid}</span></> : null}
          
            {" "}
            <button type="button" className="font-medium underline" onClick={() => void query.refetch()}>ניסיון נוסף</button>
          </div>
        ) : null}

        {loaded && enquiries.length === 0 ? (
          <div className="card-raised flex flex-col items-center px-6 py-14 text-center">
            <span aria-hidden="true" className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-highlight/10 text-accent">
              <Inbox size={30} />
            </span>
            <p className="mt-5 font-heading text-2xl font-bold">עוד אין כאן פניות</p>
          </div>
        ) : null}

        {loaded && enquiries.length > 0 ? (
          <>
            {/* With the meetings tab, the meetings live there (my_meetings), not here. */}
            {!meetingsEnabled ? (
            <section aria-labelledby="meetings" className={CARD}>
              <CardTitle id="meetings" icon={CalendarDays}>הפגישות שלי</CardTitle>
              {meetings.length === 0 ? <p className="text-muted-foreground">אין כאן פגישות</p> : (
                <ul className="space-y-3">
                  {meetings.map((e, i) => (
                    <li key={`m-${i}`} className={`${ITEM} flex flex-wrap items-center justify-between gap-3`}>
                      <div>
                        <p className="font-heading font-bold">{e.meetingTopic ?? e.trackLabel ?? "פגישה"}</p>
                        <p className="text-sm text-muted-foreground">{(e.scheduledAt ? fmt(e.scheduledAt) : e.timing) || "המועד טרם נקבע"}</p>
                      </div>
                      <p
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          e.inCalendar ? "bg-green-500/10 text-green-700 dark:text-green-400" : "bg-highlight/10 text-accent"
                        }`}
                      >
                        {e.inCalendar ? "ביומן" : "ממתינה לאישור דורית"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            ) : null}

            <section aria-labelledby="interviews" className={CARD}>
              <CardTitle id="interviews" icon={MessageSquareText}>סיכומי ההיכרות שלי</CardTitle>
              {interviews.length === 0 ? <p className="text-muted-foreground">אין כאן סיכומי היכרות</p> : (
                <ul className="space-y-4">
                  {interviews.map((e, i) => (
                    <li key={`i-${i}`} className={ITEM}>
                      <p className="flex flex-wrap items-center gap-2 font-heading font-bold">
                        {[e.trackLabel ?? "ראיון היכרות", fmt(e.createdAt)].filter(Boolean).join(" · ")}
                      </p>
                      {!e.completed ? (
                        <p className="mt-1.5 inline-block rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">לא הושלם</p>
                      ) : null}
                      {e.summary ? <p className="mt-2 leading-relaxed">{e.summary}</p> : null}
                      {e.profile.length ? (
                        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg bg-card p-3 text-sm">
                          {e.profile.map(([label, value], n) => (
                            <React.Fragment key={`${label}-${n}`}>
                              <dt className="text-muted-foreground">{label}</dt>
                              <dd className="font-medium">{value}</dd>
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
              <section aria-labelledby="others" className={CARD}>
                <CardTitle id="others" icon={Inbox}>פניות נוספות</CardTitle>
                <ul className="space-y-3">
                  {others.map((e, i) => (
                    <li key={`o-${i}`} className={ITEM}>
                      <p className="font-medium">{[SOURCE_LABELS[e.source] ?? "פנייה", fmt(e.createdAt)].filter(Boolean).join(" · ")}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
        </div>
        )}

        <section aria-labelledby="rights" className="flex gap-3 rounded-xl border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
          <h2 id="rights" className="sr-only">פרטיות</h2>
          <ShieldCheck size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
          <div className="space-y-1.5">
            <p>פניות שנשלחו בלי כתובת מייל, או מכתובת אחרת, אינן מופיעות כאן.</p>
            <p>
              <Link to="/privacy" className="font-medium text-accent underline">בקשת עיון, תיקון או מחיקה</Link> — כמפורט במדיניות הפרטיות.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
