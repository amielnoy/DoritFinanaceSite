import type { EscalationReceipt, EscalationRequest, SupportPort } from "../ports";
import { escalationBody } from "../lead-bodies";
import { FALLBACK_CONTACT } from "../fallback-contact";
import { invokeFunction, type FunctionInvoker } from "./invoke";

export type { FunctionInvoker };

/**
 * Adapter over the `escalateToHuman` backend function.
 *
 * Unlike every other call in the app this one cannot be allowed to reject: the
 * caller is a visitor who has just been told they will be put through to a
 * person. A failure is downgraded to a receipt carrying the direct channels.
 */
export class Base44SupportService implements SupportPort {
  constructor(private readonly client: FunctionInvoker) {}

  async escalate(request: EscalationRequest): Promise<EscalationReceipt> {
    try {
      const receipt = await invokeFunction<EscalationReceipt>(this.client, "escalateToHuman", escalationBody(request));

      if (!receipt?.contact) {
        return {
          ok: false,
          contact: FALLBACK_CONTACT,
          acknowledgement: "אפשר לפנות לדורית ישירות בטלפון או בוואטסאפ.",
          warnings: ["no_contact_in_receipt"],
        };
      }
      return receipt;
    } catch {
      return {
        ok: false,
        contact: FALLBACK_CONTACT,
        acknowledgement: "אפשר לפנות לדורית ישירות בטלפון או בוואטסאפ.",
        warnings: ["escalation_call_failed"],
      };
    }
  }
}
