import type { InterviewSummary } from "@/lib/interview-handoff";
import type { Snapshot } from "@/lib/clearinghouse/snapshot";

export type { InterviewSummary };

/**
 * Ports — the interfaces the application depends on.
 *
 * Dependency Inversion: components and hooks depend on these abstractions, not
 * on the Base44 SDK. Before this, 14 files imported the vendor singleton
 * directly, so the SDK's shape *was* the application's architecture and every
 * test had to mock the vendor module.
 *
 * Interface Segregation: four narrow ports rather than one client interface, so
 * a blog page cannot reach lead submission and a form cannot reach content.
 */

export interface Lead {
  name: string;
  phone: string;
  email?: string;
  source: LeadSource;
  topic?: string;
  timing?: string;
  message?: string;
  notes?: string;
  /** ISO datetime when the visitor picked a specific date+time; empty otherwise. */
  scheduledAt?: string;
  /** Marketing channel attribution — see src/lib/attribution.ts. Never PII. */
  channel?: string;
  campaign?: string;
  /** The route the visitor was on when they converted. Informational only — never persisted. */
  landingPath?: string;
}

export type LeadSource =
  | "quick"
  | "detailed"
  | "consultation"
  | "claim"
  | "escalation"
  | "interview";

export interface ClaimReport {
  name: string;
  phone: string;
  email?: string;
  claimType?: string;
  eventDate?: string;
  policyNumber?: string;
  description?: string;
  documents?: string[];
  /** Marketing channel attribution — see src/lib/attribution.ts. Never PII. */
  channel?: string;
  campaign?: string;
  landingPath?: string;
}

export interface SubmissionReceipt {
  ok: boolean;
  leadId?: string | null;
  /**
   * The request id, which names every log line the submission produced.
   *
   * It was logged and never returned, so a visitor reporting a failure had
   * nothing to quote and we had nothing to search. Diagnosing meant inferring
   * from timestamps and absences — which is how three days went on the one
   * genuine outage this site has had. Eight characters turn that into one
   * search.
   */
  rid?: string;
  /** Non-fatal problems the backend reported, e.g. a notification that failed. */
  warnings?: string[];
}

/** Submitting an enquiry. The only write path the public site has. */
export interface LeadPort {
  submitLead(lead: Lead): Promise<SubmissionReceipt>;
  submitClaim(report: ClaimReport): Promise<SubmissionReceipt>;
  /** Best-effort calendar holds. Failure here must never fail a submission. */
  requestConsultationEvent(lead: Lead): Promise<void>;
  /**
   * The close of an interview, submitted by the page rather than by the agent.
   *
   * The agent's own tool calls are not executed in an anonymous conversation,
   * and every visitor is anonymous — see `src/lib/interview-handoff.ts` and
   * A-59. This is the path that actually reaches Dorit.
   */
  submitInterview(summary: InterviewSummary): Promise<SubmissionReceipt>;
  /**
   * Whether `submitInterview` with `stage: "details"` fills in the visitor's
   * just-saved lead. Only the Edge `submit-lead` does; elsewhere the
   * questionnaire does not offer its optional questions (they would save a
   * second lead).
   */
  readonly updatesInterviews?: boolean;
}

export interface Article {
  id: string;
  /**
   * The article's address, `/blog/<slug>`, in Latin kebab-case. Only the
   * Supabase store has one (Base44's BlogPost does not), so a build reading
   * Base44 links by `id`. Build links with `articlePath()`, never by hand.
   */
  slug?: string;
  title: string;
  excerpt?: string;
  body?: string;
  image_url?: string;
  tags?: string;
  /** How long acting on the article takes, as a reader would say it ("רבע שעה"). */
  action_time?: string;
  /**
   * The headline of the article's contact boxes (src/lib/articleCta.ts); unset,
   * the general line. Supabase only, like `slug`.
   */
  cta_headline?: string;
  /** The image shared links show (og:image / twitter:image); unset, `image_url`, then the portrait. Supabase only. */
  og_image?: string;
  published?: boolean;
  created_date: string;
}

export interface Testimonial {
  id: string;
  name: string;
  role?: string;
  quote: string;
  image_url?: string;
  rating?: number;
  source?: string;
  created_date: string;
}

/** Reading published content. */
export interface ContentPort {
  listArticles(limit?: number): Promise<Article[]>;
  getArticle(id: string): Promise<Article>;
  listTestimonials(limit?: number): Promise<Testimonial[]>;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  tool_calls?: unknown[];
  /** Set by the chat function's adapter on the reply that saved the interview's lead. */
  signal?: "lead_saved";
  /** The lead was saved but the model's reply was lost: the content is the adapter's own confirmation. */
  replyMissing?: true;
}

export interface AgentConversation {
  id: string;
}

export interface AgentSendOptions {
  signal?: AbortSignal;
}

/** Driving one of the on-site LLM agents. */
export interface AgentPort {
  start(agentName: string, metadata?: Record<string, unknown>): Promise<AgentConversation>;
  /**
   * `signal` abandons the send (the panel was reset or closed): the chat
   * function's adapter stops its request and its status polling and publishes
   * nothing more. Base44's adapter has nothing to stop and ignores it.
   */
  send(conversation: AgentConversation, text: string, options?: AgentSendOptions): Promise<void>;
  subscribe(conversationId: string, onMessages: (messages: AgentMessage[]) => void): () => void;
}

/**
 * Reasons an automated conversation must stop and become a human one.
 * Mirrors `Lead.escalation_reason` and the list the agents are given.
 */
export type EscalationReason =
  | "regulated_advice"
  | "product_recommendation"
  | "numbers_or_returns"
  | "claim_or_policy"
  | "complaint"
  | "privacy_request"
  | "sensitive_data"
  | "out_of_scope"
  | "user_request"
  | "uncertain";

export interface EscalationRequest {
  reason: EscalationReason;
  /** Plain-language summary of what the visitor needs. Never sensitive data. */
  summary: string;
  /** Which on-site agent was talking, for audit. */
  agent?: string;
  name?: string;
  phone?: string;
  email?: string;
  consentVersion?: string;
  consentAt?: string;
  /** Marketing channel attribution — see src/lib/attribution.ts. Never PII. */
  channel?: string;
  campaign?: string;
  landingPath?: string;
}

export interface HumanContact {
  phoneDisplay: string;
  phoneE164: string;
  whatsapp: string;
  email: string;
}

export interface EscalationReceipt {
  ok: boolean;
  /** True when the enquiry was written to the lead store, not only emailed. */
  recorded?: boolean;
  contact: HumanContact;
  acknowledgement: string;
  warnings?: string[];
}

/**
 * Handing a conversation to a person.
 *
 * Separate from LeadPort on purpose: escalation is the one path that must keep
 * working when everything else fails, and it is the only path a component may
 * trigger without the visitor having filled in a form.
 */
export interface SupportPort {
  escalate(request: EscalationRequest): Promise<EscalationReceipt>;
}

/** Uploading a document from the claim form. */
export interface UploadPort {
  upload(file: File): Promise<{ url: string }>;
}
/* ─────────────────────────────────────────────────────────────────────────
 * Admin surface
 *
 * The ports above describe what a *visitor* can do: submit an enquiry, read
 * published content. These describe what the site owner can do once signed in,
 * and they are deliberately separate interfaces rather than extra methods on
 * the public ones — `ContentPort.listArticles` must stay incapable of returning
 * a draft, and nothing a public page can reach should be able to delete a lead.
 *
 * Segregating them is also what makes the admin screens testable against a fake
 * instead of a mocked vendor module, which is the reason they were the last
 * three files still importing the SDK directly.
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * `client`: the enquiry became an engagement. The nightly retention job
 * (20261025000000_lead_retention.sql) anonymizes every other lead 24 months
 * after its last contact, as the privacy policy promises, and never a client.
 */
export type LeadStatus = "new" | "contacted" | "closed" | "client";

/** A lead as stored, which is not the shape that was submitted: the store adds
 *  an id, a received timestamp and a status the owner moves through. */
export interface LeadRecord {
  id: string;
  name: string;
  phone: string;
  email?: string;
  source: LeadSource;
  topic?: string;
  timing?: string;
  message?: string;
  status: LeadStatus;
  created_date: string;
  /** The lead's agency, and who works it — null while it waits in the "לא שויכו" queue. */
  agency_id?: string | null;
  assigned_user_id?: string | null;
}

/** Managing received enquiries. Every method here touches personal data. */
/** One line of a chat transcript as Dorit reads it: the visitor's words and the agent's, already redacted. */
export interface TranscriptLine {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface LeadAdminPort {
  list(limit?: number): Promise<LeadRecord[]>;
  setStatus(id: string, status: LeadStatus): Promise<void>;
  remove(id: string): Promise<void>;
  /**
   * A link that opens one of a claim's documents. A Base44 file URL is already
   * one; a Supabase Storage reference (`storage:claim-documents/…`) is signed
   * for a few minutes by the claim-document-link function, for whoever may see
   * that lead — so a link copied out of the screen stops working rather than
   * lasting for years.
   */
  documentLink(ref: string, leadId: string): Promise<string>;
  /** Give the lead to a member of its agency, or back to the queue (null). Admin+ (assign-lead). */
  assign(leadId: string, userId: string | null): Promise<{ mailed: boolean }>;
  /** Open leads nobody works yet — the Admin's menu counter. Ids only. */
  countUnassigned(): Promise<number>;
  /** The interview behind a lead, if it came from the chat function; [] otherwise. Read-only. */
  transcript(leadId: string): Promise<TranscriptLine[]>;
  /** The ids of the leads that have a conversation behind them — the screen shows the tab for these and no others. */
  transcriptLeadIds(): Promise<string[]>;
  /** How many leads are still `new` — the admin menu's counter. Ids only: no personal data leaves the table for it. */
  countNew(): Promise<number>;
}

/** One of a user's organizations — a row of `memberships` with its agency's name. */
export interface AdminUserMembership {
  orgId: string;
  orgName: string;
  /** The user's role in that organization: owner, admin or user. */
  role: string;
  joinedAt: string;
}

/** A signed-in account, as the users screen lists it. */
export interface AdminUser {
  id: string;
  email: string | null;
  /** The site-wide role (`profiles.role`). */
  role: "admin" | "user";
  createdAt: string;
  /** Oldest first: the first is the user's primary organization. */
  memberships: AdminUserMembership[];
}

/** The admin's view of the accounts. Read-only; every row is personal data. */
export interface UsersAdminPort {
  list(): Promise<AdminUser[]>;
  /** Every organization, members or not — the invitation offers each. */
  organizations(): Promise<AdminOrganization[]>;
  /** Adds `email` to an organization in a role, making the account if needed, and mails the invitation (invite-user). */
  invite(input: InviteInput): Promise<InviteResult>;
  /**
   * The members screen's changes, through member-admin under the caller's own
   * session; the database decides who may do which (set_member_role / remove_member).
   */
  setRole(agencyId: string, userId: string, role: AgencyRole): Promise<void>;
  /** Their leads in the agency go back to the unassigned queue. */
  remove(agencyId: string, userId: string): Promise<void>;
  leave(agencyId: string): Promise<void>;
  /** Make `userId` the Owner, then step the caller down to Admin. */
  transferOwnership(agencyId: string, userId: string): Promise<void>;
}

/** owner > admin > user — src/config/permissions.ts holds what each may do. */
export type AgencyRole = "owner" | "admin" | "user";

/** One agency the signed-in person belongs to. */
export interface MyAgency {
  id: string;
  name: string;
  role: AgencyRole;
}

/** The agency's public details (agency_profiles) — the Owner's to edit. */
export interface AgencyProfile {
  agencyId: string;
  displayName: string;
  phoneE164: string;
  phoneDisplay: string;
  whatsapp: string;
  email: string;
  defaultWhatsappMessage: string;
  licenceEntity: string;
  licenceNumber: string;
  licenceRegulator: string;
}

/** Who the signed-in person is in their agencies, and the agency's own details. */
export interface AgencyPort {
  /** Every agency the person is a member of, with their role — the switcher's list. */
  myAgencies(userId: string): Promise<MyAgency[]>;
  /** The person's role in one active agency, or null. Chooses screens; decides nothing. */
  myRole(agencyId: string): Promise<AgencyRole | null>;
  profile(agencyId: string): Promise<AgencyProfile | null>;
  /** Owner (or operator) only — the policy refuses anyone else, and an empty answer is an error. */
  updateProfile(agencyId: string, fields: Partial<Omit<AgencyProfile, "agencyId">>): Promise<void>;
}

export interface AdminOrganization {
  id: string;
  name: string;
}

export interface InviteInput {
  email: string;
  orgId: string;
  role: AgencyRole;
}

export interface InviteResult {
  /** A new account was made for the address; false when it had signed in, or been invited, before. */
  created: boolean;
  /** The invitation mail went. The membership stands either way. */
  mailed: boolean;
}

export interface ArticleDraft {
  title: string;
  /**
   * Required to create an article. Stored in the Supabase mirror only:
   * `contentAdmin` keeps it out of the Base44 write, whose entity has no such field.
   */
  slug?: string;
  excerpt?: string;
  body: string;
  image_url?: string;
  tags?: string;
  published: boolean;
}

export interface TestimonialDraft {
  name: string;
  role?: string;
  quote: string;
  image_url?: string;
  rating?: number;
  source?: string;
}

/**
 * Managing content, published or not.
 *
 * `listArticles` here returns drafts as well, which is exactly what
 * `ContentPort.listArticles` must never do — the same verb on two ports
 * answering to two different audiences.
 */
export interface ContentAdminPort {
  listArticles(limit?: number): Promise<Article[]>;
  /**
   * Returns the new row's id.
   *
   * It used to return nothing, which was fine while one store existed. The id
   * is what ties the two copies together: `contentAdmin` writes Base44 first
   * and stamps the id it gets back into Supabase's `base44_id`, so a row
   * created during the migration is one row and not two unrelated ones.
   */
  createArticle(draft: ArticleDraft): Promise<string>;
  updateArticle(id: string, draft: Partial<ArticleDraft>): Promise<void>;
  removeArticle(id: string): Promise<void>;

  listTestimonials(limit?: number): Promise<Testimonial[]>;
  createTestimonial(draft: TestimonialDraft): Promise<string>;
  removeTestimonial(id: string): Promise<void>;
}

/* ─────────────────────────────────────────────────────────────────────────
 * Auth
 *
 * What the app needs to know about the signed-in owner, and nothing about
 * how Base44 stores the token. `AuthContext` was the last first-party module
 * besides the composition root importing the SDK singleton; behind this port
 * a test can render the admin guards against a fake instead of mocking the
 * vendor module. The sign-in screens themselves (login, register, password
 * reset) are Base44's own flow and keep talking to the SDK directly.
 * ───────────────────────────────────────────────────────────────────────── */

export interface AuthUser {
  id?: string;
  email?: string;
  full_name?: string;
  /** "admin" unlocks /admin/*; anything else is a signed-in visitor. */
  role?: string;
  [key: string]: unknown;
}

/** An SDK error carries an HTTP status and, on 403, a reason the app reads. */
export interface AuthFailure {
  status?: number;
  message?: string;
  data?: { extra_data?: { reason?: string } };
}

export interface AuthPort {
  /** True when a token is stored, i.e. `me()` has a chance of succeeding. */
  hasStoredToken(): boolean;
  /** App-level reachability check; rejects with an AuthFailure on 403. */
  getPublicSettings(): Promise<unknown>;
  /** The signed-in user, or a rejection when the token is missing or stale. */
  me(): Promise<AuthUser>;
  /** Clears the stored token; with a URL, also sends the browser there. */
  logout(redirectUrl?: string): void;
  redirectToLogin(returnUrl: string): void;
  /**
   * Start a Google sign-in, returning to `returnUrl`.
   *
   * Distinct from `redirectToLogin`, which hands off to whatever sign-in screen
   * the provider hosts. This is the button on our own login page, and it exists
   * on the port so that switching provider switches what the button does —
   * while it called the SDK directly, flipping VITE_AUTH_PROVIDER changed who
   * answered `me()` and left the visitor signing in to the old system.
   */
  /** Starts Google's sign-in; rejects when it could not start, so the page can say so. */
  signInWithGoogle(returnUrl: string): Promise<void>;
  /**
   * Sign in with an address and a password.
   *
   * Rejects with the provider's message so the form can show it. Unlike the
   * Google path this does not navigate: the caller owns the destination, which
   * is the guarded `returnTo`, and keeping the redirect in one place keeps the
   * open-redirect guard covering both routes in.
   *
   * There is no sign-up beside it on purpose. Accounts into a system holding
   * customer enquiries are provisioned, not self-served.
   */
  signInWithPassword(email: string, password: string): Promise<void>;
}

export interface Enquiry {
  createdAt: string;
  source: string;
  track?: string;
  trackLabel?: string;
  meetingTopic?: string;
  timing?: string;
  scheduledAt?: string;
  summary?: string;
  /** `[label, value]` pairs as the summary mail shows them; empty when none was stored. */
  profile: Array<[string, string]>;
  completed: boolean;
  inCalendar: boolean;
}

export interface AccountPort {
  /** The signed-in user's enquiries, newest first. Rejects with `AccountLoadError`. */
  myEnquiries(): Promise<Enquiry[]>;
  /** The snapshot Dorit published to the signed-in user's verified address, or null. Rejects with `AccountLoadError`. */
  mySnapshot(): Promise<ClientSnapshot | null>;
  /** "כן, לטפל בזה" / "יש לי שאלה" (or back to open) on one of the user's own recommendations. */
  respondToRecommendation(itemId: string, status: ClientAnswer, note?: string): Promise<void>;
}

export type RecommendationPriority = "important" | "check";
export type ClientAnswer = "open" | "accepted" | "question";

/** A recommendation as published to the client: a frozen copy of what Dorit approved. */
export interface PublishedRecommendation {
  id: string;
  title: string;
  body: string;
  priority: RecommendationPriority;
  clientStatus: ClientAnswer;
  clientNote: string | null;
}

/** What the personal area shows: exactly the fields `my_snapshot()` returns. */
export interface ClientSnapshot {
  takenAt: string;
  publishedAt: string;
  snapshot: Snapshot;
  items: PublishedRecommendation[];
}

/** The staff's view of a published item, with the client's answer and whether Dorit saw it. */
export interface StaffPublishedItem extends PublishedRecommendation {
  position: number;
  clientUpdatedAt: string | null;
  staffSeenAt: string | null;
}

export interface PublishItem {
  title: string;
  body: string;
  priority: RecommendationPriority;
}

export class AccountLoadError extends Error {
  constructor(readonly reason: "signed_out" | "unverified" | "failed", readonly rid?: string) {
    super(reason);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * The clearinghouse request pipeline (PR A).
 *
 * The public page calls `submitCode`; the staff board calls the rest.
 * Everything that changes a request is an Edge Function, which checks who is
 * asking on every call; the browser itself only reads, and only the columns
 * the migration grants — never a ciphertext or a token hash.
 * ───────────────────────────────────────────────────────────────────────── */

/** A clearinghouse staff member's role is their agency role. */
export type StaffRole = AgencyRole;
export type MaslekaStatus = "invited" | "code_received" | "submitted" | "completed" | "expired" | "cancelled";
export type MaslekaField = "id" | "code";

export interface MaslekaRequest {
  id: string;
  clientName: string;
  contactEmail: string | null;
  status: MaslekaStatus;
  leadId: string | null;
  /** Kept after the wipe, for matching a downloaded file (PR B). */
  idLast4: string | null;
  createdAt: string;
  tokenExpiresAt: string | null;
  clientInvitedAt: string | null;
  codeReceivedAt: string | null;
  submittedAt: string | null;
  /** When the clearinghouse deletes the download: business day 7 after submission. */
  clearinghouseDeletesAt: string | null;
  completedAt: string | null;
}

/** A link to the client's page, shown once to the staff member who asked for it. */
export interface MaslekaLink {
  requestId: string;
  link: string;
  /** Whether it also went to the client by mail. */
  invited: boolean;
}

export interface NewMaslekaRequest {
  clientName: string;
  contactEmail?: string;
  sendInvite: boolean;
}

export type MaslekaFailure =
  | "disabled"
  | "link_invalid"
  | "bad_id"
  | "bad_code"
  /** A second הגשתי: a state to show ("כבר סומן כהוגש"), not an error (Ruling 18). */
  | "already_submitted"
  | "rate_limited"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "not_available"
  | "invalid"
  | "invalid_name"
  | "invalid_email"
  | "unavailable"
  /** The client's send stored nothing: say so, and that sending again is right (decision 2026-10-14). */
  | "not_saved"
  | "failed";

export class MaslekaError extends Error {
  constructor(readonly reason: MaslekaFailure, readonly rid?: string) {
    super(reason);
  }
}

export interface MaslekaPort {
  /** The client's page: the link's token, their code and their ID. */
  submitCode(token: string, code: string, idNumber: string): Promise<void>;
  /** Requests still on the board (invited, waiting, submitted, completed), newest first. */
  list(): Promise<MaslekaRequest[]>;
  create(input: NewMaslekaRequest): Promise<MaslekaLink>;
  /** A fresh link for a request still waiting for its code. */
  relink(requestId: string): Promise<MaslekaLink>;
  /** One decrypted value, logged server-side. */
  reveal(requestId: string, field: MaslekaField): Promise<string>;
  /** הגשתי: wipes the code and the ID. */
  markSubmitted(requestId: string): Promise<void>;
  /** Parsed reports kept for analysis, newest first. */
  listSnapshots(): Promise<SnapshotSummary[]>;
  /** One report, checked by `readSnapshot`; null when it is gone or unreadable. */
  getSnapshot(snapshotId: string): Promise<StoredSnapshot | null>;
  /** Dorit's decisions on a report's findings. A finding with none is a draft. */
  listReviews(snapshotId: string): Promise<FindingReview[]>;
  /** Approve (optionally in her own words) or reject a finding; null puts it back to draft. */
  decide(snapshotId: string, findingKey: string, decision: ReviewDecision | null): Promise<void>;
  /** The items published from a snapshot, with the client's answers. */
  listPublishedItems(snapshotId: string): Promise<StaffPublishedItem[]>;
  /** Publish (or republish) to the client's personal area. A republish replaces the items. */
  publish(snapshotId: string, clientEmail: string, items: PublishItem[]): Promise<void>;
  unpublish(snapshotId: string): Promise<void>;
  markAnswersSeen(snapshotId: string): Promise<void>;
}

export interface SnapshotSummary {
  id: string;
  requestId: string | null;
  clientName: string;
  takenAt: string;
}

export interface StoredSnapshot extends SnapshotSummary {
  snapshot: Snapshot;
  /** Who it is (or would be) published to, and when it was; null while unpublished. */
  clientEmail: string | null;
  publishedAt: string | null;
}

export type ReviewStatus = "approved" | "rejected";

export interface ReviewDecision {
  status: ReviewStatus;
  /** Dorit's wording; null keeps the draft's. */
  finalText: string | null;
  /** Her title — a rule's finding keeps its own when null; a recommendation of her own needs one. */
  title?: string | null;
  /** Her priority — a rule's finding takes it from its severity when null. */
  priority?: RecommendationPriority | null;
}

export interface FindingReview extends ReviewDecision {
  findingKey: string;
  reviewedAt: string;
}
