import type {
  ClaimReport,
  InterviewSummary,
  Lead,
  LeadPort,
  SubmissionReceipt,
} from "../ports";

import { invokeFunction, type FunctionInvoker } from "./invoke";

export type { FunctionInvoker };

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
    const receipt = await invokeFunction<SubmissionReceipt>(this.client, "submitLead", {
      name: lead.name,
      phone: lead.phone,
      email: lead.email ?? "",
      source: lead.source,
      topic: lead.topic ?? "",
      timing: lead.timing ?? "",
      message: lead.message ?? "",
      notes: lead.notes ?? "",
      scheduledAt: lead.scheduledAt ?? "",
    });

    return receipt ?? { ok: true };
  }

  /**
   * The interview's close, with the fields `submitLead` needs for a full
   * enquiry: the agent's two-stage save is reduced to one `complete` call,
   * because the partial one is the agent's own and does not reach us.
   */
  async submitInterview(summary: InterviewSummary): Promise<SubmissionReceipt> {
    const receipt = await invokeFunction<SubmissionReceipt>(this.client, "submitLead", {
      source: "interview",
      stage: "complete",
      name: summary.name,
      phone: summary.phone,
      email: summary.email ?? "",
      track: summary.track ?? "",
      meetingTopic: summary.meetingTopic ?? "",
      timing: summary.timing ?? "",
      notes: summary.notes ?? "",
      scheduledAt: summary.scheduledAt ?? "",
      summary: summary.summary ?? "",
      profile: summary.profile ?? {},
    });

    return receipt ?? { ok: true };
  }

  async submitClaim(report: ClaimReport): Promise<SubmissionReceipt> {
    const receipt = await invokeFunction<SubmissionReceipt>(this.client, "submitClaim", {
      name: report.name,
      phone: report.phone,
      email: report.email ?? "",
      claimType: report.claimType ?? "",
      eventDate: report.eventDate ?? "",
      policyNumber: report.policyNumber ?? "",
      description: report.description ?? "",
      documents: report.documents ?? [],
    });

    return receipt ?? { ok: true };
  }

  /**
   * Calendar holds are decoration on top of a submission that has already
   * succeeded, so a failure is swallowed here rather than surfaced — this is
   * the one place where that is the right call.
   *
   * One call, two calendars. This used to invoke `createConsultationEvent` and
   * `createOutlookEvent` side by side: two backend functions holding the same
   * event-building code, differing only in which API they posted it to. That is
   * the duplication `AGENTS.md` warns about, and it had already drifted — the
   * timezone fix that stopped 10:00 landing at 13:00 went into the Google copy
   * and not the Outlook one, so one diary held the agreed hour and the other did
   * not, with nothing anywhere saying so. `createConsultationEvent` now builds
   * the event once and writes it to every calendar in `CALENDAR_PROVIDERS`.
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
    // `Promise.allSettled` over one call rather than a bare `await`: what is
    // load-bearing here is that nothing this method does can reject into a
    // caller whose lead is already saved, and that has to survive the day a
    // second call comes back.
    await Promise.allSettled([
      this.client.functions.invoke("createConsultationEvent", payload),
    ]);
  }
}