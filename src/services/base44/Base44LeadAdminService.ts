import type { LeadAdminPort, LeadRecord, LeadStatus } from "../ports";

/** The entity surface this adapter needs — list, update and delete on Lead. */
export interface LeadAdminClient {
  entities: {
    Lead: {
      list(sort?: string, limit?: number): Promise<unknown[]>;
      update(id: string, patch: Record<string, unknown>): Promise<unknown>;
      delete(id: string): Promise<unknown>;
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

  async setStatus(id: string, status: LeadStatus): Promise<void> {
    await this.client.entities.Lead.update(id, { status });
  }

  async remove(id: string): Promise<void> {
    await this.client.entities.Lead.delete(id);
  }
}
