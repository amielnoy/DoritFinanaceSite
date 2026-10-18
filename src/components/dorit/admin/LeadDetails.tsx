import React, { useState } from "react";
import { CalendarClock, ChevronDown } from "lucide-react";
import { services, type LeadRecord } from "@/services";

/** A claim document stored in Supabase, as `submit-claim` writes it into the message. */
const DOCUMENT_REF = /(storage:claim-documents\/[^\s|]+)/;

/**
 * "12:00–15:00" inside Hebrew text: the bidi algorithm lays the two times out
 * right to left, so it read "15:00–12:00". Each range is isolated as LTR.
 */
const TIME_RANGE = /(\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2})/;

function Times({ text }: { text: string }) {
  const parts = text.split(TIME_RANGE);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <bdi key={i} dir="ltr">{part}</bdi>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

/** How many answers show before "עוד", in the table. The drawer shows them all. */
const VISIBLE_ROWS = 3;

/** Answers that say how soon to call, shown as a badge rather than a row. */
const URGENCY_LABEL = "דחיפות";

export interface ParsedDetails {
  topic: string;
  timing: string;
  urgency: string;
  /** "label: value" lines, in the order the backend wrote them. */
  rows: { label: string; value: string }[];
  /** Whatever was not a "label: value" line: a quick-form message, an agent's handoff note. */
  prose: string;
}

/**
 * Splits a lead into what the details cell shows.
 *
 * An interview's message is the profile, one "label: value" per line
 * (submit-lead/handler.ts, `profileText`). The table used to print it as one
 * paragraph, so the newlines collapsed and the labels ran into each other's
 * values. A line is a row only when its label is short. Prose that happens to
 * contain a colon ("ביקש: לדבר עם דורית, כי...") stays prose.
 */
export function parseLeadDetails(lead: Pick<LeadRecord, "topic" | "timing" | "message">): ParsedDetails {
  const rows: ParsedDetails["rows"] = [];
  const prose: string[] = [];
  let urgency = "";
  for (const raw of (lead.message ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf(": ");
    const label = at > 0 ? line.slice(0, at).trim() : "";
    if (label && label.length <= 40 && !DOCUMENT_REF.test(label)) {
      const value = line.slice(at + 2).trim();
      if (label === URGENCY_LABEL) urgency = value;
      else rows.push({ label, value });
    } else {
      prose.push(line);
    }
  }
  return {
    topic: (lead.topic ?? "").trim(),
    timing: (lead.timing ?? "").trim(),
    urgency,
    rows,
    prose: prose.join("\n"),
  };
}

/**
 * Opens one claim document. The link is signed on the click, for five minutes,
 * so nothing long-lived sits in the page or in a copied URL.
 *
 * The tab is opened before the await: Safari blocks a window opened after one,
 * and the signing is a round trip.
 */
function DocumentLink({ docRef, index, leadId }: { docRef: string; index: number; leadId: string }) {
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setError(null);
    const tab = window.open("about:blank", "_blank");
    try {
      const url = await services.leadsAdmin.documentLink(docRef, leadId);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        setError("הדפדפן חסם את החלון — אפשר לאשר חלונות קופצים ולנסות שוב");
      }
    } catch (e) {
      tab?.close();
      setError(e instanceof Error ? e.message : "לא ניתן לפתוח את המסמך");
    }
  };
  return (
    <span>
      <button type="button" onClick={open} className="underline text-accent hover:text-foreground">
        מסמך {index}
      </button>
      {error && <span className="block text-xs text-destructive">{error}</span>}
    </span>
  );
}

/** Visitor-typed text, with any stored claim document as a button. Plain text only. */
function WithDocuments({ text, leadId, start }: { text: string; leadId: string; start: { n: number } }) {
  const parts = text.split(DOCUMENT_REF);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <DocumentLink key={i} docRef={part} index={++start.n} leadId={leadId} />
        ) : (
          <Times key={i} text={part} />
        ),
      )}
    </>
  );
}

/**
 * The details of a lead as a narrow card that reads top to bottom: the topic,
 * then when to call, then the answers, one label above its value.
 *
 * In the table (`compact`) it stops after three answers, and long prose after
 * three lines, with "עוד" to unfold the rest in place. The drawer passes
 * `compact={false}` and gets everything.
 */
export default function LeadDetails({ lead, compact = true }: { lead: LeadRecord; compact?: boolean }) {
  const [expanded, setExpanded] = useState(!compact);
  const d = parseLeadDetails(lead);
  if (!d.topic && !d.timing && !d.urgency && !d.rows.length && !d.prose) return <>—</>;

  const docs = { n: 0 };
  const rows = expanded ? d.rows : d.rows.slice(0, VISIBLE_ROWS);
  const hidden = d.rows.length - rows.length;
  const longProse = d.prose.length > 140 || d.prose.includes("\n");
  const foldable = compact && (d.rows.length > VISIBLE_ROWS || longProse);

  return (
    <div className="w-60 max-w-full space-y-2 text-[13px] leading-snug">
      {d.topic || d.urgency ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {d.topic ? <span className="font-medium text-foreground">{d.topic}</span> : null}
          {d.urgency ? (
            <span className="inline-block bg-highlight/15 px-1.5 py-0.5 text-[11px] text-highlight-ink">{d.urgency}</span>
          ) : null}
        </div>
      ) : null}

      {d.timing ? (
        <p className="flex items-start gap-1.5 text-foreground/80">
          <CalendarClock size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <span>
            <Times text={d.timing} />
          </span>
        </p>
      ) : null}

      {rows.length ? (
        <dl className="space-y-1.5 border-r-2 border-border/70 pr-2.5">
          {rows.map((r, i) => (
            <div key={i}>
              <dt className="text-[11px] text-muted-foreground">{r.label}</dt>
              <dd className="text-foreground/90">
                <WithDocuments text={r.value} leadId={lead.id} start={docs} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {d.prose ? (
        <p className={`whitespace-pre-line text-foreground/80 ${compact && !expanded && longProse ? "line-clamp-3" : ""}`}>
          <WithDocuments text={d.prose} leadId={lead.id} start={docs} />
        </p>
      ) : null}

      {foldable ? (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          {expanded ? "פחות" : hidden > 0 ? `עוד ${hidden} פרטים` : "עוד"}
          <ChevronDown size={13} className={`transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
