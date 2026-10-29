import type { ClientMeeting, MeetingKind, MeetingMode, MeetingRequestKind, MeetingStatus } from "@/lib/meetings";

export type { ClientMeeting };
import type { Intake, NoticeMethod, Product } from "@/lib/staff-lead-types";
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
  | "interview"
  | "staff";

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
  /**
   * Newest first. `agencyId` narrows the list to one agency; without it the
   * request is the one the site has always sent (until Rollout 5, which makes
   * the filter unconditional together with a public read of other agencies').
   */
  listTestimonials(limit?: number, agencyId?: string): Promise<Testimonial[]>;
}

/** How a visitor reaches an agency: the header, the footer and the contact buttons. */
export interface AgencyContact {
  phoneE164: string;
  phoneDisplay: string;
  whatsapp: string;
  email: string;
  defaultWhatsappMessage: string;
}

/** The texts of an agent's about section; `headline` is the hero's lead and is required. */
export type BioKey = "headline" | "family" | "credentials" | "career" | "insight" | "unique" | "signature";

/** An agency's first agent, as `public_agent_cards` shows her. */
export interface AgentCardRecord {
  fullName: string;
  professionalTitle: string | null;
  /** In the public `agent-photos` bucket; see src/lib/portrait.ts. */
  photoPath: string | null;
  photoAlt: string | null;
  /** The verified number. */
  licenceNumber: string;
  bio: Partial<Record<BioKey, string>>;
  stats: { num: string; label: string }[];
  bookingUrl: string | null;
  reviewLinks: { google?: string; midrag?: string };
}

/** What a site shows of the agency its host belongs to. */
export interface AgencySiteRecord {
  agencyId: string;
  contact: AgencyContact;
  agent: AgentCardRecord;
}

/** One of the home page's proof cases. `estimate` puts the basis line under the metric. */
export interface SuccessCase {
  tag: string | null;
  title: string;
  body: string;
  metric: string | null;
  estimate: boolean;
}

/** Reading an agency's public content, by the host the visitor came to. */
export interface AgencyContentPort {
  /** The agency claiming `host`, else agency 1. Rejects rather than answering half a record. */
  siteContent(host: string): Promise<AgencySiteRecord>;
  /** The agency's published cases, in order. */
  successCases(agencyId: string): Promise<SuccessCase[]>;
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
export type LeadStatus = "new" | "contacted" | "meeting_set" | "proposal_sent" | "closed" | "client";

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
  /** Staff-created leads (STAFF_LEADS): who brought it, how it came in, who referred, how the person was told, and whether it may repeat another lead. */
  broughtBy?: string | null;
  intake?: Intake | null;
  referrerNote?: string | null;
  noticeMethod?: NoticeMethod | null;
  possibleDuplicate?: boolean;
  /** Which marketing channel brought the lead ('reactivation': an agency campaign link), and the campaign's code. */
  channel?: string | null;
  campaign?: string | null;
  /** The lead this one was merged into (merge_leads), or null. A merged lead is history: nothing is deleted. */
  mergedInto?: string | null;
  /** The day of the next follow-up (Israel's date, YYYY-MM-DD), or null. */
  nextFollowUpOn?: string | null;
  /** Staff-added clients (STAFF_CLIENTS): opened as a client or as a lead (fixed at insert), since when (YYYY-MM), and the service lines. */
  openedAs?: "lead" | "client";
  clientSince?: string | null;
  products?: Product[] | null;
}

/**
 * "תדריך לפני שיחה" (VITE_LEAD_BRIEFING): the AI's draft for the agent before
 * a call, from the interview alone (lead_briefings, the lead-briefing function).
 */
export interface LeadBriefing {
  id: string;
  /** Up to three lines on the interview. */
  summary: string[];
  /** The client's main concern. */
  concern: string;
  /** Questions to ask on the call. */
  questions: string[];
  /** Service areas worth raising — never a company, product or figure. */
  talkingPoints: string[];
  createdAt: string;
  /** Who asked for it; null for a member since removed. */
  createdBy: string | null;
}

/** One line of a lead's activity log (lead_events). */
export interface LeadEvent {
  id: string;
  kind: "created" | "status" | "assigned" | "note" | "follow_up" | "merged" | "unmerged" | "whatsapp";
  /** Who did it; null for the system (an interview, a job) or a member since removed. */
  actorId: string | null;
  /** The value before and after, for status, assignment and follow-up changes. */
  from: string | null;
  to: string | null;
  /** A note's text. */
  note: string | null;
  at: string;
}

/** A lead a member enters by hand (create-lead Edge Function). */
export interface NewStaffLead {
  agencyId: string;
  name: string;
  phone: string;
  email?: string;
  topic?: string;
  notes?: string;
  intake: Intake;
  referrer?: string;
  status: "new" | "contacted" | "client";
  notice: NoticeMethod;
  /** Admin+: a member's id, "none" for the queue, or absent for the caller themselves. Ignored for a User. */
  assignee?: string | null;
  duplicateOk?: boolean;
  /** "client" (STAFF_CLIENTS): someone who is already a client — since when (YYYY-MM) and the service lines; the status sent is not read. */
  kind?: "lead" | "client";
  clientSince?: string;
  products?: Product[];
}

export interface CreatedLead {
  leadId: string;
  duplicate: "visible" | "hidden" | null;
  noticeSent: boolean | null;
  /** For a client: whether the personal-area invite (an email was given) and a clearinghouse request are open now. */
  next?: { invite: boolean; masleka: boolean };
}

/** Managing received enquiries. Every method here touches personal data. */
/** One line of a chat transcript as Dorit reads it: the visitor's words and the agent's, already redacted. */
export interface TranscriptLine {
  role: "user" | "assistant";
  content: string;
  at: string;
}

/** A meeting on a lead, as staff see it — Dorit's notes included. */
export interface LeadMeeting {
  id: string;
  scheduledAt: string | null;
  durationMin: number | null;
  topic: string;
  kind: MeetingKind;
  status: MeetingStatus;
  mode: MeetingMode | null;
  location: string;
  /** Dorit's working notes: staff only, never shown to the client. */
  notes: string;
  /** What the client will see once published. */
  clientSummary: string;
  summaryPublishedAt: string | null;
  /** 'consultation' or 'interview' for a booking from the site; null for one staff added. */
  source: string | null;
  /** The client's open request to move or cancel it, if any. */
  openRequest: { id: string; kind: MeetingRequestKind; note: string } | null;
}

/**
 * A meeting on the agency's agenda (/admin/leads, "פגישות"): what its card
 * shows, with whose lead it is. Not Dorit's notes nor the summary's text — the
 * agenda shows neither, and opens the lead's drawer for both.
 */
export interface AgendaMeeting extends Omit<LeadMeeting, "notes" | "clientSummary"> {
  leadId: string;
  /** The lead's name as the visitor typed it — plain text. Empty when the lead is out of view. */
  leadName: string;
  assignedUserId: string | null;
}

/** A meeting staff add to a lead (`meetings_insert_lead`). */
export interface NewLeadMeeting {
  leadId: string;
  /** The lead's own agency: the policy refuses any other. */
  agencyId: string;
  scheduledAt: string;
  durationMin: number;
  mode: MeetingMode;
  location: string;
  kind: MeetingKind;
  topic: string;
}

/** What staff change on a meeting. `summaryPublishedAt: null` unpublishes. */
export type LeadMeetingUpdate = Partial<{
  status: MeetingStatus;
  notes: string;
  clientSummary: string;
  summaryPublishedAt: string | null;
}>;

export interface LeadAdminPort {
  list(limit?: number): Promise<LeadRecord[]>;
  setStatus(id: string, status: LeadStatus): Promise<void>;
  remove(id: string): Promise<void>;
  /** A member enters a lead by hand. A 409 (a visible duplicate) resolves with `duplicate: "visible"`; other refusals throw in Hebrew. */
  createLead(input: NewStaffLead): Promise<CreatedLead>;
  /**
   * The lead becomes a client (convert_lead_to_client), with since when
   * (YYYY-MM) and the service lines, under the person's own update rights. A
   * lead merged into another converts its main lead; resolves with that id.
   */
  convertToClient(leadId: string, since: string, products: Product[]): Promise<string>;
  /** Mail a client the personal-area sign-in link (invite-client); its refusal in Hebrew. */
  inviteClient(agencyId: string, leadId: string): Promise<void>;
  /** Mark a possible duplicate as checked (possible_duplicate = false). */
  clearDuplicate(leadId: string): Promise<void>;
  /** Fold `otherIds` into `primaryId` (merge_leads, Admin+). Nothing is deleted; unmergeLead undoes it. Resolves with how many were merged. */
  mergeLeads(primaryId: string, otherIds: string[]): Promise<number>;
  /** Take one merged lead out of its main lead again (unmerge_lead, Admin+). */
  unmergeLead(leadId: string): Promise<void>;
  /** The lead's activity log, newest first. */
  leadEvents(leadId: string): Promise<LeadEvent[]>;
  /** Add a note to the lead's activity log (add_lead_note): whoever may see the lead. */
  addLeadNote(leadId: string, text: string): Promise<void>;
  /** Set or clear the day of the lead's next follow-up: whoever may update the lead. */
  setFollowUp(leadId: string, on: string | null): Promise<void>;
  /** "נשלחה הודעת וואטסאפ" in the lead's log (log_lead_whatsapp) — the fact only, never the number or the text. */
  logWhatsapp(leadId: string): Promise<void>;
  /** The lead's newest briefing, or null. Whoever may see the lead (lead_briefings_read). */
  briefing(leadId: string): Promise<LeadBriefing | null>;
  /** A new briefing from the lead-briefing function; its refusal (off, budget, nothing to brief on) in Hebrew. */
  generateBriefing(leadId: string): Promise<LeadBriefing>;
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
  /** How many leads need someone — `new` or `escalated` — the admin menu's counter. Ids only: no personal data leaves the table for it. */
  countNew(): Promise<number>;
  /** Clients' open requests to move or cancel a meeting — the leads row's second counter. `can_see_lead` is the gate. Ids only. */
  countOpenMeetingRequests(): Promise<number>;
  /** A lead's meetings, newest first, with any open client request. `can_see_lead` is the gate. */
  meetings(leadId: string): Promise<LeadMeeting[]>;
  /**
   * The agency's meetings, newest first, each with its lead's name and
   * assignee and any open client request — the agenda. `can_see_lead` is the
   * gate, so a User gets their assigned leads' meetings only; nothing here
   * filters by role.
   */
  agencyMeetings(agencyId: string): Promise<AgendaMeeting[]>;
  /** Add a meeting to a lead the person can see, as themselves. */
  addMeeting(meeting: NewLeadMeeting): Promise<void>;
  /** Change a meeting; an update row-level security filtered out is an error, not a success. */
  updateMeeting(id: string, update: LeadMeetingUpdate): Promise<void>;
  /** Mark a client's request handled. The meeting itself is changed separately, or not. */
  handleMeetingRequest(requestId: string): Promise<void>;
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
  /** 'draft' and 'pending_review' while the new-agency wizard runs; the switcher sends those to it. */
  status?: "draft" | "pending_review" | "active" | "suspended";
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
  /** The WhatsApp message a member sends a lead, with {name}, {agent} and {topic} (src/lib/lead-whatsapp.ts). */
  leadWhatsappTemplate: string;
}

/** A reactivation campaign: the general link and message an agency sends its existing clients (20261111000000_campaigns.sql). */
export interface Campaign {
  id: string;
  agencyId: string;
  name: string;
  /** The link's utm_campaign, random; a lead from the link carries it as `campaign`. */
  code: string;
  /** The WhatsApp message, with {agent} and {link}; always has an opt-out line. */
  message: string;
  createdBy: string | null;
  createdAt: string;
  archivedAt: string | null;
}

export interface NewCampaign {
  agencyId: string;
  name: string;
  message: string;
}

/** The agency's campaigns: every member reads them, Admin+ writes them. */
export interface CampaignPort {
  list(agencyId: string): Promise<Campaign[]>;
  /** Creates the campaign with a fresh random code. */
  create(input: NewCampaign): Promise<Campaign>;
  /** Renames, rewrites the message, archives or restores. The code never changes. */
  update(id: string, fields: { name?: string; message?: string; archived?: boolean }): Promise<void>;
}

/** A row as its table has it (snake_case); the wizard reaches fields by onboarding.ts's keys. */
export type OnboardingRow = Record<string, unknown>;

/** Everything the wizard edits for one agency (docs/superpowers/specs/2026-10-16-new-agency-wizard-design.md). */
export interface OnboardingRecord {
  agencies: OnboardingRow;
  agency_profiles: OnboardingRow;
  /** The licensee; null until step 1 is first saved. */
  agents: OnboardingRow | null;
  testimonials: OnboardingRow[];
  success_cases: OnboardingRow[];
}

/** A draft or pending agency, as the operator's list shows it. */
export interface OnboardingAgencySummary {
  id: string;
  name: string;
  status: "draft" | "pending_review" | "active" | "suspended";
  /** The profile's updated_at: when someone last saved a step. */
  lastEdited: string | null;
  ownerEmail: string | null;
}

/** The three portrait files, by width, already cropped and re-encoded to WebP. */
export type PortraitFiles = Record<480 | 768 | 1080, Blob>;

/** A save that found the row changed since the step was opened (someone else saved first). */
export class OnboardingConflictError extends Error {
  constructor() {
    super("השלב עודכן בינתיים ממקום אחר. טענו את הגרסה העדכנית — כדאי לבדוק ולשמור שוב.");
    this.name = "OnboardingConflictError";
  }
}

/** The RPCs' refusals the screens act on, with the keys they named. */
export type OnboardingOutcome = { ok: true } | { ok: false; missing: string[]; gates: string[]; message: string };

export interface OnboardingPort {
  /** create_agency (operator): the draft agency's id. */
  createAgency(input: { name: string; ownerEmail: string; dpaDate: string | null }): Promise<string>;
  /** onboarding_role: the caller's membership role in an agency being set up, or null. */
  role(agencyId: string): Promise<"owner" | "admin" | "user" | null>;
  load(agencyId: string): Promise<OnboardingRecord>;
  /** Writes the profile's columns; refuses with OnboardingConflictError when updated_at moved since `expectedUpdatedAt`. */
  saveProfile(agencyId: string, patch: OnboardingRow, expectedUpdatedAt: string | null): Promise<OnboardingRow>;
  /** Creates the licensee when `agentId` is null, else writes its columns under the same conflict rule. */
  saveAgent(agencyId: string, agentId: string | null, patch: OnboardingRow, expectedUpdatedAt: string | null): Promise<OnboardingRow>;
  saveTestimonial(agencyId: string, row: OnboardingRow): Promise<OnboardingRow>;
  deleteTestimonial(id: string): Promise<void>;
  saveSuccessCase(agencyId: string, row: OnboardingRow): Promise<OnboardingRow>;
  deleteSuccessCase(id: string): Promise<void>;
  /**
   * Uploads all three sizes, then points the licensee at them, then removes the
   * previous set — never a path to a missing file. Resolves with the row's new
   * photo_path and updated_at: the write moved it, and the next save of the step
   * must not mistake its own photo for someone else's edit.
   */
  uploadPortrait(agencyId: string, agentId: string, files: PortraitFiles, previousPath: string | null): Promise<{ photoPath: string; updatedAt: string | null }>;
  /** Back to the monogram: the path is cleared first, then the files go. Resolves with the row's new updated_at. */
  removePortrait(agencyId: string, agentId: string, path: string): Promise<{ updatedAt: string | null }>;
  submit(agencyId: string): Promise<OnboardingOutcome>;
  /** Operator: draft and pending agencies, last edited first. */
  listInProgress(): Promise<OnboardingAgencySummary[]>;
  returnAgency(agencyId: string, note: string): Promise<OnboardingOutcome>;
  activate(agencyId: string): Promise<OnboardingOutcome>;
  /** Operator's gates and columns. */
  setDpaDate(agencyId: string, date: string | null): Promise<void>;
  setLicenceVerified(agentId: string, verified: boolean): Promise<void>;
  setDisclosuresApproved(agencyId: string, approved: boolean): Promise<void>;
  setOperatorFields(agencyId: string, fields: { domain?: string | null; mail_from?: string | null; ga4_measurement_id?: string | null }): Promise<void>;
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
  /** The signed-in user's meetings with Dorit (`my_meetings()`), newest first. Rejects with `AccountLoadError`. */
  myMeetings(): Promise<ClientMeeting[]>;
  /** Ask to move or cancel one of the user's own upcoming meetings; Dorit is mailed. The meeting itself is unchanged. */
  requestMeetingChange(meetingId: string, kind: MeetingRequestKind, note?: string): Promise<void>;
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
  /** A lead the caller can see, to hang the request off; absent for one made by hand. */
  leadId?: string;
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
  /**
   * The clearinghouse refused the code: the request goes back to the client —
   * the code and the ID wiped — with a fresh link. Only for one still waiting
   * to be submitted.
   */
  reissue(requestId: string): Promise<MaslekaLink>;
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
