import {
  MaslekaError,
  type FindingReview,
  type MaslekaPort,
  type MaslekaRequest,
  type SnapshotSummary,
} from "../ports";

/**
 * The clearinghouse pipeline for a build with no Supabase credentials: never
 * available — the same "signed out" stance as
 * UnconfiguredAccountService, rather than a TypeError from a null client.
 */
export class UnconfiguredMaslekaService implements MaslekaPort {
  async submitCode(): Promise<void> {
    throw new MaslekaError("unavailable");
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
  async listPublishedItems(): Promise<never> {
    throw new MaslekaError("unavailable");
  }
  async publish(): Promise<void> {
    throw new MaslekaError("unavailable");
  }
  async unpublish(): Promise<void> {
    throw new MaslekaError("unavailable");
  }
  async markAnswersSeen(): Promise<void> {
    throw new MaslekaError("unavailable");
  }
}
