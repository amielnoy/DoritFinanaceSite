import { interviewBody, leadBody } from "../lead-bodies";
import type { ClaimReport, InterviewSummary, Lead, LeadPort, SubmissionReceipt } from "../ports";

/** The one call this adapter makes — narrowed for the reason SupabaseAuthClient is. */
export interface SupabaseFunctionsClient {
  functions: {
    invoke(
      name: string,
      options: { body: Record<string, unknown>; signal?: AbortSignal },
    ): Promise<{ data: unknown; error: { message: string; context?: unknown } | null }>;
  };
}

/**
 * Claims, on the `submit-claim` Edge Function; leads and interviews on `submit-lead`
 * when `useEdge` is on; every other lead path, unchanged.
 *
 * Contact forms, interviews and calendar holds still run on Base44's functions,
 * which hold the calendar and Sheets connections. They go to `rest`, the Base44
 * adapter, as they did before this class existed.
 */
export class SupabaseLeadService implements LeadPort {
  constructor(
    private readonly client: SupabaseFunctionsClient,
    private readonly rest: LeadPort,
    private readonly useEdge: boolean = false,
  ) {}

  submitLead(lead: Lead): Promise<SubmissionReceipt> {
    return this.useEdge ? this.edge("submit-lead", leadBody(lead)) : this.rest.submitLead(lead);
  }

  submitInterview(summary: InterviewSummary): Promise<SubmissionReceipt> {
    return this.useEdge ? this.edge("submit-lead", interviewBody(summary)) : this.rest.submitInterview(summary);
  }

  private async edge(name: string, body: Record<string, unknown>): Promise<SubmissionReceipt> {
    const { data, error } = await this.client.functions.invoke(name, { body });
    if (error) throw await functionFailure(name, error);
    return (data as SubmissionReceipt | null) ?? { ok: true };
  }

  requestConsultationEvent(lead: Lead): Promise<void> {
    return this.rest.requestConsultationEvent(lead);
  }

  async submitClaim(report: ClaimReport): Promise<SubmissionReceipt> {
    const { data, error } = await this.client.functions.invoke("submit-claim", {
      body: {
        name: report.name,
        phone: report.phone,
        email: report.email ?? "",
        claimType: report.claimType ?? "",
        eventDate: report.eventDate ?? "",
        policyNumber: report.policyNumber ?? "",
        description: report.description ?? "",
        documents: report.documents ?? [],
        channel: report.channel ?? "",
        campaign: report.campaign ?? "",
        landingPath: report.landingPath ?? "",
      },
    });
    if (error) throw await functionFailure("submit-claim", error);
    return (data as SubmissionReceipt | null) ?? { ok: true };
  }
}

/**
 * supabase-js resolves a non-2xx answer as `{ error }`, with the Response on
 * `error.context`; its body carries the function's message and `rid`. The form
 * shows its own failure text either way — the rid is for whoever reads the
 * console when a visitor reports it.
 */
async function functionFailure(name: string, error: { message: string; context?: unknown }): Promise<Error> {
  const res = error.context;
  const body =
    res instanceof Response ? ((await res.json().catch(() => null)) as { error?: string; rid?: string } | null) : null;
  const rid = body?.rid ? ` (rid ${body.rid})` : "";
  return new Error(`${name} failed: ${body?.error ?? error.message}${rid}`);
}
