import {
  MaslekaError,
  type MaslekaFailure,
  type MaslekaField,
  type MaslekaLink,
  type MaslekaPort,
  type MaslekaRequest,
  type MaslekaStatus,
  type NewMaslekaRequest,
  type StaffRole,
} from "../ports";

type PostgrestError = { message: string; code?: string } | null;

/** Just the calls this adapter makes — narrowed for the reason SupabaseAuthClient is. */
export interface SupabaseMaslekaClient {
  rpc(fn: "my_staff_role"): PromiseLike<{ data: unknown; error: PostgrestError }>;
  from(table: "masleka_requests"): {
    select(columns: string): {
      in(column: "status", values: string[]): {
        order(column: string, options: { ascending: boolean }): PromiseLike<{ data: unknown[] | null; error: PostgrestError }>;
      };
    };
  };
  functions: {
    invoke(
      name: string,
      options: { body: Record<string, unknown> },
    ): Promise<{ data: unknown; error: { message: string; context?: unknown } | null }>;
  };
}

/** Exactly the columns the migration grants to `authenticated` and the board shows. */
export const MASLEKA_COLUMNS =
  "id,client_name,contact_email,status,lead_id,id_last4,created_at,token_expires_at,client_invited_at,code_received_at,submitted_at,clearinghouse_deletes_at,completed_at";

/** What the board shows; expired and cancelled requests leave it. */
export const OPEN_STATUSES: readonly MaslekaStatus[] = ["invited", "code_received", "submitted", "completed"];

const ROLES = new Set<string>(["admin", "owner", "agent", "staff"]);
const REASONS = new Set<string>([
  "disabled", "link_invalid", "bad_id", "bad_code", "already_submitted", "rate_limited", "unauthorized", "forbidden",
  "not_found", "not_available", "invalid", "invalid_name", "invalid_email", "unavailable", "failed",
]);

/** When a gateway answers without our body: 401/403 ask the staff member to sign in again. */
const BY_STATUS: Record<number, MaslekaFailure> = { 401: "unauthorized", 403: "forbidden", 429: "rate_limited", 503: "unavailable" };

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

export function toMaslekaRequest(row: Record<string, unknown>): MaslekaRequest {
  return {
    id: String(row.id),
    clientName: text(row.client_name) ?? "",
    contactEmail: text(row.contact_email),
    status: (text(row.status) ?? "invited") as MaslekaStatus,
    leadId: text(row.lead_id),
    idLast4: text(row.id_last4),
    createdAt: text(row.created_at) ?? "",
    tokenExpiresAt: text(row.token_expires_at),
    clientInvitedAt: text(row.client_invited_at),
    codeReceivedAt: text(row.code_received_at),
    submittedAt: text(row.submitted_at),
    clearinghouseDeletesAt: text(row.clearinghouse_deletes_at),
    completedAt: text(row.completed_at),
  };
}

/**
 * supabase-js resolves a non-2xx answer as `{ error }` with the Response on
 * `error.context`. Its body names the reason in a closed vocabulary and the
 * rid; anything outside the vocabulary is a plain failure, never shown.
 */
async function failure(error: { message: string; context?: unknown }): Promise<MaslekaError> {
  const res = error.context;
  const body =
    res instanceof Response ? ((await res.json().catch(() => null)) as { error?: unknown; rid?: unknown } | null) : null;
  const named = typeof body?.error === "string" && REASONS.has(body.error) ? (body.error as MaslekaFailure) : null;
  const status = res instanceof Response ? res.status : 0;
  return new MaslekaError(named ?? BY_STATUS[status] ?? "failed", typeof body?.rid === "string" ? body.rid : undefined);
}

function linkFrom(data: Record<string, unknown>): MaslekaLink {
  if (typeof data.requestId !== "string" || typeof data.link !== "string") throw new MaslekaError("failed");
  return { requestId: data.requestId, link: data.link, invited: data.invited === true };
}

/** The clearinghouse pipeline on Supabase: RLS reads under the session, Edge Functions for the rest. */
export class SupabaseMaslekaService implements MaslekaPort {
  constructor(private readonly client: SupabaseMaslekaClient) {}

  private async call(name: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data, error } = await this.client.functions.invoke(name, { body });
    if (error) throw await failure(error);
    return (data ?? {}) as Record<string, unknown>;
  }

  async submitCode(token: string, code: string, idNumber: string): Promise<void> {
    await this.call("masleka-code", { token, code, idNumber });
  }

  async myRole(): Promise<StaffRole | null> {
    const { data, error } = await this.client.rpc("my_staff_role");
    if (error) throw new MaslekaError("failed");
    return typeof data === "string" && ROLES.has(data) ? (data as StaffRole) : null;
  }

  async list(): Promise<MaslekaRequest[]> {
    const { data, error } = await this.client
      .from("masleka_requests")
      .select(MASLEKA_COLUMNS)
      .in("status", [...OPEN_STATUSES])
      .order("created_at", { ascending: false });
    if (error) throw new MaslekaError("failed");
    return (data ?? []).map((row) => toMaslekaRequest(row as Record<string, unknown>));
  }

  async create(input: NewMaslekaRequest): Promise<MaslekaLink> {
    return linkFrom(
      await this.call("masleka-create", {
        clientName: input.clientName,
        contactEmail: input.contactEmail ?? "",
        sendInvite: input.sendInvite,
      }),
    );
  }

  async relink(requestId: string): Promise<MaslekaLink> {
    return linkFrom(await this.call("masleka-create", { requestId }));
  }

  async reveal(requestId: string, field: MaslekaField): Promise<string> {
    const data = await this.call("masleka-reveal", { requestId, field });
    if (typeof data.value !== "string") throw new MaslekaError("failed");
    return data.value;
  }

  async markSubmitted(requestId: string): Promise<void> {
    await this.call("masleka-submitted", { requestId });
  }
}
