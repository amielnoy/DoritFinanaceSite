import type { ClaimReport, Lead, LeadPort, SubmissionReceipt } from "../ports";

/** The SDK surface this adapter needs — not the whole client. */
export interface FunctionInvoker {
  functions: { invoke(name: string, payload: unknown): Promise<unknown> };
}

/**
 * Adapter over the Base44 backend functions.
 *
 * Single Responsibility: translating an application Lead into the payload the
 * `submitLead` function destructures, and back. When that function's shape
 * changes, this file changes — and nothing else does.
 */
export class Base44LeadService implements LeadPort {
  constructor(private readonly client: FunctionInvoker) {}

  async submitLead(lead: Lead): Promise<SubmissionReceipt> {
    const receipt = (await this.client.functions.invoke("submitLead", {
      name: lead.name,
      phone: lead.phone,
      email: lead.email ?? "",
      source: lead.source,
      topic: lead.topic ?? "",
      timing: lead.timing ?? "",
      message: lead.message ?? "",
      notes: lead.notes ?? "",
      scheduledAt: lead.scheduledAt ?? "",
    })) as SubmissionReceipt | undefined;

    return receipt ?? { ok: true };
  }

  async submitClaim(report: ClaimReport): Promise<SubmissionReceipt> {
    const receipt = (await this.client.functions.invoke("submitClaim", {
      name: report.name,
      phone: report.phone,
      email: report.email ?? "",
      claimType: report.claimType ?? "",
      eventDate: report.eventDate ?? "",
      policyNumber: report.policyNumber ?? "",
      description: report.description ?? "",
      documents: report.documents ?? [],
    })) as SubmissionReceipt | undefined;

    return receipt ?? { ok: true };
  }

  /**
   * Calendar holds are decoration on top of a submission that has already
   * succeeded, so a failure is swallowed here rather than surfaced — this is
   * the one place where that is the right call.
   */
  async requestConsultationEvent(lead: Lead): Promise<void> {
    const payload = {
      name: lead.name,
      phone: lead.phone,
      email: lead.email ?? "",
      topic: lead.topic ?? "",
      timing: lead.timing ?? "",
      notes: lead.notes ?? "",
      scheduledAt: lead.scheduledAt ?? "",
    };
    await Promise.allSettled([
      this.client.functions.invoke("createConsultationEvent", payload),
      this.client.functions.invoke("createOutlookEvent", payload),
    ]);
  }
}