import type { EscalationReceipt, EscalationRequest, SupportPort } from "../ports";
import { escalationBody } from "../lead-bodies";
import type { SupabaseFunctionsClient } from "./SupabaseLeadService";
import { FALLBACK_CONTACT } from "../base44/Base44SupportService";

/**
 * The hand-off, on the `escalate-to-human` Edge Function. Like the Base44
 * adapter it never rejects: the visitor has just been told a person will call.
 */
export class SupabaseSupportService implements SupportPort {
  constructor(private readonly client: SupabaseFunctionsClient) {}

  async escalate(request: EscalationRequest): Promise<EscalationReceipt> {
    const failed = (warning: string): EscalationReceipt => ({
      ok: false,
      contact: FALLBACK_CONTACT,
      acknowledgement: "אפשר לפנות לדורית ישירות בטלפון או בוואטסאפ.",
      warnings: [warning],
    });
    try {
      const { data, error } = await this.client.functions.invoke("escalate-to-human", { body: escalationBody(request) });
      if (error) return failed("escalation_call_failed");
      const receipt = data as EscalationReceipt | null;
      return receipt?.contact ? receipt : failed("no_contact_in_receipt");
    } catch {
      return failed("escalation_call_failed");
    }
  }
}
