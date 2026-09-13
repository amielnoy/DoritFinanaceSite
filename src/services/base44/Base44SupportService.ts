import type {
  EscalationReceipt,
  EscalationRequest,
  HumanContact,
  SupportPort,
} from "../ports";

/** The SDK surface this adapter needs — not the whole client. */
export interface FunctionInvoker {
  functions: { invoke(name: string, payload: unknown): Promise<unknown> };
}

/**
 * The contact details the visitor falls back to when the backend cannot be
 * reached at all. Duplicating them here is deliberate: a visitor who asked for
 * a person must never be left without one because a network call failed.
 */
export const FALLBACK_CONTACT: HumanContact = {
  phoneDisplay: "050-831-1776",
  phoneE164: "+972508311776",
  whatsapp: "972508311776",
  email: "dorit@govari-fin.co.il",
};

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
      const receipt = (await this.client.functions.invoke("escalateToHuman", {
        reason: request.reason,
        summary: request.summary,
        agent: request.agent ?? "",
        name: request.name ?? "",
        phone: request.phone ?? "",
        email: request.email ?? "",
        topic: "",
        consentVersion: request.consentVersion ?? "",
        consentAt: request.consentAt ?? "",
      })) as EscalationReceipt | undefined;

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
