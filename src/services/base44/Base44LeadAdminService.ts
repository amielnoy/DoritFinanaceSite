import { invokeFunction, type FunctionInvoker } from "./invoke";
import type { LeadAdminPort, LeadRecord, LeadStatus } from "../ports";

/** What this adapter needs: Lead reads through the entity, writes through the `adminLead` function. */
export interface LeadAdminClient extends FunctionInvoker {
  entities: {
    Lead: {
      list(sort?: string, limit?: number): Promise<unknown[]>;
    };
  };
}

/**
 * Admin side of the lead store.
 *
 * Newest-first is fixed here rather than passed in: every caller wants it, and
 * a screen that quietly sorted oldest-first would bury the enquiry the owner
 * most needs to answer.
 */
export class Base44LeadAdminService implements LeadAdminPort {
  constructor(private readonly client: LeadAdminClient) {}

  async list(limit = 500): Promise<LeadRecord[]> {
    const rows = await this.client.entities.Lead.list("-created_date", limit);
    return (rows ?? []) as LeadRecord[];
  }

  /**
   * Writes go through `adminLead`, not the entity: the function updates the
   * Supabase copy as well, which the visitor's personal area reads. A direct
   * entity write left every status at "new" there and kept deleted enquiries.
   */
  async setStatus(id: string, status: LeadStatus): Promise<void> {
    await this.write({ action: "status", id, status });
  }

  async remove(id: string): Promise<void> {
    await this.write({ action: "delete", id });
  }

  private async write(payload: Record<string, unknown>): Promise<void> {
    const receipt = await invokeFunction<{ ok?: boolean; error?: string; rid?: string }>(
      this.client,
      "adminLead",
      payload
    );
    // A rejected call throws in the SDK; an answer that says it did not save must not read as success.
    if (receipt?.ok !== true) {
      throw new Error(`adminLead did not confirm the write${receipt?.rid ? ` (rid ${receipt.rid})` : ""}`);
    }
  }
}
