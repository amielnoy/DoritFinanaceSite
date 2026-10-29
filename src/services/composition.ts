import { supabase } from "@/api/supabaseClient";
import { MASLEKA_ENABLED } from "@/config/masleka";
import { SupabaseAccountService, type SupabaseRpcClient } from "./supabase/SupabaseAccountService";
import { SupabaseAuthService, type SupabaseAuthClient } from "./supabase/SupabaseAuthService";
import { SupabaseAgentService } from "./supabase/SupabaseAgentService";
import { SupabaseContentAdminService } from "./supabase/SupabaseContentAdminService";
import { SupabaseContentService } from "./supabase/SupabaseContentService";
import { AgencyContentError, SupabaseAgencyContentService } from "./supabase/SupabaseAgencyContentService";
import { SupabaseImageUploadService, type SupabaseImageStorageClient } from "./supabase/SupabaseImageUploadService";
import { EdgeContentAdminService, type ContentFunctionsClient } from "./supabase/EdgeContentAdminService";
import { SupabaseLeadAdminService } from "./supabase/SupabaseLeadAdminService";
import { SupabaseUsersAdminService } from "./supabase/SupabaseUsersAdminService";
import { SupabaseLeadService, type SupabaseFunctionsClient } from "./supabase/SupabaseLeadService";
import type { SupabaseLeadTableClient } from "./supabase/SupabaseTableClient";
import { SupabaseMaslekaService, type SupabaseMaslekaClient } from "./supabase/SupabaseMaslekaService";
import { SupabaseSupportService } from "./supabase/SupabaseSupportService";
import { SupabaseUploadService, type SupabaseStorageClient } from "./supabase/SupabaseUploadService";
import { UnconfiguredAccountService } from "./unconfigured/UnconfiguredAccountService";
import { UnconfiguredAgentService } from "./unconfigured/UnconfiguredAgentService";
import { UnconfiguredAuthService } from "./unconfigured/UnconfiguredAuthService";
import { UnconfiguredContentAdminService } from "./unconfigured/UnconfiguredContentAdminService";
import { UnconfiguredContentService } from "./unconfigured/UnconfiguredContentService";
import { UnconfiguredLeadAdminService } from "./unconfigured/UnconfiguredLeadAdminService";
import { UnconfiguredLeadService } from "./unconfigured/UnconfiguredLeadService";
import { UnconfiguredMaslekaService } from "./unconfigured/UnconfiguredMaslekaService";
import { UnconfiguredSupportService } from "./unconfigured/UnconfiguredSupportService";
import { UnconfiguredUploadService } from "./unconfigured/UnconfiguredUploadService";
import type { Services } from "./index";
import { SupabaseAgencyService, type SupabaseAgencyClient } from "./supabase/SupabaseAgencyService";
import { SupabaseCampaignService } from "./supabase/SupabaseCampaignService";
import { SupabaseOnboardingService, type OnboardingClient } from "./supabase/SupabaseOnboardingService";
import type {
  AccountPort,
  AgencyContentPort,
  AgencyPort,
  CampaignPort,
  OnboardingPort,
  AgentPort,
  AuthPort,
  ContentAdminPort,
  ContentPort,
  LeadAdminPort,
  UsersAdminPort,
  LeadPort,
  MaslekaPort,
  SupportPort,
  UploadPort,
} from "./ports";

/**
 * Composition root — the single place that knows the concrete implementations.
 *
 * Loaded on demand by `./index.ts`, never imported eagerly: this module pulls
 * in the Supabase SDK, which an anonymous visitor reading the home page never
 * needs. See the comment at the top of index.ts.
 *
 * Everything else imports the ports. Every port is Supabase's; a build without
 * Supabase credentials gets a stand-in per port that reads empty and refuses
 * writes, so the site still starts. Swapping the backend, or a fake in a
 * test, means changing this file and nothing else.
 */

/** Table reads. The cast is narrowing, for the reason given at `authPort`. */
const tables: SupabaseLeadTableClient | null = supabase ? (supabase as unknown as SupabaseLeadTableClient) : null;

const contentPort: ContentPort = tables ? new SupabaseContentService(tables) : new UnconfiguredContentService();

/**
 * An agency's public content lives in Supabase only. Without it the read is
 * refused, and the pages show the bundled agency-1 constants they always had.
 */
const agencyContentPort: AgencyContentPort = tables
  ? new SupabaseAgencyContentService(tables)
  : {
      siteContent: () => Promise.reject(new AgencyContentError("no_site")),
      successCases: () => Promise.reject(new AgencyContentError("no_site")),
    };

const sessionToken = async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null;

/**
 * Content admin: writes go to the `content-admin` Edge Function, authenticated
 * by the Supabase session; reads come from `tables` like the public ones.
 */
const contentAdmin: ContentAdminPort =
  supabase && tables
    ? new EdgeContentAdminService(
        supabase as unknown as ContentFunctionsClient,
        new SupabaseContentAdminService(tables),
        sessionToken,
      )
    : new UnconfiguredContentAdminService();

/** The admin's leads, read and written in Supabase. */
const leadsAdminPort: LeadAdminPort = tables
  ? new SupabaseLeadAdminService(tables, supabase as unknown as ContentFunctionsClient, sessionToken)
  : new UnconfiguredLeadAdminService();

/**
 * Identity, on Supabase. A build without Supabase credentials gets a stand-in
 * that answers "nobody is signed in" instead of crashing on a null client.
 */
const authPort: AuthPort = supabase
  ? // The cast is narrowing, not widening: `SupabaseAuthClient` describes the
    // handful of calls this adapter makes, and the real client does satisfy it.
    // Matching them structurally makes tsc unfold PostgREST's generics until it
    // gives up (TS2589), so the shape is asserted once here instead of being
    // re-derived at every call.
    new SupabaseAuthService(supabase as unknown as SupabaseAuthClient)
  : new UnconfiguredAuthService();

/**
 * The accounts screen reads Supabase only: a build without it has no accounts
 * to list, so the screen shows its empty state.
 */
const usersAdminPort: UsersAdminPort = tables
  ? new SupabaseUsersAdminService(tables, supabase as unknown as ContentFunctionsClient | null, sessionToken)
  : {
      list: async () => [],
      organizations: async () => [],
      invite: async () => {
        throw new Error("אין חיבור למאגר המשתמשים.");
      },
      setRole: async () => {
        throw new Error("אין חיבור למאגר המשתמשים.");
      },
      remove: async () => {
        throw new Error("אין חיבור למאגר המשתמשים.");
      },
      leave: async () => {
        throw new Error("אין חיבור למאגר המשתמשים.");
      },
      transferOwnership: async () => {
        throw new Error("אין חיבור למאגר המשתמשים.");
      },
    };

/**
 * Who the signed-in person is in their agencies: Supabase only. Without it
 * nobody belongs to an agency, so no agency screen is offered.
 */
const agencyPort: AgencyPort = supabase
  ? new SupabaseAgencyService(supabase as unknown as SupabaseAgencyClient)
  : {
      myAgencies: async () => [],
      myRole: async () => null,
      profile: async () => null,
      updateProfile: async () => {
        throw new Error("אין חיבור למאגר.");
      },
    };

/**
 * The personal area, on Supabase — the same rule as `authPort`, so the page
 * asks the system that knows who the visitor is.
 */
const accountPort: AccountPort = supabase
  ? new SupabaseAccountService(supabase as unknown as SupabaseRpcClient)
  : new UnconfiguredAccountService();

/**
 * Public images (blog covers, testimonial photos), into the public
 * content-images bucket. Never the claim-documents bucket: it is private, and
 * an image put there would be unreadable to every visitor.
 */
const uploadPort: UploadPort = supabase
  ? new SupabaseImageUploadService(supabase as unknown as SupabaseImageStorageClient)
  : new UnconfiguredUploadService();

/** A claim's documents, into the private claim-documents bucket. */
const claimDocumentsPort: UploadPort = supabase
  ? new SupabaseUploadService(supabase as unknown as SupabaseStorageClient)
  : new UnconfiguredUploadService();

/** Leads, interviews and claims, on the `submit-lead` and `submit-claim` Edge Functions. */
const leadPort: LeadPort = supabase
  ? new SupabaseLeadService(supabase as unknown as SupabaseFunctionsClient)
  : new UnconfiguredLeadService();

/** The hand-off to a person, on the `escalate-to-human` Edge Function. */
const supportPort: SupportPort = supabase
  ? new SupabaseSupportService(supabase as unknown as SupabaseFunctionsClient)
  : new UnconfiguredSupportService();

/**
 * The clearinghouse pipeline: on Supabase only when the switch is on AND a
 * client exists. Otherwise a stand-in that is never available and never
 * touches the network, so a dark build calls no `masleka-*` function.
 */
const maslekaPort: MaslekaPort =
  MASLEKA_ENABLED && supabase
    ? new SupabaseMaslekaService(supabase as unknown as SupabaseMaslekaClient)
    : new UnconfiguredMaslekaService();

/** The on-site agents, on the `chat` Edge Function. */
const agentPort: AgentPort = supabase
  ? new SupabaseAgentService(supabase as unknown as SupabaseFunctionsClient)
  : new UnconfiguredAgentService();

/** Reactivation campaigns: Supabase only. Without it there are none, and none can be made. */
const campaignPort: CampaignPort = tables
  ? new SupabaseCampaignService(tables)
  : {
      list: async () => [],
      create: async () => {
        throw new Error("אין חיבור למאגר.");
      },
      update: async () => {
        throw new Error("אין חיבור למאגר.");
      },
    };

/** The new-agency wizard (VITE_AGENCY_ONBOARDING): Supabase only. Without it every call says so. */
const noDatabase = async (): Promise<never> => {
  throw new Error("אין חיבור למאגר.");
};
const onboardingPort: OnboardingPort = supabase
  ? new SupabaseOnboardingService(supabase as unknown as OnboardingClient)
  : {
      createAgency: noDatabase, role: async () => null, load: noDatabase, saveProfile: noDatabase, saveAgent: noDatabase,
      saveTestimonial: noDatabase, deleteTestimonial: noDatabase, saveSuccessCase: noDatabase, deleteSuccessCase: noDatabase,
      uploadPortrait: noDatabase, removePortrait: noDatabase, submit: noDatabase, listInProgress: async () => [],
      returnAgency: noDatabase, activate: noDatabase, setDpaDate: noDatabase, setLicenceVerified: noDatabase,
      setDisclosuresApproved: noDatabase, setOperatorFields: noDatabase,
    };

export const services: Services = {
  leads: leadPort,
  content: contentPort,
  agencyContent: agencyContentPort,
  agents: agentPort,
  uploads: uploadPort,
  claimDocuments: claimDocumentsPort,
  support: supportPort,
  auth: authPort,
  leadsAdmin: leadsAdminPort,
  contentAdmin,
  account: accountPort,
  usersAdmin: usersAdminPort,
  agency: agencyPort,
  campaigns: campaignPort,
  onboarding: onboardingPort,
  masleka: maslekaPort,
};
