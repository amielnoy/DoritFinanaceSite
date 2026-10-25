import { toast } from "@/components/ui/use-toast";
import { RestTableClient } from "./supabase/RestTableClient";
import { defaultSessionPresent } from "./supabase/SupabaseAuthService";
import { SupabaseContentService } from "./supabase/SupabaseContentService";
import { AgencyContentError, SupabaseAgencyContentService } from "./supabase/SupabaseAgencyContentService";
import type {
  AccountPort,
  AgencyContentPort,
  AgentPort,
  AuthPort,
  ContentAdminPort,
  ContentPort,
  LeadAdminPort,
  UsersAdminPort,
  AgencyPort,
  LeadPort,
  MaslekaPort,
  SupportPort,
  UploadPort,
} from "./ports";

/**
 * The services the app talks to — a light front for `./composition.ts`.
 *
 * `composition.ts` is the composition root: the one place that names concrete
 * implementations, and the one that imports both SDKs. Imported eagerly, it put
 * `@supabase/supabase-js` and `@base44/sdk` (~100 KB gzipped together) on the
 * critical path of every page, modulepreloaded ahead of the hero — while an
 * anonymous visitor reading the home page calls neither.
 *
 * So this module exposes the same `services` object, but each port loads the
 * composition root on its first real call and delegates to it. A visitor who
 * submits a form, opens a chat or signs in pays for the SDKs at that moment;
 * one who only reads never does. Two things are answered here, without it:
 *
 *   - `auth.hasStoredToken()` and `auth.getPublicSettings()`, which AuthContext
 *     calls on every page load. Both were already SDK-free (a localStorage
 *     probe and a constant), so they keep their exact answers. A visitor with
 *     no session never reaches `me()`, and so never loads the SDK.
 *   - Public content reads (testimonials, articles), over `RestTableClient` —
 *     the same anonymous PostgREST query the SDK made, sent with `fetch`.
 *
 * Every method that returns a Promise keeps its signature. The few `void` ones
 * (redirects) and `agents.subscribe` start the load and act when it lands.
 */
export interface Services {
  leads: LeadPort;
  content: ContentPort;
  /** The agency a host belongs to, and what its public pages show of it (VITE_AGENCY_CONTENT). */
  agencyContent: AgencyContentPort;
  agents: AgentPort;
  /** Public images — blog covers, testimonial photos. */
  uploads: UploadPort;
  /** A claim's documents: private, and never mixed with the public images. */
  claimDocuments: UploadPort;
  support: SupportPort;
  /** Who is signed in. Read by the route guards and the owner-only controls. */
  auth: AuthPort;
  /** Owner-only surfaces, behind the same object as the public ports. */
  leadsAdmin: LeadAdminPort;
  contentAdmin: ContentAdminPort;
  /** The signed-in visitor's own enquiries — the personal area. */
  account: AccountPort;
  /** The accounts and their organizations — the admin's users screen. */
  usersAdmin: UsersAdminPort;
  /** Who the signed-in person is in their agencies, and the agency's own details. */
  agency: AgencyPort;
  /** The clearinghouse requests: the client's page and the staff board. */
  masleka: MaslekaPort;
}

let loading: Promise<Services> | null = null;

/** The real services, loading the composition root once. A failed chunk load is retried next time. */
function real(): Promise<Services> {
  loading ??= import("./composition").then(
    (m) => m.services,
    (e: unknown) => {
      loading = null;
      throw e;
    },
  );
  return loading;
}

/** Start loading the SDKs ahead of need — e.g. when a form or chat first comes into view. */
export function preloadServices(): void {
  void real().catch(() => {});
}

/**
 * For the `void` methods: act once loaded, and never leave a rejection unhandled.
 *
 * Sign-out and the sign-in redirects return nothing to await, so when the load
 * fails there is no caller to tell — the visitor clicks and nothing happens.
 * The toast is the only way that failure can reach them.
 */
function later(run: (s: Services) => void): void {
  real()
    .then(run)
    .catch((e) => {
      console.error("services failed to load:", e);
      toast({
        variant: "destructive",
        title: "לא הצלחנו להשלים את הפעולה",
        description: "בדקו את החיבור לאינטרנט ונסו שוב.",
      });
    });
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
/** Mirrors `@/api/supabaseClient`: Supabase is in use exactly when both are set. */
const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

const content: ContentPort = supabaseConfigured
  ? new SupabaseContentService(new RestTableClient(SUPABASE_URL as string, SUPABASE_KEY as string))
  : {
      listArticles: (limit) => real().then((s) => s.content.listArticles(limit)),
      getArticle: (id) => real().then((s) => s.content.getArticle(id)),
      listTestimonials: (limit, agencyId) => real().then((s) => s.content.listTestimonials(limit, agencyId)),
    };

/**
 * Like `content`, read over `RestTableClient` without loading an SDK. Without
 * Supabase there is no agency content to read, and the composition root would
 * answer the same refusal, so this one never loads it: the pages show the
 * bundled agency-1 constants.
 */
const agencyContent: AgencyContentPort = supabaseConfigured
  ? new SupabaseAgencyContentService(new RestTableClient(SUPABASE_URL as string, SUPABASE_KEY as string))
  : {
      siteContent: () => Promise.reject(new AgencyContentError("no_site")),
      successCases: () => Promise.reject(new AgencyContentError("no_site")),
    };

const auth: AuthPort = {
  // Same answers as SupabaseAuthService / UnconfiguredAuthService, without loading either SDK.
  hasStoredToken: () => (supabaseConfigured ? defaultSessionPresent() : false),
  getPublicSettings: async () => ({}),
  me: () => real().then((s) => s.auth.me()),
  signInWithPassword: (email, password) => real().then((s) => s.auth.signInWithPassword(email, password)),
  logout: (redirectUrl) => later((s) => s.auth.logout(redirectUrl)),
  redirectToLogin: (returnUrl) => later((s) => s.auth.redirectToLogin(returnUrl)),
  signInWithGoogle: (returnUrl) => real().then((s) => s.auth.signInWithGoogle(returnUrl)),
};

const agents: AgentPort = {
  start: (agentName, metadata) => real().then((s) => s.agents.start(agentName, metadata)),
  send: (conversation, text, options) => real().then((s) => s.agents.send(conversation, text, options)),
  subscribe: (conversationId, onMessages) => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    later((s) => {
      if (!cancelled) unsubscribe = s.agents.subscribe(conversationId, onMessages);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  },
};

export const services: Services = {
  leads: {
    submitLead: (lead) => real().then((s) => s.leads.submitLead(lead)),
    submitClaim: (report) => real().then((s) => s.leads.submitClaim(report)),
    requestConsultationEvent: (lead) => real().then((s) => s.leads.requestConsultationEvent(lead)),
    submitInterview: (summary) => real().then((s) => s.leads.submitInterview(summary)),
  },
  content,
  agencyContent,
  agents,
  uploads: {
    upload: (file) => real().then((s) => s.uploads.upload(file)),
  },
  claimDocuments: {
    upload: (file) => real().then((s) => s.claimDocuments.upload(file)),
  },
  support: {
    escalate: (request) => real().then((s) => s.support.escalate(request)),
  },
  auth,
  leadsAdmin: {
    list: (limit) => real().then((s) => s.leadsAdmin.list(limit)),
    setStatus: (id, status) => real().then((s) => s.leadsAdmin.setStatus(id, status)),
    remove: (id) => real().then((s) => s.leadsAdmin.remove(id)),
    createLead: (input) => real().then((s) => s.leadsAdmin.createLead(input)),
    clearDuplicate: (leadId) => real().then((s) => s.leadsAdmin.clearDuplicate(leadId)),
    mergeLeads: (primaryId, otherIds) => real().then((s) => s.leadsAdmin.mergeLeads(primaryId, otherIds)),
    unmergeLead: (leadId) => real().then((s) => s.leadsAdmin.unmergeLead(leadId)),
    leadEvents: (leadId) => real().then((s) => s.leadsAdmin.leadEvents(leadId)),
    addLeadNote: (leadId, text) => real().then((s) => s.leadsAdmin.addLeadNote(leadId, text)),
    setFollowUp: (leadId, on) => real().then((s) => s.leadsAdmin.setFollowUp(leadId, on)),
    documentLink: (ref, leadId) => real().then((s) => s.leadsAdmin.documentLink(ref, leadId)),
    assign: (leadId, userId) => real().then((s) => s.leadsAdmin.assign(leadId, userId)),
    countUnassigned: () => real().then((s) => s.leadsAdmin.countUnassigned()),
    transcript: (leadId) => real().then((s) => s.leadsAdmin.transcript(leadId)),
    transcriptLeadIds: () => real().then((s) => s.leadsAdmin.transcriptLeadIds()),
    countNew: () => real().then((s) => s.leadsAdmin.countNew()),
    countOpenMeetingRequests: () => real().then((s) => s.leadsAdmin.countOpenMeetingRequests()),
    meetings: (leadId) => real().then((s) => s.leadsAdmin.meetings(leadId)),
    agencyMeetings: (agencyId) => real().then((s) => s.leadsAdmin.agencyMeetings(agencyId)),
    addMeeting: (meeting) => real().then((s) => s.leadsAdmin.addMeeting(meeting)),
    updateMeeting: (id, update) => real().then((s) => s.leadsAdmin.updateMeeting(id, update)),
    handleMeetingRequest: (requestId) => real().then((s) => s.leadsAdmin.handleMeetingRequest(requestId)),
  },
  contentAdmin: {
    listArticles: (limit) => real().then((s) => s.contentAdmin.listArticles(limit)),
    createArticle: (draft) => real().then((s) => s.contentAdmin.createArticle(draft)),
    updateArticle: (id, draft) => real().then((s) => s.contentAdmin.updateArticle(id, draft)),
    removeArticle: (id) => real().then((s) => s.contentAdmin.removeArticle(id)),
    listTestimonials: (limit) => real().then((s) => s.contentAdmin.listTestimonials(limit)),
    createTestimonial: (draft) => real().then((s) => s.contentAdmin.createTestimonial(draft)),
    removeTestimonial: (id) => real().then((s) => s.contentAdmin.removeTestimonial(id)),
  },
  usersAdmin: {
    list: () => real().then((s) => s.usersAdmin.list()),
    organizations: () => real().then((s) => s.usersAdmin.organizations()),
    invite: (input) => real().then((s) => s.usersAdmin.invite(input)),
    setRole: (agencyId, userId, role) => real().then((s) => s.usersAdmin.setRole(agencyId, userId, role)),
    remove: (agencyId, userId) => real().then((s) => s.usersAdmin.remove(agencyId, userId)),
    leave: (agencyId) => real().then((s) => s.usersAdmin.leave(agencyId)),
    transferOwnership: (agencyId, userId) => real().then((s) => s.usersAdmin.transferOwnership(agencyId, userId)),
  },
  agency: {
    myAgencies: (userId) => real().then((s) => s.agency.myAgencies(userId)),
    myRole: (agencyId) => real().then((s) => s.agency.myRole(agencyId)),
    profile: (agencyId) => real().then((s) => s.agency.profile(agencyId)),
    updateProfile: (agencyId, fields) => real().then((s) => s.agency.updateProfile(agencyId, fields)),
  },
  account: {
    myEnquiries: () => real().then((s) => s.account.myEnquiries()),
    mySnapshot: () => real().then((s) => s.account.mySnapshot()),
    respondToRecommendation: (itemId, status, note) => real().then((s) => s.account.respondToRecommendation(itemId, status, note)),
    myMeetings: () => real().then((s) => s.account.myMeetings()),
    requestMeetingChange: (meetingId, kind, note) => real().then((s) => s.account.requestMeetingChange(meetingId, kind, note)),
  },
  masleka: {
    submitCode: (token, code, idNumber) => real().then((s) => s.masleka.submitCode(token, code, idNumber)),
    list: () => real().then((s) => s.masleka.list()),
    create: (input) => real().then((s) => s.masleka.create(input)),
    relink: (requestId) => real().then((s) => s.masleka.relink(requestId)),
    reissue: (requestId) => real().then((s) => s.masleka.reissue(requestId)),
    reveal: (requestId, field) => real().then((s) => s.masleka.reveal(requestId, field)),
    markSubmitted: (requestId) => real().then((s) => s.masleka.markSubmitted(requestId)),
    listSnapshots: () => real().then((s) => s.masleka.listSnapshots()),
    getSnapshot: (snapshotId) => real().then((s) => s.masleka.getSnapshot(snapshotId)),
    listReviews: (snapshotId) => real().then((s) => s.masleka.listReviews(snapshotId)),
    decide: (snapshotId, findingKey, decision) => real().then((s) => s.masleka.decide(snapshotId, findingKey, decision)),
    listPublishedItems: (snapshotId) => real().then((s) => s.masleka.listPublishedItems(snapshotId)),
    publish: (snapshotId, clientEmail, items) => real().then((s) => s.masleka.publish(snapshotId, clientEmail, items)),
    unpublish: (snapshotId) => real().then((s) => s.masleka.unpublish(snapshotId)),
    markAnswersSeen: (snapshotId) => real().then((s) => s.masleka.markAnswersSeen(snapshotId)),
  },
};

export * from "./ports";
