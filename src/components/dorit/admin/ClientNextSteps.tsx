import React, { useState } from "react";
import { Link } from "react-router-dom";
import { services } from "@/services";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import { MEETINGS_STAFF } from "@/config/meetings";

/**
 * After a client is added by hand, the steps that usually follow instead of a
 * toast: the personal-area invite (when there is an email), a clearinghouse
 * request (when it is on) and a first meeting (VITE_MEETINGS_STAFF; the lead's
 * drawer holds meetings). create-lead's `next` says which, so nothing guesses.
 */
const button = (muted = false) => ctaClass("min-h-11 px-4 text-base", { muted });

export default function ClientNextSteps({
  name,
  leadId,
  agencyId,
  next,
  notes = [],
  onClose,
  onOpenLead,
}: {
  name: string;
  leadId: string;
  agencyId: string;
  next: { invite: boolean; masleka: boolean };
  /** Lines to say first: a possible duplicate, a notice that did not go. */
  notes?: string[];
  onClose(): void;
  onOpenLead(leadId: string): void;
}) {
  const [invite, setInvite] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState("");

  const sendInvite = async () => {
    if (invite !== "idle") return;
    setInvite("busy");
    setError("");
    try {
      await services.leadsAdmin.inviteClient(agencyId, leadId);
      setInvite("sent");
    } catch (e) {
      setInvite("idle");
      setError(e instanceof Error ? e.message : "ההזמנה לא נשלחה. אפשר לנסות שוב.");
    }
  };

  return (
    <div className="flex flex-col gap-3" role="status">
      <p className="font-heading text-xl">✓ {name} נוספ/ה כלקוח/ה</p>
      {notes.map((n) => <p key={n}>{n}</p>)}
      {next.invite ? (
        invite === "sent" ? (
          <p>ההזמנה נשלחה</p>
        ) : (
          <button type="button" className={button()} disabled={invite === "busy"} onClick={() => void sendInvite()}>
            שליחת הזמנה לאזור האישי
          </button>
        )
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {next.masleka ? (
        <Link to={`/admin/masleka?lead=${leadId}`} className={button(true)} onClick={onClose}>בקשת מסלקה</Link>
      ) : null}
      {MEETINGS_STAFF ? (
        <button type="button" className={button(true)} onClick={() => onOpenLead(leadId)}>קביעת פגישה</button>
      ) : null}
      <button type="button" className="min-h-11 self-start text-base text-muted-foreground hover:text-foreground" onClick={onClose}>סגירה</button>
    </div>
  );
}
