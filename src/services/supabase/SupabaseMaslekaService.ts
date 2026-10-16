import { readSnapshot } from "@/lib/clearinghouse/snapshot";
import { priorityOf, toPublishedRecommendation } from "../account-mapping";
import {
  MaslekaError,
  type FindingReview,
  type PublishItem,
  type StaffPublishedItem,
  type ReviewDecision,
  type SnapshotSummary,
  type StoredSnapshot,
  type MaslekaFailure,
  type MaslekaField,
  type MaslekaLink,
  type MaslekaPort,
  type MaslekaRequest,
  type MaslekaStatus,
  type NewMaslekaRequest,
} from "../ports";

type PostgrestError = { message: string; code?: string } | null;

/** Just the calls this adapter makes — narrowed for the reason SupabaseAuthClient is. */
export interface SupabaseMaslekaClient {
  rpc(
    fn: "clearinghouse_publish" | "clearinghouse_unpublish" | "clearinghouse_mark_answers_seen",
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: PostgrestError }>;
  from(table: "clearinghouse_published_items"): {
    select(columns: string): {
      eq(column: "snapshot_id", value: string): {
        order(column: "position", options: { ascending: boolean }): PromiseLike<{ data: unknown[] | null; error: PostgrestError }>;
      };
    };
  };
  from(table: "masleka_requests"): {
    select(columns: string): {
      in(column: "status", values: string[]): {
        order(column: string, options: { ascending: boolean }): PromiseLike<{ data: unknown[] | null; error: PostgrestError }>;
      };
    };
  };
  from(table: "clearinghouse_snapshots"): {
    select(columns: string): {
      order(column: string, options: { ascending: boolean }): PromiseLike<{ data: unknown[] | null; error: PostgrestError }>;
      eq(column: "id", value: string): {
        maybeSingle(): PromiseLike<{ data: unknown; error: PostgrestError }>;
      };
    };
  };
  from(table: "clearinghouse_reviews"): {
    select(columns: string): {
      eq(column: "snapshot_id", value: string): PromiseLike<{ data: unknown[] | null; error: PostgrestError }>;
    };
    upsert(
      row: Record<string, unknown>,
      options: { onConflict: string },
    ): PromiseLike<{ error: PostgrestError }>;
    delete(): {
      eq(column: "snapshot_id", value: string): {
        eq(column: "finding_key", value: string): PromiseLike<{ error: PostgrestError }>;
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

const REASONS = new Set<string>([
  "disabled", "link_invalid", "bad_id", "bad_code", "already_submitted", "rate_limited", "unauthorized", "forbidden",
  "not_found", "not_available", "invalid", "invalid_name", "invalid_email", "unavailable", "not_saved", "failed",
]);

/** A snapshot's list row: everything but the report itself. */
export const SNAPSHOT_SUMMARY_COLUMNS = "id,request_id,client_name,taken_at";

export function toSnapshotSummary(row: Record<string, unknown>): SnapshotSummary {
  return {
    id: String(row.id),
    requestId: text(row.request_id),
    clientName: text(row.client_name) ?? "",
    takenAt: text(row.taken_at) ?? "",
  };
}

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

  async listSnapshots(): Promise<SnapshotSummary[]> {
    const { data, error } = await this.client
      .from("clearinghouse_snapshots")
      .select(SNAPSHOT_SUMMARY_COLUMNS)
      .order("created_at", { ascending: false });
    if (error) throw new MaslekaError("failed");
    return (data ?? []).map((row) => toSnapshotSummary(row as Record<string, unknown>));
  }

  async getSnapshot(snapshotId: string): Promise<StoredSnapshot | null> {
    const { data, error } = await this.client
      .from("clearinghouse_snapshots")
      .select(`${SNAPSHOT_SUMMARY_COLUMNS},data,client_email,published_at`)
      .eq("id", snapshotId)
      .maybeSingle();
    if (error) throw new MaslekaError("failed");
    if (!data) return null;
    const row = data as Record<string, unknown>;
    const snapshot = readSnapshot(row.data);
    return snapshot
      ? { ...toSnapshotSummary(row), snapshot, clientEmail: text(row.client_email), publishedAt: text(row.published_at) }
      : null;
  }

  async listReviews(snapshotId: string): Promise<FindingReview[]> {
    const { data, error } = await this.client
      .from("clearinghouse_reviews")
      .select("finding_key,status,final_text,title,priority,reviewed_at")
      .eq("snapshot_id", snapshotId);
    if (error) throw new MaslekaError("failed");
    return (data ?? []).flatMap((raw) => {
      const row = raw as Record<string, unknown>;
      if (typeof row.finding_key !== "string" || (row.status !== "approved" && row.status !== "rejected")) return [];
      return [{
        findingKey: row.finding_key,
        status: row.status,
        finalText: text(row.final_text),
        title: text(row.title),
        priority: priorityOf(row.priority),
        reviewedAt: text(row.reviewed_at) ?? "",
      }];
    });
  }

  async decide(snapshotId: string, findingKey: string, decision: ReviewDecision | null): Promise<void> {
    const reviews = this.client.from("clearinghouse_reviews");
    const { error } = decision
      ? await reviews.upsert(
          {
            snapshot_id: snapshotId,
            finding_key: findingKey,
            status: decision.status,
            final_text: decision.finalText,
            // Sent only when given: approving a rule's finding keeps any title or priority Dorit set before.
            ...("title" in decision ? { title: decision.title ?? null } : {}),
            ...("priority" in decision ? { priority: decision.priority ?? null } : {}),
          },
          { onConflict: "snapshot_id,finding_key" },
        )
      : await reviews.delete().eq("snapshot_id", snapshotId).eq("finding_key", findingKey);
    if (error) throw new MaslekaError("failed");
  }

  async listPublishedItems(snapshotId: string): Promise<StaffPublishedItem[]> {
    const { data, error } = await this.client
      .from("clearinghouse_published_items")
      .select("id,position,title,body,priority,client_status,client_note,client_updated_at,staff_seen_at")
      .eq("snapshot_id", snapshotId)
      .order("position", { ascending: true });
    if (error) throw new MaslekaError("failed");
    return (data ?? []).flatMap((raw) => {
      const row = raw as Record<string, unknown>;
      const item = toPublishedRecommendation(row);
      return item
        ? [{ ...item, position: Number(row.position) || 0, clientUpdatedAt: text(row.client_updated_at), staffSeenAt: text(row.staff_seen_at) }]
        : [];
    });
  }

  async publish(snapshotId: string, clientEmail: string, items: PublishItem[]): Promise<void> {
    const { error } = await this.client.rpc("clearinghouse_publish", {
      p_snapshot: snapshotId,
      p_client_email: clientEmail,
      p_items: items.map(({ title, body, priority }) => ({ title, body, priority })),
    });
    if (error) throw new MaslekaError(error.code === "22023" ? (/email/.test(error.message) ? "invalid_email" : "invalid") : "failed");
  }

  async unpublish(snapshotId: string): Promise<void> {
    const { error } = await this.client.rpc("clearinghouse_unpublish", { p_snapshot: snapshotId });
    if (error) throw new MaslekaError("failed");
  }

  async markAnswersSeen(snapshotId: string): Promise<void> {
    const { error } = await this.client.rpc("clearinghouse_mark_answers_seen", { p_snapshot: snapshotId });
    if (error) throw new MaslekaError("failed");
  }
}
