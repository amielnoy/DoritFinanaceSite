import { toClientSnapshot, toEnquiry } from "../account-mapping";
import { AccountLoadError, type AccountPort, type ClientAnswer, type ClientSnapshot, type Enquiry } from "../ports";

/** Just the call this adapter makes — see SupabaseAuthClient for why it is narrowed. */
export interface SupabaseRpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

const SIGNED_OUT_CODES = new Set(["42501", "PGRST301", "PGRST302", "PGRST303"]);

/** The personal area for a visitor signed in through Supabase. */
export class SupabaseAccountService implements AccountPort {
  constructor(private readonly client: SupabaseRpcClient) {}

  async myEnquiries(): Promise<Enquiry[]> {
    const { data, error } = await this.client.rpc("my_enquiries");
    // 42501: `my_enquiries` is revoked from anon, so a signed-out call is denied.
    // PGRST301-303: JWT missing, expired or invalid.
    // No "unverified" here: an unconfirmed address gets an empty set, not an error.
    if (error) throw new AccountLoadError(SIGNED_OUT_CODES.has(error.code ?? "") ? "signed_out" : "failed");
    return (Array.isArray(data) ? data : []).map((r) => toEnquiry(r as Record<string, unknown>));
  }

  async mySnapshot(): Promise<ClientSnapshot | null> {
    const { data, error } = await this.client.rpc("my_snapshot");
    if (error) throw new AccountLoadError(SIGNED_OUT_CODES.has(error.code ?? "") ? "signed_out" : "failed");
    return toClientSnapshot(data);
  }

  async respondToRecommendation(itemId: string, status: ClientAnswer, note?: string): Promise<void> {
    const { error } = await this.client.rpc("respond_to_recommendation", { p_item: itemId, p_status: status, p_note: note ?? null });
    if (!error) return;
    if (/unverified/.test(error.message)) throw new AccountLoadError("unverified");
    // 42501 is also "not your recommendation" (not_found): a failure, not a sign-out.
    throw new AccountLoadError(SIGNED_OUT_CODES.has(error.code ?? "") && !/not_found/.test(error.message) ? "signed_out" : "failed");
  }
}
