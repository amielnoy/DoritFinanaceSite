import React, { useMemo, useState } from "react";
import { Archive, Check, Copy, Megaphone, MessageCircle, Pencil, RotateCcw } from "lucide-react";
import type { Campaign } from "@/services";
import { useAgencyProfile, useCampaigns, useCreateCampaign, useLeads, useUpdateCampaign } from "@/hooks/useAdmin";
import { useAgencyRole, useCurrentAgency } from "@/hooks/useAgency";
import { useAuth } from "@/lib/AuthContext";
import { useSeo, SITE_URL } from "@/lib/seo";
import { DEFAULT_CAMPAIGN_MESSAGE, campaignLink, campaignMessage, campaignProblem, shareWhatsappHref } from "@/lib/campaigns";

const BUTTON =
  "inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm hover:border-accent hover:text-accent disabled:opacity-40";
const INPUT = "w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-accent focus:outline-none";

/** Copies `text`, and says so for two seconds. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={BUTTON}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 2000);
        });
      }}
    >
      {done ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      {done ? "הועתק" : label}
    </button>
  );
}

/** A campaign's name and message, as typed — shared by "קמפיין חדש" and "עריכה". */
function CampaignFields({
  name,
  message,
  onName,
  onMessage,
  preview,
}: {
  name: string;
  message: string;
  onName: (v: string) => void;
  onMessage: (v: string) => void;
  preview: string;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <label className="block text-sm">
          שם הקמפיין
          <input value={name} onChange={(e) => onName(e.target.value)} maxLength={80} className={`${INPUT} mt-1`} />
        </label>
        <label className="block text-sm">
          ההודעה
          <textarea value={message} onChange={(e) => onMessage(e.target.value)} rows={6} maxLength={1000} className={`${INPUT} mt-1`} />
        </label>
        <p className="text-xs text-muted-foreground">
          {"{agent}"} — שמך, {"{link}"} — הקישור לקמפיין. שורת ההסרה (״להסרה השב/י ׳הסר׳״) חובה.
        </p>
      </div>
      <div>
        <p className="mb-1 text-sm">כך תיראה ההודעה</p>
        <p dir="rtl" className="whitespace-pre-wrap rounded-xl bg-emerald-500/10 p-4 text-sm leading-relaxed">
          {preview}
        </p>
      </div>
    </div>
  );
}

/**
 * /admin/campaigns — reactivation campaigns, stage 1: a general link an agency
 * sends its own existing clients, and the leads it brought. Every member sees
 * the campaigns; Admin and Owner create and edit them (campaigns.manage, and
 * the table's policies). See src/lib/campaigns.ts for the link and message.
 */
export default function Campaigns() {
  useSeo({ title: "קמפיינים", description: "קמפיינים ללקוחות קיימים", path: "/admin/campaigns", noIndex: true });
  const { agencyId } = useCurrentAgency();
  const { can } = useAgencyRole(agencyId);
  const manages = can("campaigns.manage");
  const { user } = useAuth();
  const profile = useAgencyProfile(agencyId);
  const agent = user?.full_name || profile.data?.displayName || "";
  const campaigns = useCampaigns(agencyId);
  const leads = useLeads();
  const create = useCreateCampaign();
  const update = useUpdateCampaign(agencyId);

  const [name, setName] = useState("");
  const [message, setMessage] = useState(DEFAULT_CAMPAIGN_MESSAGE);
  const [editing, setEditing] = useState<{ id: string; name: string; message: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  /** Leads each campaign brought, by its code: channel 'reactivation', campaign = code, this agency. */
  const brought = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of leads.data ?? []) {
      if (l.channel !== "reactivation" || !l.campaign || (l.agency_id && l.agency_id !== agencyId)) continue;
      counts.set(l.campaign, (counts.get(l.campaign) ?? 0) + 1);
    }
    return counts;
  }, [leads.data, agencyId]);

  const sample = campaignLink(SITE_URL, "xxxxxxxxxxxx");
  const newProblem = campaignProblem({ name, message });
  const active = (campaigns.data ?? []).filter((c) => !c.archivedAt);
  const archived = (campaigns.data ?? []).filter((c) => c.archivedAt);

  const card = (c: Campaign) => {
    const link = campaignLink(SITE_URL, c.code);
    const text = campaignMessage(c.message, { agent, link });
    const isEditing = editing?.id === c.id;
    const editProblem = isEditing ? campaignProblem({ name: editing.name, message: editing.message }) : null;
    return (
      <li key={c.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold">{c.name}</h3>
            <p className="text-xs text-muted-foreground">
              נוצר {new Date(c.createdAt).toLocaleDateString("he-IL")}
              {c.archivedAt ? " · בארכיון" : ""}
            </p>
          </div>
          <p className="rounded-full bg-secondary px-3 py-1 text-sm">
            <span className="font-bold tabular-nums">{brought.get(c.code) ?? 0}</span> פניות מהקמפיין
          </p>
        </div>

        {isEditing ? (
          <div className="space-y-3">
            <CampaignFields
              name={editing.name}
              message={editing.message}
              onName={(v) => setEditing({ ...editing, name: v })}
              onMessage={(v) => setEditing({ ...editing, message: v })}
              preview={campaignMessage(editing.message, { agent, link })}
            />
            {editProblem ? <p role="alert" className="text-sm text-destructive">{editProblem}</p> : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={Boolean(editProblem) || update.isPending}
                onClick={() =>
                  update.mutate({ id: c.id, fields: { name: editing.name, message: editing.message } }, { onSuccess: () => setEditing(null) })
                }
                className="min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-40"
              >
                שמירה
              </button>
              <button type="button" onClick={() => setEditing(null)} className={BUTTON}>
                ביטול
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm">
              הקישור לקמפיין
              <input readOnly dir="ltr" value={link} className={`${INPUT} mt-1 text-left`} onFocus={(e) => e.currentTarget.select()} />
            </label>
            <p dir="rtl" className="whitespace-pre-wrap rounded-xl bg-emerald-500/10 p-4 text-sm leading-relaxed">
              {text}
            </p>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={link} label="העתקת הקישור" />
              <CopyButton text={text} label="העתקת ההודעה" />
              <a href={shareWhatsappHref(text)} target="_blank" rel="noopener noreferrer" className={BUTTON}>
                <MessageCircle size={15} aria-hidden="true" /> שליחה בוואטסאפ
              </a>
              {manages ? (
                <>
                  <button type="button" onClick={() => setEditing({ id: c.id, name: c.name, message: c.message })} className={BUTTON}>
                    <Pencil size={15} aria-hidden="true" /> עריכה
                  </button>
                  <button
                    type="button"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ id: c.id, fields: { archived: !c.archivedAt } })}
                    className={BUTTON}
                  >
                    {c.archivedAt ? <RotateCcw size={15} aria-hidden="true" /> : <Archive size={15} aria-hidden="true" />}
                    {c.archivedAt ? "החזרה מהארכיון" : "העברה לארכיון"}
                  </button>
                </>
              ) : null}
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1200px] px-6 pt-8">
        <h1 className="flex items-center gap-2 font-heading text-3xl font-bold">
          <Megaphone size={26} aria-hidden="true" className="text-accent" /> קמפיינים
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">קישור כללי ללקוחות קיימים, והפניות שהוא מביא.</p>
      </div>
      <main id="main" className="mx-auto max-w-[1200px] space-y-6 px-6 py-6">
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm leading-relaxed">
          הודעה ללקוחות קיימים עשויה להיחשב ״דבר פרסומת״. כל הודעה חייבת לכלול שורת הסרה, ומי שביקש/ה הסרה — אין לפנות אליו/ה שוב.
          לפני שליחה ראשונה כדאי לוודא את הנוסח עם הממונה על הציות.
        </p>

        {manages ? (
          <section aria-labelledby="new-campaign" className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 id="new-campaign" className="mb-4 text-base font-bold">קמפיין חדש</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newProblem) return;
                create.mutate({ agencyId, name, message }, { onSuccess: () => { setName(""); setMessage(DEFAULT_CAMPAIGN_MESSAGE); } });
              }}
              className="space-y-3"
            >
              <CampaignFields name={name} message={message} onName={setName} onMessage={setMessage} preview={campaignMessage(message, { agent, link: sample })} />
              {name && newProblem ? <p role="alert" className="text-sm text-destructive">{newProblem}</p> : null}
              {create.isError ? <p role="alert" className="text-sm text-destructive">{(create.error as Error).message}</p> : null}
              <button
                type="submit"
                disabled={Boolean(newProblem) || create.isPending}
                className="min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-accent-foreground disabled:opacity-40"
              >
                יצירת קמפיין
              </button>
            </form>
          </section>
        ) : null}

        {update.isError ? <p role="alert" className="text-sm text-destructive">{(update.error as Error).message}</p> : null}

        <section aria-labelledby="campaign-list">
          <h2 id="campaign-list" className="mb-3 text-base font-bold">הקמפיינים של הסוכנות</h2>
          {campaigns.isPending ? (
            <p className="text-sm text-muted-foreground">טוען…</p>
          ) : campaigns.isError ? (
            <p role="alert" className="text-sm text-destructive">לא הצלחנו לטעון את הקמפיינים.</p>
          ) : !active.length ? (
            <p className="text-sm text-muted-foreground">{manages ? "אין עדיין קמפיינים. אפשר ליצור אחד למעלה." : "אין עדיין קמפיינים."}</p>
          ) : (
            <ul className="space-y-4">{active.map(card)}</ul>
          )}
          {archived.length ? (
            <div className="mt-6">
              <button type="button" onClick={() => setShowArchived((v) => !v)} aria-expanded={showArchived} className="text-sm text-accent hover:underline">
                בארכיון ({archived.length})
              </button>
              {showArchived ? <ul className="mt-3 space-y-4">{archived.map(card)}</ul> : null}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
