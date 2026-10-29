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
 * Every enquiry, on the Edge Functions: claims on `submit-claim`; contact
 * forms, interviews and their follow-up details on `submit-lead`, which also
 * places the calendar hold a consultation asks for.
 */
export class SupabaseLeadService implements LeadPort {
  constructor(private readonly client: SupabaseFunctionsClient) {}

  /** `submit-lead` fills in the lead an interview has just saved. */
  readonly updatesInterviews = true;

  submitLead(lead: Lead): Promise<SubmissionReceipt> {
    return this.edge("submit-lead", leadBody(lead));
  }

  submitInterview(summary: InterviewSummary): Promise<SubmissionReceipt> {
    return this.edge("submit-lead", interviewBody(summary));
  }

  private async edge(name: string, body: Record<string, unknown>): Promise<SubmissionReceipt> {
    const { data, error } = await this.client.functions.invoke(name, { body });
    if (error) throw await functionFailure(name, error);
    return (data as SubmissionReceipt | null) ?? { ok: true };
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
