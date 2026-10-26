import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { services } from "@/services";
import type { LeadRecord } from "@/services";
import { adminKeys } from "@/hooks/useAdmin";
import { ctaClass } from "@/components/dorit/primitives/Cta";
import ClientFields, { israelMonth } from "@/components/dorit/admin/ClientFields";
import type { Product } from "@/lib/staff-lead-types";

/**
 * "לקוח/ה מאז" and "תחומים" in the drawer of any client row (VITE_STAFF_CLIENTS):
 * empty for older clients until someone fills them. Saved through
 * convert_lead_to_client, under the person's own update rights — the same
 * check of the month and the list as when the client was added.
 */
export default function LeadClientFields({ lead, now }: { lead: LeadRecord; now?: Date }) {
  const client = useQueryClient();
  const [since, setSince] = useState(lead.clientSince ?? israelMonth(now ?? new Date()));
  const [products, setProducts] = useState<Product[]>(lead.products ?? []);
  const [state, setState] = useState<"idle" | "busy" | "saved">("idle");
  const [error, setError] = useState("");
  const changed = since !== (lead.clientSince ?? "") || products.join() !== (lead.products ?? []).join();

  const save = async () => {
    if (!changed || products.length === 0 || state === "busy") return;
    setState("busy");
    setError("");
    try {
      await services.leadsAdmin.convertToClient(lead.id, since, products);
      setState("saved");
      void client.invalidateQueries({ queryKey: adminKeys.leads });
    } catch (e) {
      setState("idle");
      setError(e instanceof Error ? e.message : "הפרטים לא נשמרו. ניתן לנסות שוב.");
    }
  };

  return (
    <section aria-label="פרטי הלקוח/ה" className="mt-6 flex flex-col gap-4 border-t border-border pt-4">
      <ClientFields
        since={since}
        products={products}
        now={now}
        onChange={(v) => {
          setSince(v.since);
          setProducts(v.products);
          setState("idle");
        }}
      />
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center gap-3">
        <button type="button" disabled={!changed || products.length === 0 || state !== "idle"} onClick={() => void save()}
          className={ctaClass("min-h-11 px-4 text-base")}>
          שמירת פרטי הלקוח/ה
        </button>
        {state === "saved" ? <span role="status">נשמר</span> : null}
      </div>
    </section>
  );
}
