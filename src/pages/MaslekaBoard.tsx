import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Eyebrow from "@/components/dorit/primitives/Eyebrow";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { CLEARINGHOUSE_ADVISOR_URL } from "@/config/masleka";
import {
  BOARD_KEY,
  BOARD_VIEWS,
  STAGE_LABEL,
  boardTime,
  copyOrFallback,
  failureText,
  nowRows,
  planRows,
  staffMessage,
  stageRows,
  viewFromParam,
  type BoardView,
  type ClipboardLike,
  type Message,
  type PlannedRow,
} from "@/lib/masleka";
import {
  MaslekaError,
  services,
  type MaslekaField,
  type MaslekaLink,
  type MaslekaPort,
  type MaslekaRequest,
} from "@/services";

/**
 * /admin/masleka — the staff's one screen for clearinghouse requests,
 * worked left to right: waiting to be submitted, submitted and waiting for
 * the download, completed (PR B fills that column).
 *
 * Nothing secret is on the page until a copy button is pressed. The value is
 * fetched then — masleka-reveal writes the access log, server-side, before it
 * decrypts; this page never writes it — copied, and held only in this
 * component's state: never in the query cache (the reveal is a plain call, not
 * a query or a mutation), storage, the console, analytics or the address.
 * Where the clipboard is unavailable or refused, the value is shown selected
 * in a read-only field with "העתק ידנית", and it goes on the next click
 * outside that field, on "הסתר", after REVEAL_MS, when another value is
 * asked for, when its row leaves the column, and with the page.
 */
export interface MaslekaBoardProps {
  service?: MaslekaPort;
  now?: () => Date;
  clipboard?: ClipboardLike | null;
  confirm?: (message: string) => boolean;
}

export { BOARD_KEY };
export const SNAPSHOTS_KEY = ["admin", "masleka", "snapshots"] as const;

/** How long a revealed value stays on the screen. */
export const REVEAL_MS = 60_000;

const defaultClipboard = (): ClipboardLike | null =>
  typeof navigator !== "undefined" && navigator.clipboard ? navigator.clipboard : null;

const when = boardTime;

/** Every control on the board is at least 44px tall. */
const buttonClass =
  "inline-flex min-h-11 items-center justify-center gap-1 border border-border/60 px-3 py-1.5 text-sm hover:border-accent disabled:opacity-60";
const primaryClass =
  "inline-flex min-h-11 items-center justify-center gap-1 bg-primary px-4 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-60";

/** What the board is showing for one row's field after a copy button. */
type Shown =
  | { requestId: string; field: MaslekaField; kind: "copied" }
  | { requestId: string; field: MaslekaField; kind: "manual"; value: string };

const fieldLabel = (field: MaslekaField, name: string) =>
  field === "id" ? `מספר הזהות של ${name}` : `הקוד של ${name}`;

function ManualCopy({
  value,
  label,
  inputRef,
  onClose,
}: {
  value: string;
  label: string;
  inputRef: React.RefObject<HTMLInputElement>;
  onClose: () => void;
}) {
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [value, inputRef]);
  return (
    <div className="mt-2 w-full">
      <input
        ref={inputRef}
        readOnly
        value={value}
        aria-label={label}
        dir="ltr"
        autoComplete="off"
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => e.currentTarget.select()}
        className="w-full border border-border bg-background px-2 py-1 font-mono text-sm"
      />
      <p className="mt-1 text-xs text-muted-foreground">העתק ידנית: הערך מסומן — Ctrl+C או ⌘C. הוא יוסתר בלחיצה הבאה.</p>
      <button type="button" onClick={onClose} className="mt-1 text-xs underline">
        הסתר
      </button>
    </div>
  );
}

function LinkPanel({
  link,
  clipboard,
  mailRequested = false,
}: {
  link: MaslekaLink;
  clipboard: ClipboardLike | null;
  /** The invitation was asked for: if it did not go, say so rather than stay quiet. */
  mailRequested?: boolean;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "manual">("idle");
  return (
    <div className="mt-3 border border-border/60 bg-background p-3">
      <p className="text-sm">
        {link.invited
          ? "הקישור נשלח במייל ללקוח. אפשר גם להעתיק אותו:"
          : mailRequested
            ? "המייל ללקוח לא נשלח. העבירו לו את הקישור בעצמכם — הוא מוצג פעם אחת בלבד:"
            : "הקישור מוצג פעם אחת בלבד — העתיקו ושלחו ללקוח:"}
      </p>
      <input
        readOnly
        value={link.link}
        dir="ltr"
        aria-label="הקישור ללקוח"
        onFocus={(e) => e.currentTarget.select()}
        className="mt-2 w-full border border-border bg-background px-2 py-1 font-mono text-xs"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={async () => setCopied(await copyOrFallback(link.link, clipboard))} className={buttonClass}>
          {copied === "copied" ? "הועתק ✓" : "העתק קישור"}
        </button>
        {/* The client's page, as the client will see it. A new tab and no
            referrer: the board's address stays out of the page's requests. */}
        <a href={link.link} target="_blank" rel="noopener noreferrer" className={buttonClass}>
          פתיחת הקישור
        </a>
      </div>
      {copied === "manual" ? (
        <p className="mt-1 text-xs text-muted-foreground">העתק ידנית: סמנו את הקישור והעתיקו (Ctrl+C או ⌘C).</p>
      ) : null}
    </div>
  );
}

function NewRequest({
  service,
  clipboard,
  onStart,
  onCreated,
  onFailure,
}: {
  service: MaslekaPort;
  clipboard: ClipboardLike | null;
  onStart: () => void;
  onCreated: () => Promise<unknown>;
  onFailure: (e: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sendInvite, setSendInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ link: MaslekaLink; mailRequested: boolean } | null>(null);
  const headingId = useId();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const clientName = name.trim();
    const contactEmail = email.trim();
    onStart();
    if (!clientName) {
      onFailure(new MaslekaError("invalid_name"));
      return;
    }
    const mailRequested = sendInvite && Boolean(contactEmail);
    setBusy(true);
    try {
      const link = await service.create({
        clientName,
        contactEmail: contactEmail || undefined,
        sendInvite: mailRequested,
      });
      setResult({ link, mailRequested });
      setName("");
      setEmail("");
      await onCreated();
    } catch (e) {
      onFailure(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={headingId} className="border border-border/60 bg-card p-4">
      <h2 id={headingId} className="font-heading text-lg">
        בקשה חדשה ביד
      </h2>
      <p className="text-sm text-muted-foreground">ללקוח שפנה בטלפון. הקישור יוצג כאן פעם אחת.</p>
      <form onSubmit={submit} aria-label="בקשה חדשה" className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
        <div>
          <label htmlFor="masleka-new-name" className="block text-sm">
            שם הלקוח
          </label>
          <input
            id="masleka-new-name"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full border border-border bg-background px-2 py-1"
          />
        </div>
        <div>
          <label htmlFor="masleka-new-email" className="block text-sm">
            מייל (לא חובה)
          </label>
          <input
            id="masleka-new-email"
            type="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full border border-border bg-background px-2 py-1"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
          לשלוח ללקוח את הקישור במייל
        </label>
        <button type="submit" disabled={busy} className={buttonClass}>
          צור בקשה
        </button>
      </form>
      {result ? <LinkPanel link={result.link} mailRequested={result.mailRequested} clipboard={clipboard} /> : null}
    </section>
  );
}

/** The step dot: the request's place in the four steps. */
function StepDot({ step }: { step: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-highlight font-heading text-sm text-accent"
    >
      {step}
    </span>
  );
}

/**
 * One request: who, where it stands, why, and the one thing to do. `children`
 * is what opens under it (a fresh link, the copy controls).
 */
function BoardRow({
  row,
  action,
  children,
}: {
  row: PlannedRow;
  action: React.ReactNode;
  children?: React.ReactNode;
}) {
  const { request, plan } = row;
  return (
    <li className="border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <StepDot step={plan.step} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{request.clientName}</span>
            <span className="text-xs text-muted-foreground">{STAGE_LABEL[plan.stage]}</span>
            {plan.urgent ? (
              <span className="border border-destructive/60 px-1.5 text-xs text-destructive">דחוף</span>
            ) : null}
          </p>
          <p className={plan.urgent ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{plan.reason}</p>
        </div>
        <div className="ms-auto">{action}</div>
      </div>
      {children}
    </li>
  );
}

/**
 * The one revealed value on the board, if any: at most one at a time, and
 * only the answer to the latest ask is ever used — a slower answer to an
 * earlier click, or one that lands after the page is gone, after `hide()` or
 * after its row has left the column, is dropped before it reaches the
 * clipboard or the screen.
 */
function useReveal(
  service: MaslekaPort,
  clipboard: ClipboardLike | null,
  onStart: () => void,
  onFailure: (e: unknown) => void,
) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState<{ requestId: string; field: MaslekaField } | null>(null);
  const latest = useRef(0);
  const fieldRef = useRef<HTMLInputElement>(null);
  // The row the board is busy with or showing, for hideFor() called from a callback.
  const activeId = shown?.requestId ?? busy?.requestId ?? null;
  const activeRef = useRef<string | null>(activeId);
  activeRef.current = activeId;

  useEffect(
    () => () => {
      // Gone with the page: any answer still on its way is dropped.
      latest.current += 1;
    },
    [],
  );

  // Off the screen after REVEAL_MS.
  useEffect(() => {
    if (!shown) return undefined;
    const timer = window.setTimeout(() => setShown(null), REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [shown]);

  // A value to copy by hand goes on the next click anywhere but its own field.
  useEffect(() => {
    if (shown?.kind !== "manual") return undefined;
    const onClick = (event: MouseEvent) => {
      if (fieldRef.current && event.target === fieldRef.current) return;
      setShown(null);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [shown]);

  const reveal = async (request: MaslekaRequest, field: MaslekaField) => {
    const ask = ++latest.current;
    onStart();
    setShown(null);
    setBusy({ requestId: request.id, field });
    try {
      const value = await service.reveal(request.id, field);
      if (ask !== latest.current) return;
      const how = await copyOrFallback(value, clipboard);
      if (ask !== latest.current) return;
      setShown(how === "copied" ? { requestId: request.id, field, kind: "copied" } : { requestId: request.id, field, kind: "manual", value });
    } catch (e) {
      if (ask === latest.current) onFailure(e);
    } finally {
      if (ask === latest.current) setBusy(null);
    }
  };

  /** Off the screen, and any answer still on its way dropped. */
  const hide = useCallback(() => {
    latest.current += 1;
    setShown(null);
    setBusy(null);
  }, []);
  /** hide(), when the board is busy with or showing this row. */
  const hideFor = useCallback(
    (requestId: string) => {
      if (activeRef.current === requestId) hide();
    },
    [hide],
  );
  return { shown, busy, activeId, fieldRef, reveal, hide, hideFor };
}

export default function MaslekaBoard({
  service = services.masleka,
  now = () => new Date(),
  clipboard = defaultClipboard(),
  confirm = (message) => window.confirm(message),
}: MaslekaBoardProps) {
  const client = useQueryClient();
  const requests = useQuery({ queryKey: BOARD_KEY, queryFn: () => service.list(), refetchInterval: 60_000 });
  const snapshots = useQuery({ queryKey: SNAPSHOTS_KEY, queryFn: () => service.listSnapshots() });
  const analysisOf = new Map((snapshots.data ?? []).flatMap((s) => (s.requestId ? [[s.requestId, s.id] as const] : [])));
  const [notice, setNotice] = useState<Message | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: BOARD_KEY });
  const report = (e: unknown) => setNotice({ tone: staffMessage(e).tone, text: failureText(e) });
  // Each action starts with a clean slate, so an old failure never sits beside a later success.
  const clearNotice = () => setNotice(null);
  const { shown, busy, activeId, fieldRef, reveal, hide, hideFor } = useReveal(service, clipboard, clearNotice, report);
  const submitting = useRef(false);
  const submitted = useMutation({
    mutationFn: (id: string) => service.markSubmitted(id),
    onSuccess: (_done, id) => {
      // Wiped server-side: off the screen now, not after the refetch (which may fail).
      hideFor(id);
      return refresh();
    },
    onError: (e) => {
      report(e);
      // A second הגשתי (Ruling 18) is a state: the row is already submitted, so show it there.
      if (staffMessage(e).tone === "state") return refresh();
      return undefined;
    },
  });

  const at = now();
  const planned = planRows(requests.data ?? [], at, analysisOf);
  const [search, setSearch] = useState("");
  const needle = search.trim().toLocaleLowerCase("he");
  const matches = (r: PlannedRow) => !needle || r.request.clientName.toLocaleLowerCase("he").includes(needle);
  // The stage on show, kept in the address (?stage=) so a refresh keeps it; "now" is the default and is left out.
  const [params, setParams] = useSearchParams();
  const view = viewFromParam(params.get("stage"));
  const rowsOf = (v: BoardView) => (v === "now" ? nowRows(planned) : stageRows(planned, v));
  const shownRows = rowsOf(view).filter(matches);
  const choose = (v: BoardView) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (v === "now") next.delete("stage");
        else next.set("stage", v);
        return next;
      },
      { replace: true },
    );
  // Another stage on screen: nothing revealed stays behind from the last one.
  useEffect(() => {
    hide();
  }, [view, hide]);
  // The rows whose copy controls are open ("להגשה").
  const [openSubmit, setOpenSubmit] = useState<ReadonlySet<string>>(new Set());
  const toggleSubmit = (id: string) =>
    setOpenSubmit((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  // A fresh link per invited row, shown once under it.
  const [links, setLinks] = useState<Record<string, MaslekaLink>>({});
  const [relinking, setRelinking] = useState<string | null>(null);

  // A value whose row has left "מוכן להגשה" (submitted, expired) goes with it,
  // and so does an answer for that row still on its way.
  const activeRowWaiting =
    activeId === null || (requests.data ?? []).some((r) => r.id === activeId && r.status === "code_received");
  useEffect(() => {
    if (!activeRowWaiting) hide();
  }, [activeRowWaiting, hide]);

  const relink = async (request: MaslekaRequest) => {
    clearNotice();
    setRelinking(request.id);
    try {
      const link = await service.relink(request.id);
      setLinks((l) => ({ ...l, [request.id]: link }));
    } catch (e) {
      report(e);
    } finally {
      setRelinking(null);
    }
  };

  const onSubmitted = (request: MaslekaRequest) => {
    // One call per הגשתי: a double click lands before the button is disabled.
    if (submitting.current) return;
    if (!confirm(`להגיש עבור ${request.clientName}? הקוד ומספר הזהות יימחקו מהמערכת.`)) return;
    submitting.current = true;
    clearNotice();
    submitted.mutate(request.id, {
      onSettled: () => {
        submitting.current = false;
      },
    });
  };

  const revealButton = (request: MaslekaRequest, field: MaslekaField) => {
    const isBusy = busy?.requestId === request.id && busy.field === field;
    const isCopied = shown?.kind === "copied" && shown.requestId === request.id && shown.field === field;
    return (
      <button type="button" onClick={() => void reveal(request, field)} disabled={isBusy} className={buttonClass}>
        {isBusy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
        {isCopied ? "הועתק ✓" : field === "id" ? "העתק ת״ז" : "העתק קוד"}
      </button>
    );
  };

  return (
    <div dir="rtl" className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <Eyebrow>טיפול שוטף</Eyebrow>
            <h1 className="font-heading text-2xl md:text-3xl mt-1">מסלקה</h1>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Link to="/admin/masleka/guide" className="underline">
              מדריך: הרשמה כיועץ במסלקה
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 sm:px-6 py-8 space-y-6">
        {notice ? (
          <p
            role={notice.tone === "state" ? "status" : "alert"}
            className={
              notice.tone === "state"
                ? "border border-border/60 bg-card p-3 text-sm"
                : "border border-destructive/40 bg-destructive/5 p-3 text-sm"
            }
          >
            {notice.text}
          </p>
        ) : null}

        <NewRequest service={service} clipboard={clipboard} onStart={clearNotice} onCreated={refresh} onFailure={report} />

        {requests.isError ? (
          <div role="alert" className="text-sm">
            <p>לא הצלחנו לטעון את הבקשות. רעננו את הדף.</p>
            <p className="text-muted-foreground">{failureText(requests.error)}</p>
          </div>
        ) : null}
        {requests.isPending ? <Loader2 className="animate-spin" aria-label="טוען" /> : null}

        <nav aria-label="שלבי הבקשה">
          <ul className="flex flex-wrap gap-2">
            {BOARD_VIEWS.map((v) => (
              <li key={v.view}>
                <button
                  type="button"
                  aria-pressed={view === v.view}
                  onClick={() => choose(v.view)}
                  className={`flex min-h-11 flex-col items-start border px-3 py-2 text-start ${
                    view === v.view ? "border-highlight bg-card" : "border-border/60 hover:border-accent"
                  }`}
                >
                  <span className="flex items-baseline gap-2 text-sm font-medium">
                    {v.label}
                    <span className="font-heading text-accent">{requests.isSuccess ? rowsOf(v.view).length : "–"}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{v.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <label htmlFor="masleka-search" className="sr-only">
            חיפוש לקוח
          </label>
          <input
            id="masleka-search"
            type="search"
            placeholder="חיפוש לקוח"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-h-11 w-full max-w-sm border border-border bg-background px-3 py-2 text-sm"
          />
        </div>

        {requests.isSuccess && shownRows.length === 0 ? (
          <p className="border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
            אין כאן כלום כרגע. בקשות חדשות יופיעו כאן לבד.
          </p>
        ) : (
          <ul aria-label="בקשות" className="space-y-3">
            {shownRows.map((row) => {
              const r = row.request;
              const a = row.plan.action;
              const action =
                a.kind === "submit" ? (
                  <button
                    type="button"
                    aria-expanded={openSubmit.has(r.id)}
                    onClick={() => toggleSubmit(r.id)}
                    className={primaryClass}
                  >
                    {a.label}
                  </button>
                ) : a.kind === "download" ? (
                  // A new tab and no referrer: the board's address stays out of the portal's requests.
                  <a href={CLEARINGHOUSE_ADVISOR_URL} target="_blank" rel="noopener noreferrer" className={primaryClass}>
                    {a.label}
                  </a>
                ) : a.kind === "relink" ? (
                  <button type="button" onClick={() => void relink(r)} disabled={relinking === r.id} className={buttonClass}>
                    {a.label}
                  </button>
                ) : a.kind === "analysis" ? (
                  <Link to={`/admin/masleka/analysis/${a.snapshotId}`} className={buttonClass}>
                    {a.label}
                  </Link>
                ) : (
                  <span className="text-sm text-muted-foreground">{a.label}</span>
                );
              return (
                <BoardRow key={r.id} row={row} action={action}>
                  {a.kind === "submit" && openSubmit.has(r.id) ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {revealButton(r, "id")}
                      {revealButton(r, "code")}
                      <a href={CLEARINGHOUSE_ADVISOR_URL} target="_blank" rel="noopener noreferrer" className={buttonClass}>
                        פתח את המסלקה
                      </a>
                      <button
                        type="button"
                        onClick={() => onSubmitted(r)}
                        disabled={submitted.isPending}
                        className={`${buttonClass} border-primary`}
                      >
                        הגשתי
                      </button>
                    </div>
                  ) : null}
                  {a.kind === "submit" && shown?.kind === "manual" && shown.requestId === r.id ? (
                    <ManualCopy value={shown.value} label={fieldLabel(shown.field, r.clientName)} inputRef={fieldRef} onClose={hide} />
                  ) : null}
                  {a.kind === "relink" && links[r.id] ? <LinkPanel link={links[r.id]} clipboard={clipboard} /> : null}
                </BoardRow>
              );
            })}
          </ul>
        )}

        {/* Every stored report, newest first — also those made by hand or whose
            request has gone. Quiet when there are none or they cannot be read:
            the board's own work does not depend on them. */}
        {snapshots.isError ? (
          <p className="text-xs text-muted-foreground">לא הצלחנו לטעון את הניתוחים.</p>
        ) : snapshots.data && snapshots.data.length > 0 ? (
          <section aria-labelledby="analyses-title">
            <h2 id="analyses-title" className="font-heading text-xl">ניתוחים</h2>
            <ul className="mt-3 space-y-2">
              {snapshots.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-baseline gap-3 text-sm">
                  <Link to={`/admin/masleka/analysis/${s.id}`} className="underline">
                    {s.clientName}
                  </Link>
                  <span className="text-xs text-muted-foreground">דוח מ־{when(s.takenAt)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
