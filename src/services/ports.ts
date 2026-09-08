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
}

export type LeadSource = "quick" | "detailed" | "consultation" | "claim";

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

/** Uploading a document from the claim form. */
export interface UploadPort {
  upload(file: File): Promise<{ url: string }>;
}
