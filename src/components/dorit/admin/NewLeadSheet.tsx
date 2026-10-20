import React, { useState } from "react";
import { services } from "@/services";
import type { LeadRecord } from "@/services";
import { toast } from "@/components/ui/use-toast";
import SideDrawer from "@/components/dorit/admin/SideDrawer";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { Field, inputClass } from "@/components/dorit/primitives/Field";
import { MEETINGS_STAFF } from "@/config/meetings";
import { MEETING_TOPICS } from "@/config/needs-wizard";
import {
  INTAKE_LABELS, NOTICE_LABELS, STAFF_INTAKE_NOTICE, STAFF_STATUS_LABELS,
  type Intake, type NoticeMethod,
} from "@/config/staff-leads";
import { isContactPhone } from "@/lib/phone";
import { MEETING_MODE_LABEL, type MeetingMode } from "@/lib/meetings";
import { israelInstant, israelToday } from "@/lib/wall-clock";

/**
 * "פנייה חדשה": a member enters a lead by hand, mostly from a phone right after
 * a call (docs/superpowers/specs/2026-10-20-staff-lead-design.md, Frontend).
 * Staff text goes to `notes`, which the client never sees. A visible duplicate
 * is shown from the list the page already loaded: the API returns only its id.
 * "קבענו כבר פגישה" shows only with VITE_MEETINGS_STAFF, where staff can see the meeting.
 */

type Status = keyof typeof STAFF_STATUS_LABELS;
type Done = { leadId: string; hidden: boolean; noticeFailed: boolean };

const INTAKES = Object.keys(INTAKE_LABELS) as Intake[];
const METHODS = Object.keys(NOTICE_LABELS) as NoticeMethod[];
const TOPICS = [...MEETING_TOPICS, "אחר"];
const button = (extra = "", muted = false) => ctaClass(`min-h-11 px-4 text-base ${extra}`, { muted });
const dateOf = (iso: string) => new Date(iso).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
/** The assignee select: "" is "אני" (create-lead assigns the caller), NO_ASSIGNEE is "ללא שיוך". */
const NO_ASSIGNEE = "none";

export default function NewLeadSheet({
  open, onClose, agencyId, canAssign, assignees, leads, onCreated, onSaved, onOpenExisting,
}: {
  open: boolean;
  onClose(): void;
  agencyId: string;
  canAssign: boolean;
  assignees: { id: string; label: string }[];
  /** The list the page already loaded, to show a visible duplicate. */
  leads?: LeadRecord[];
  onCreated(leadId: string): void;
  /** The lead exists but the sheet stays open on its confirmation: read the list again now, as closing it with ✕ will not. */
  onSaved?(leadId: string): void;
  onOpenExisting(leadId: string): void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("");
  const [intake, setIntake] = useState<Intake | null>(null);
  const [referrer, setReferrer] = useState("");
  const [status, setStatus] = useState<Status>("contacted");
  const [notes, setNotes] = useState("");
  const [assignee, setAssignee] = useState("");
  const [meeting, setMeeting] = useState(false);
  const [day, setDay] = useState(israelToday(new Date()));
  const [time, setTime] = useState("10:00");
  const [mode, setMode] = useState<MeetingMode>("office");
  const [place, setPlace] = useState("");
  const [informed, setInformed] = useState(false);
  const [method, setMethod] = useState<NoticeMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  const scheduledAt = israelInstant(day, time);
  const valid =
    name.trim() !== "" && isContactPhone(phone) && intake !== null && informed && method !== null &&
    !(method === "email" && email.trim() === "") && (!meeting || scheduledAt !== null);

  const submit = async (duplicateOk: boolean) => {
    if (!valid || !intake || !method || busy) return;
    setBusy(true);
    setError("");
    try {
      const created = await services.leadsAdmin.createLead({
        agencyId, name: name.trim(), phone: phone.trim(), email: email.trim() || undefined, topic: topic || undefined,
        notes: notes.trim() || undefined, intake, referrer: intake === "referral" ? referrer.trim() || undefined : undefined,
        status, notice: method, assignee: canAssign && assignee ? assignee : undefined, duplicateOk: duplicateOk || undefined,
      });
      if (created.duplicate === "visible") {
        setDuplicateId(created.leadId);
        return;
      }
      if (meeting && scheduledAt) {
        try {
          await services.leadsAdmin.addMeeting({
            leadId: created.leadId, agencyId, scheduledAt, durationMin: 45, mode, location: place.trim(), kind: "first", topic: topic || "",
          });
        } catch {
          toast({ description: "הפנייה נוצרה, אבל הפגישה לא נשמרה. ניתן להוסיף אותה מכרטיס הפנייה." });
        }
      }
      const hidden = created.duplicate === "hidden";
      const noticeFailed = created.noticeSent === false;
      if (hidden || noticeFailed) {
        onSaved?.(created.leadId);
        setDone({ leadId: created.leadId, hidden, noticeFailed });
      } else {
        toast({ description: "הפנייה נשמרה" });
        onCreated(created.leadId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "הפנייה לא נשמרה. ניתן לנסות שוב.");
    } finally {
      setBusy(false);
    }
  };

  const existing = duplicateId ? leads?.find((l) => l.id === duplicateId) : undefined;

  return (
    <SideDrawer open={open} onClose={onClose} title="פנייה חדשה" subtitle="פרטי הפונה, כפי שנמסרו בשיחה">
      {done ? (
        <div className="flex flex-col gap-3" role="status">
          <p className="font-heading text-xl">הפנייה נשמרה</p>
          {done.hidden ? <p>המספר כבר קיים בסוכנות — מנהל/ת יבדוק/תבדוק.</p> : null}
          {done.noticeFailed ? <p>הנוסח לא נשלח במייל — יש לשלוח אותו לפונה בדרך אחרת, בעל פה או בוואטסאפ.</p> : null}
          <button type="button" className={button()} onClick={() => onCreated(done.leadId)}>פתיחת הפנייה</button>
        </div>
      ) : duplicateId ? (
        <div className="flex flex-col gap-3">
          <p className="font-heading text-xl">הפונה כבר רשום/ה</p>
          {existing ? (
            <p>
              <strong>{existing.name}</strong> · {STAFF_STATUS_LABELS[existing.status as Status] ?? existing.status} · {dateOf(existing.created_date)}
            </p>
          ) : (
            <p>הפנייה כבר קיימת אצלך</p>
          )}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <button type="button" className={button()} onClick={() => onOpenExisting(duplicateId)}>פתיחת הפנייה הקיימת</button>
          <button type="button" disabled={busy} className={button("", true)} onClick={() => submit(true)}>פנייה חדשה לאותו אדם</button>
        </div>
      ) : (
        <form
          aria-label="פנייה חדשה"
          className="flex flex-col gap-4"
          onSubmit={(e) => { e.preventDefault(); submit(false); }}
        >
          <Field label="שם"><input type="text" required maxLength={80} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} className={inputClass()} /></Field>
          <Field label="טלפון"><input type="tel" required inputMode="tel" autoComplete="off" value={phone} aria-invalid={phone !== "" && !isContactPhone(phone)} onChange={(e) => setPhone(e.target.value)} className={inputClass()} /></Field>
          <Field label="אימייל"><input type="email" maxLength={200} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass()} /></Field>
          <Field label="נושא">
            <select value={topic} onChange={(e) => setTopic(e.target.value)} className={inputClass()}>
              <option value="">לא נבחר</option>
              {TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[15px] text-foreground/80">איך הגיע/ה</legend>
            <div className="flex flex-wrap gap-2">
              {INTAKES.map((i) => (
                <button key={i} type="button" aria-pressed={intake === i} onClick={() => setIntake(i)}
                  className={`min-h-11 rounded-md border px-3 text-base ${intake === i ? "border-highlight bg-highlight/15" : "border-input"}`}>
                  {INTAKE_LABELS[i]}
                </button>
              ))}
            </div>
            {intake === "referral" ? (
              <Field label="מי הפנה"><input type="text" maxLength={120} placeholder="למשל: רו״ח משה" value={referrer} onChange={(e) => setReferrer(e.target.value)} className={inputClass()} /></Field>
            ) : null}
          </fieldset>

          <Field label="מצב">
            <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={inputClass()}>
              {(Object.keys(STAFF_STATUS_LABELS) as Status[]).map((s) => <option key={s} value={s}>{STAFF_STATUS_LABELS[s]}</option>)}
            </select>
          </Field>
          <div>
            <Field label="הערות פנימיות"><textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass()} /></Field>
            <p className="mt-1 text-sm text-muted-foreground">לא מוצגות ללקוח</p>
          </div>
          {canAssign ? (
            <Field label="שיוך">
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inputClass()}>
                <option value="">אני</option>
                <option value={NO_ASSIGNEE}>ללא שיוך</option>
                {assignees.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </Field>
          ) : null}

          {MEETINGS_STAFF ? (
            <label className="flex min-h-11 items-center gap-3 text-base">
              <input type="checkbox" checked={meeting} onChange={(e) => setMeeting(e.target.checked)} className="h-5 w-5" />
              קבענו כבר פגישה
            </label>
          ) : null}
          {MEETINGS_STAFF && meeting ? (
            <div className="grid grid-cols-2 gap-3 rounded-[4px] border border-highlight p-4">
              <Field label="תאריך"><input type="date" required value={day} onChange={(e) => setDay(e.target.value)} className={inputClass()} /></Field>
              <Field label="שעה"><input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={inputClass()} /></Field>
              <Field label="אופן">
                <select value={mode} onChange={(e) => setMode(e.target.value as MeetingMode)} className={inputClass()}>
                  {(Object.keys(MEETING_MODE_LABEL) as MeetingMode[]).map((m) => <option key={m} value={m}>{MEETING_MODE_LABEL[m]}</option>)}
                </select>
              </Field>
              <Field label="מקום"><input type="text" maxLength={500} value={place} onChange={(e) => setPlace(e.target.value)} className={inputClass()} /></Field>
            </div>
          ) : null}

          <fieldset className="flex flex-col gap-3 rounded-[4px] border border-border p-4">
            <legend className="px-1 text-[15px] text-foreground/80">יידוע</legend>
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-base">נוסח היידוע</summary>
              <p className="whitespace-pre-line text-sm text-muted-foreground">{STAFF_INTAKE_NOTICE}</p>
            </details>
            <label className="flex items-start gap-3 text-base">
              <input type="checkbox" required checked={informed} onChange={(e) => setInformed(e.target.checked)} className="mt-1 h-5 w-5" />
              יידעתי את הפונה איך ישמשו הפרטים שלו/ה
            </label>
            <div role="radiogroup" aria-label="איך יודע/ה" className="flex flex-wrap gap-4">
              {METHODS.map((m) => (
                <label key={m} className="flex min-h-11 items-center gap-2 text-base">
                  <input type="radio" name="notice-method" checked={method === m} disabled={m === "email" && email.trim() === ""} onChange={() => setMethod(m)} className="h-5 w-5" />
                  {NOTICE_LABELS[m]}
                </label>
              ))}
            </div>
            {method === "whatsapp" ? (
              <div className="flex flex-col gap-2">
                <p className="whitespace-pre-line rounded-md bg-muted/40 p-3 text-sm">{STAFF_INTAKE_NOTICE}</p>
                <button type="button" className={button("self-start", true)} onClick={() => void navigator.clipboard.writeText(STAFF_INTAKE_NOTICE)}>העתקת הנוסח</button>
              </div>
            ) : null}
          </fieldset>

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <button type="submit" disabled={!valid || busy} className={button()}>שמירה</button>
        </form>
      )}
    </SideDrawer>
  );
}
