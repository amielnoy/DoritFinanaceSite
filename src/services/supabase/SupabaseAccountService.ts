import { toClientMeeting, toClientSnapshot, toEnquiry } from "../account-mapping";
import { AccountLoadError, type AccountPort, type ClientAnswer, type ClientMeeting, type ClientSnapshot, type Enquiry } from "../ports";
import type { MeetingRequestKind } from "@/lib/meetings";

/** Just the call this adapter makes — see SupabaseAuthClient for why it is narrowed. */
export interface SupabaseRpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
  /** An Edge Function, with the signed-in user's session (supabase-js sends it). Only the meeting request needs it. */
  functions?: {
    invoke(name: string, options: { body: Record<string, unknown> }): Promise<{ data: unknown; error: { context?: unknown } | null }>;
  };
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

  async myMeetings(): Promise<ClientMeeting[]> {
    const { data, error } = await this.client.rpc("my_meetings");
    // As my_enquiries: an unconfirmed address gets an empty set, not an error.
    if (error) throw new AccountLoadError(SIGNED_OUT_CODES.has(error.code ?? "") ? "signed_out" : "failed");
    return (Array.isArray(data) ? data : []).map((r) => toClientMeeting(r as Record<string, unknown>));
  }

  /**
   * Through the meeting-request Edge Function, not the RPC directly: the
   * function runs request_meeting_change under this session and then mails
   * Dorit, so a request never sits unseen. Its refusal comes back in its own
   * words ("כבר נשלחה בקשה לפגישה הזו…").
   */
  async requestMeetingChange(meetingId: string, kind: MeetingRequestKind, note?: string): Promise<void> {
    if (!this.client.functions) throw new Error("אין חיבור לשרת.");
    const { error } = await this.client.functions.invoke("meeting-request", { body: { meetingId, kind, note: note ?? null } });
    if (!error) return;
    const res = error.context instanceof Response ? error.context : null;
    if (res?.status === 401) throw new AccountLoadError("signed_out");
    const answer = res ? ((await res.json().catch(() => null)) as { error?: unknown } | null) : null;
    throw new Error(typeof answer?.error === "string" ? answer.error : "הבקשה לא נשלחה. אפשר לנסות שוב.");
  }
}
