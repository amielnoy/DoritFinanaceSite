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
}

export interface SubmissionReceipt {
  ok: boolean;
  leadId?: string | null;
  /** Non-fatal problems the backend reported, e.g. a notification that failed. */
  warnings?: string[];
}

/** Submitting an enquiry. The only write path the public site has. */
export interface LeadPort {
  submitLead(lead: Lead): Promise<SubmissionReceipt>;
  submitClaim(report: ClaimReport): Promise<SubmissionReceipt>;
  /** Best-effort calendar holds. Failure here must never fail a submission. */
  requestConsultationEvent(lead: Lead): Promise<void>;
}

export interface Article {
  id: string;
  title: string;
  excerpt?: string;
  body?: string;
  image_url?: string;
  tags?: string;
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
}

export interface AgentConversation {
  id: string;
}

/** Driving one of the on-site LLM agents. */
export interface AgentPort {
  start(agentName: string, metadata?: Record<string, unknown>): Promise<AgentConversation>;
  send(conversation: AgentConversation, text: string): Promise<void>;
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

export type LeadStatus = "new" | "contacted" | "closed";

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
}

/** Managing received enquiries. Every method here touches personal data. */
export interface LeadAdminPort {
  list(limit?: number): Promise<LeadRecord[]>;
  setStatus(id: string, status: LeadStatus): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface ArticleDraft {
  title: string;
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
   * It used to return nothing, which was fine while one store existed. Under
   * dual-write the id is the only thing tying the two copies together: the
   * shadow is written after the primary and would otherwise have no idea which
   * row it is mirroring, leaving every row created during the migration
   * uncorrelated — precisely the rows reconciliation has to check.
   */
  createArticle(draft: ArticleDraft): Promise<string>;
  updateArticle(id: string, draft: Partial<ArticleDraft>): Promise<void>;
  removeArticle(id: string): Promise<void>;

  listTestimonials(limit?: number): Promise<Testimonial[]>;
  createTestimonial(draft: TestimonialDraft): Promise<string>;
  removeTestimonial(id: string): Promise<void>;
}

/**
 * A store that can stand behind another one.
 *
 * The shadow is handed the primary's id for every id-bearing operation, because
 * the ids are not shared: Base44 mints its own and Postgres mints a uuid, so a
 * row has two identities and only the correlation column joins them. A shadow
 * asked to delete "the row with the primary's id" must translate before it can
 * act, or the delete silently matches nothing and the stores drift apart
 * exactly where the migration claims they agree.
 */
export interface ShadowWritePort extends ContentAdminPort {
  /** Create, recording which row in the primary this one mirrors. */
  createArticleMirroring(primaryId: string, draft: ArticleDraft): Promise<void>;
  createTestimonialMirroring(primaryId: string, draft: TestimonialDraft): Promise<void>;
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
}
