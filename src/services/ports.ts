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

export type LeadSource = "quick" | "detailed" | "consultation" | "claim" | "escalation";

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