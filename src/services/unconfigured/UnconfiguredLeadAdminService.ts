import type {
  AgendaMeeting,
  CreatedLead,
  LeadAdminPort,
  LeadBriefing,
  LeadEvent,
  LeadMeeting,
  LeadRecord,
  TranscriptLine,
} from "../ports";

const NO_DATABASE = "אין חיבור למאגר.";

/**
 * The admin's leads for a build with no Supabase credentials: there is no
 * store, so every screen reads empty (no leads, no counts, no meetings) and
 * every write is refused. A document link is refused too — there is no
 * bucket to sign it from.
 */
export class UnconfiguredLeadAdminService implements LeadAdminPort {
  async list(): Promise<LeadRecord[]> {
    return [];
  }

  async leadEvents(): Promise<LeadEvent[]> {
    return [];
  }

  async briefing(): Promise<LeadBriefing | null> {
    return null;
  }

  async transcript(): Promise<TranscriptLine[]> {
    return [];
  }

  async transcriptLeadIds(): Promise<string[]> {
    return [];
  }

  async meetings(): Promise<LeadMeeting[]> {
    return [];
  }

  async agencyMeetings(): Promise<AgendaMeeting[]> {
    return [];
  }

  async countNew(): Promise<number> {
    return 0;
  }

  async countUnassigned(): Promise<number> {
    return 0;
  }

  async countOpenMeetingRequests(): Promise<number> {
    return 0;
  }

  async setStatus(): Promise<void> {
    throw new Error(NO_DATABASE);
  }

  async remove(): Promise<void> {
    throw new Error(NO_DATABASE);
  }

  async createLead(): Promise<CreatedLead> {
    throw new Error(NO_DATABASE);
  }

  async convertToClient(): Promise<string> {
    throw new Error(NO_DATABASE);
  }

  async inviteClient(): Promise<void> {
    throw new Error(NO_DATABASE);
  }

  async clearDuplicate(): Promise<void> {
    throw new Error(NO_DATABASE);
  }

  async mergeLeads(): Promise<number> {
    throw new Error(NO_DATABASE);
  }

  async unmergeLead(): Promise<void> {
    throw new Error(NO_DATABASE);
  }

  async addLeadNote(): Promise<void> {
    throw new Error(NO_DATABASE);
  }

  async setFollowUp(): Promise<void> {
    throw new Error(NO_DATABASE);
  }

  async logWhatsapp(): Promise<void> {
    throw new Error(NO_DATABASE);
  }

  async generateBriefing(): Promise<LeadBriefing> {
    throw new Error(NO_DATABASE);
  }

  async documentLink(): Promise<string> {
    throw new Error(NO_DATABASE);
  }

  async assign(): Promise<{ mailed: boolean }> {
    throw new Error(NO_DATABASE);
  }

  async addMeeting(): Promise<void> {
    throw new Error(NO_DATABASE);
  }

  async updateMeeting(): Promise<void> {
    throw new Error(NO_DATABASE);
  }

  async handleMeetingRequest(): Promise<void> {
    throw new Error(NO_DATABASE);
  }
}
