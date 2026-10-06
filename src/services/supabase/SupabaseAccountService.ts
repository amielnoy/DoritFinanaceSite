import { toEnquiry } from "../account-mapping";
import { AccountLoadError, type AccountPort, type Enquiry } from "../ports";

/** Just the call this adapter makes — see SupabaseAuthClient for why it is narrowed. */
export interface SupabaseRpcClient {
  rpc(fn: string): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** The personal area for a visitor signed in through Supabase. */
export class SupabaseAccountService implements AccountPort {
  constructor(private readonly client: SupabaseRpcClient) {}

  async myEnquiries(): Promise<Enquiry[]> {
    const { data, error } = await this.client.rpc("my_enquiries");
    if (error) throw new AccountLoadError("failed");
    return (Array.isArray(data) ? data : []).map((r) => toEnquiry(r as Record<string, unknown>));
  }
}
