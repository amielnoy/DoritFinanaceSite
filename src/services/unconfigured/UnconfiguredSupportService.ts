import type { EscalationReceipt, SupportPort } from "../ports";
import { FALLBACK_CONTACT } from "../fallback-contact";

/**
 * The hand-off for a build with no Supabase credentials. Like every support
 * adapter it never rejects — the visitor has just been told a person will
 * call — so it answers with the direct channels, which need no network.
 */
export class UnconfiguredSupportService implements SupportPort {
  async escalate(): Promise<EscalationReceipt> {
    return {
      ok: false,
      contact: FALLBACK_CONTACT,
      acknowledgement: "אפשר לפנות לדורית ישירות בטלפון או בוואטסאפ.",
      warnings: ["escalation_not_configured"],
    };
  }
}
