import React, { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Loader2, Send } from "lucide-react";
import SnapshotView from "@/components/dorit/account/SnapshotView";
import { failureText } from "@/lib/masleka";
import { CUSTOM_PREFIX } from "@/lib/clearinghouse/review";
import type {
  ClientAnswer,
  MaslekaPort,
  PublishItem,
  RecommendationPriority,
  ReviewDecision,
  StoredSnapshot,
} from "@/services/ports";

/**
 * Dorit's side of the personal snapshot (phase 4), under the review on
 * /admin/masleka/analysis/:id: a recommendation of her own, the address to
 * publish to, "תצוגה כפי שהלקוח רואה", "פרסום לאזור האישי", and the client's
 * answers once it is out. Nothing reaches the client until she publishes, and
 * a publish sends only what she approved.
 */

const buttonClass =
  "inline-flex min-h-11 items-center gap-2 border border-border/60 px-3 py-1.5 text-sm hover:border-accent disabled:opacity-60";

const PRIORITY_LABEL: Record<RecommendationPriority, string> = { important: "חשוב", check: "כדאי לבדוק" };
const ANSWER_LABEL: Record<ClientAnswer, string> = { open: "טרם ענה", accepted: "כן, לטפל בזה", question: "יש לי שאלה" };

/** "הוספת המלצה": her own recommendation, approved by being written. */
export function CustomRecommendationForm({
  busy,
  onAdd,
  newKey = () => `${CUSTOM_PREFIX}${crypto.randomUUID()}`,
}: {
  busy: boolean;
  onAdd: (key: string, decision: ReviewDecision) => Promise<unknown>;
  newKey?: () => string;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<RecommendationPriority>("check");
  const saving = useRef(false);
  // A retry after an uncertain write updates the same recommendation.
  const draftKey = useRef<string | null>(null);
  const id = useId();
  const ready = title.trim().length > 0 && body.trim().length > 0;
  return (
    <form
      aria-label="הוספת המלצה"
      className="rounded-[4px] border border-dashed border-border p-4 print:hidden"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready || busy || saving.current) return;
        saving.current = true;
        draftKey.current ??= newKey();
        try {
          await onAdd(draftKey.current, { status: "approved", finalText: body.trim(), title: title.trim(), priority });
          setTitle("");
          setBody("");
          setPriority("check");
          draftKey.current = null;
        } catch {
          // The parent's mutation displays the error; keep the draft for retry.
        } finally {
          saving.current = false;
        }
      }}
    >
      <p className="font-medium">הוספת המלצה משלך</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor={`${id}-title`} className="block text-sm text-muted-foreground">כותרת</label>
          <input id={`${id}-title`} disabled={busy} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} className="mt-1 w-full border border-border bg-background px-2 py-1.5" />
        </div>
        <div>
          <label htmlFor={`${id}-priority`} className="block text-sm text-muted-foreground">עדיפות</label>
          <select id={`${id}-priority`} disabled={busy} value={priority} onChange={(e) => setPriority(e.target.value as RecommendationPriority)} className="mt-1 border border-border bg-background px-2 py-1.5">
            <option value="important">{PRIORITY_LABEL.important}</option>
            <option value="check">{PRIORITY_LABEL.check}</option>
          </select>
        </div>
      </div>
      <label htmlFor={`${id}-body`} className="mt-3 block text-sm text-muted-foreground">הסבר ללקוח</label>
      <textarea id={`${id}-body`} disabled={busy} value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={4000} className="mt-1 w-full border border-border bg-background p-2 text-sm" />
      <button type="submit" disabled={busy || !ready} className={`${buttonClass} mt-3 border-primary`}>
        הוספה ואישור
      </button>
    </form>
  );
}

export default function PublishPanel({
  service,
  stored,
  items,
  confirm = (message) => window.confirm(message),
}: {
  service: MaslekaPort;
  stored: StoredSnapshot;
  /** The approved recommendations, in the order the client will see them (publishItems). */
  items: PublishItem[];
  confirm?: (message: string) => boolean;
}) {
  const client = useQueryClient();
  const [email, setEmail] = useState(stored.clientEmail ?? "");
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailId = useId();
  const published = Boolean(stored.publishedAt);
  const itemsKey = ["admin", "masleka", "published-items", stored.id] as const;
  const answers = useQuery({ queryKey: itemsKey, queryFn: () => service.listPublishedItems(stored.id), enabled: published });
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["admin", "masleka", "snapshot", stored.id] }),
      client.invalidateQueries({ queryKey: itemsKey }),
    ]);

  const publish = useMutation({
    mutationFn: () => service.publish(stored.id, email.trim(), items),
    onMutate: () => setError(null),
    onSuccess: refresh,
    onError: (e) => setError(failureText(e)),
  });
  const unpublish = useMutation({
    mutationFn: () => service.unpublish(stored.id),
    onMutate: () => setError(null),
    onSuccess: refresh,
    onError: (e) => setError(failureText(e)),
  });
  const seen = useMutation({
    mutationFn: () => service.markAnswersSeen(stored.id),
    onSuccess: () => client.invalidateQueries({ queryKey: itemsKey }),
    onError: (e) => setError(failureText(e)),
  });

  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const answered = (answers.data ?? []).filter((i) => i.clientStatus !== "open");
  const unseen = answered.filter((i) => !i.staffSeenAt).length;

  const onPublish = () => {
    if (published && !confirm("פרסום מחדש מחליף את ההמלצות שהלקוח רואה, ותשובותיו עד עכשיו יימחקו. להמשיך?")) return;
    publish.mutate();
  };

  return (
    <section aria-labelledby="publish-title" className="space-y-4 rounded-[4px] border border-highlight p-5 print:hidden">
      <h2 id="publish-title" className="font-heading text-xl">האזור האישי של הלקוח</h2>
      {published ? (
        <p role="status" className="text-sm">
          פורסם ל־<bdi dir="ltr">{stored.clientEmail}</bdi> ב־
          {new Date(stored.publishedAt!).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short", timeStyle: "short" })}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">עוד לא פורסם. הלקוח יראה רק את ההמלצות המאושרות, ורק אחרי הפרסום.</p>
      )}

      <div>
        <label htmlFor={emailId} className="block text-sm text-muted-foreground">
          המייל שהלקוח מתחבר איתו לאתר
        </label>
        <input
          id={emailId}
          type="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full max-w-sm border border-border bg-background px-2 py-1.5 text-left"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setPreview((p) => !p)} disabled={items.length === 0} className={buttonClass}>
          <Eye size={16} aria-hidden="true" /> {preview ? "סגירת התצוגה" : "תצוגה כפי שהלקוח רואה"}
        </button>
        <button
          type="button"
          onClick={onPublish}
          disabled={!validEmail || items.length === 0 || publish.isPending}
          className={`${buttonClass} border-primary`}
        >
          {publish.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
          {published ? "פרסום מחדש" : "פרסום לאזור האישי"}
        </button>
        {published ? (
          <button type="button" onClick={() => unpublish.mutate()} disabled={unpublish.isPending} className={buttonClass}>
            הסרה מהאזור האישי
          </button>
        ) : null}
      </div>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">אין עדיין המלצות מאושרות לפרסום.</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className="rounded-[4px] border border-border p-4" aria-label="תצוגה כפי שהלקוח רואה" role="region">
          <SnapshotView
            preview
            data={{
              takenAt: stored.takenAt,
              publishedAt: stored.publishedAt ?? new Date().toISOString(),
              snapshot: stored.snapshot,
              items: items.map((i, n) => ({ ...i, id: `preview-${n}`, clientStatus: "open", clientNote: null })),
            }}
          />
        </div>
      ) : null}

      {published ? (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium">
              תשובות הלקוח{unseen > 0 ? <span className="ms-2 rounded-[4px] border border-highlight px-1.5 text-xs text-accent">{unseen} חדשות</span> : null}
            </h3>
            {unseen > 0 ? (
              <button type="button" onClick={() => seen.mutate()} disabled={seen.isPending} className={buttonClass}>
                סימון כנקרא
              </button>
            ) : null}
          </div>
          {answered.length === 0 ? (
            <p className="text-sm text-muted-foreground">הלקוח עוד לא ענה.</p>
          ) : (
            <ul className="mt-2 space-y-2 list-none p-0">
              {answered.map((i) => (
                <li key={i.id} className="rounded-[4px] border border-border p-3 text-sm">
                  <p className="font-medium">{i.title}</p>
                  <p className="text-accent">{ANSWER_LABEL[i.clientStatus]}</p>
                  {i.clientNote ? <p className="mt-1 whitespace-pre-line">{i.clientNote}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
