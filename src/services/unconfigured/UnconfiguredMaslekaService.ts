import {
  MaslekaError,
  type FindingReview,
  type MaslekaPort,
  type MaslekaRequest,
  type SnapshotSummary,
  type StaffRole,
} from "../ports";

/**
 * The clearinghouse pipeline for a build with no Supabase credentials: never
 * available, and nobody is staff — the same "signed out" stance as
 * UnconfiguredAccountService, rather than a TypeError from a null client.
 */
export class UnconfiguredMaslekaService implements MaslekaPort {
  async submitCode(): Promise<void> {
    throw new MaslekaError("unavailable");
  }
  async myRole(): Promise<StaffRole | null> {
    return null;
  }
  async list(): Promise<MaslekaRequest[]> {
    throw new MaslekaError("unavailable");
  }
  async create(): Promise<never> {
    throw new MaslekaError("unavailable");
  }
  async relink(): Promise<never> {
    throw new MaslekaError("unavailable");
  }
  async reveal(): Promise<never> {
    throw new MaslekaError("unavailable");
  }
  async markSubmitted(): Promise<void> {
    throw new MaslekaError("unavailable");
  }
  async listSnapshots(): Promise<SnapshotSummary[]> {
    throw new MaslekaError("unavailable");
  }
  async getSnapshot(): Promise<never> {
    throw new MaslekaError("unavailable");
  }
  async listReviews(): Promise<FindingReview[]> {
    throw new MaslekaError("unavailable");
  }
  async decide(): Promise<void> {
    throw new MaslekaError("unavailable");
  }
}
