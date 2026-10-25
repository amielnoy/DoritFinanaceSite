import { invokeFunction, type FunctionInvoker } from "./invoke";
import type { AgendaMeeting, LeadAdminPort, LeadMeeting, LeadRecord, LeadStatus, TranscriptLine } from "../ports";

/** What this adapter needs: Lead reads through the entity, writes through the `adminLead` function. */
export interface LeadAdminClient extends FunctionInvoker {
  entities: {
    Lead: {
      list(sort?: string, limit?: number): Promise<unknown[]>;
    };
  };
}

const STAFF_LEADS_SUPABASE_ONLY = "פניות שהצוות מזין נשמרות רק ב-Supabase.";
const MERGE_SUPABASE_ONLY = "מיזוג פניות זמין רק ב-Supabase.";
const PIPELINE_SUPABASE_ONLY = "הערות ומעקב זמינים רק ב-Supabase.";
const MEETINGS_SUPABASE_ONLY = "פגישות נשמרות רק ב-Supabase.";

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

  /** Base44 stores a document as a file URL, which already opens it. */
  async documentLink(ref: string): Promise<string> {
    return ref;
  }

  /** Base44 keeps no transcripts the site can read. */
  async transcript(): Promise<TranscriptLine[]> {
    return [];
  }

  async transcriptLeadIds(): Promise<string[]> {
    return [];
  }

  /**
   * Meetings live in Supabase only (the Base44 bridge is not extended — spec
   * 2026-10-17-client-meetings-design.md): no rows here, and every write is refused.
   */
  async meetings(): Promise<LeadMeeting[]> {
    return [];
  }

  /** The agenda, for the same reason: Base44 holds no meetings. */
  async agencyMeetings(): Promise<AgendaMeeting[]> {
    return [];
  }

  async createLead(): Promise<never> {
    throw new Error(STAFF_LEADS_SUPABASE_ONLY);
  }

  async clearDuplicate(): Promise<void> {
    throw new Error(STAFF_LEADS_SUPABASE_ONLY);
  }

  async mergeLeads(): Promise<never> {
    throw new Error(MERGE_SUPABASE_ONLY);
  }

  async unmergeLead(): Promise<void> {
    throw new Error(MERGE_SUPABASE_ONLY);
  }

  /** No activity log in Base44: an empty one, and every write refused. */
  async leadEvents(): Promise<never[]> {
    return [];
  }

  async addLeadNote(): Promise<void> {
    throw new Error(PIPELINE_SUPABASE_ONLY);
  }

  async setFollowUp(): Promise<void> {
    throw new Error(PIPELINE_SUPABASE_ONLY);
  }

  async addMeeting(): Promise<void> {
    throw new Error(MEETINGS_SUPABASE_ONLY);
  }

  async updateMeeting(): Promise<void> {
    throw new Error(MEETINGS_SUPABASE_ONLY);
  }

  async handleMeetingRequest(): Promise<void> {
    throw new Error(MEETINGS_SUPABASE_ONLY);
  }

  async countNew(): Promise<number> {
    return (await this.list()).filter((lead) => lead.status === "new").length;
  }

  /** Base44 has no agencies or assignment: the rollback path has one admin and no queue. */
  async assign(): Promise<{ mailed: boolean }> {
    throw new Error("שיוך פניות זמין רק עם Supabase.");
  }

  async countUnassigned(): Promise<number> {
    return 0;
  }

  /** Base44 holds no meetings, so no client can have asked to move one. */
  async countOpenMeetingRequests(): Promise<number> {
    return 0;
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
