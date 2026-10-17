import { AccountLoadError, type AccountPort, type ClientMeeting, type ClientSnapshot, type Enquiry } from "../ports";

/**
 * The personal area for a build with no Supabase credentials.
 *
 * Nobody can be signed in, so the page gets the "signed out" answer it already
 * knows how to show, rather than a TypeError from a null client.
 */
export class UnconfiguredAccountService implements AccountPort {
  async myEnquiries(): Promise<Enquiry[]> {
    throw new AccountLoadError("signed_out");
  }
  async mySnapshot(): Promise<ClientSnapshot | null> {
    throw new AccountLoadError("signed_out");
  }
  async respondToRecommendation(): Promise<void> {
    throw new AccountLoadError("signed_out");
  }
  async myMeetings(): Promise<ClientMeeting[]> {
    throw new AccountLoadError("signed_out");
  }
  async requestMeetingChange(): Promise<void> {
    throw new AccountLoadError("signed_out");
  }
}
