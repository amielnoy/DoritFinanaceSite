import { toEnquiry } from "../account-mapping";
import { AccountLoadError, type AccountPort, type Enquiry } from "../ports";

/** Just the call this adapter makes — see SupabaseAuthClient for why it is narrowed. */
export interface SupabaseRpcClient {
  rpc(fn: string): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
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
}
