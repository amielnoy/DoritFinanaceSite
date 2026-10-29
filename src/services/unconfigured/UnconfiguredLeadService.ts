import type { LeadPort, SubmissionReceipt } from "../ports";

const NO_DATABASE = "אין חיבור למאגר.";

/**
 * Enquiries for a build with no Supabase credentials: there is nowhere to send
 * one, so each is refused, and the form shows its own failure text with the
 * direct channels. `updatesInterviews` is left unset: no follow-up questions.
 */
export class UnconfiguredLeadService implements LeadPort {
  async submitLead(): Promise<SubmissionReceipt> {
    throw new Error(NO_DATABASE);
  }

  async submitClaim(): Promise<SubmissionReceipt> {
    throw new Error(NO_DATABASE);
  }

  async submitInterview(): Promise<SubmissionReceipt> {
    throw new Error(NO_DATABASE);
  }
}
