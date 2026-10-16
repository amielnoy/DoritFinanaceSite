import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { CHAT_AGENTS } from "@/config/chat-agents";
import { CONTENT_WRITES } from "@/config/content-writes";
import { LEAD_FUNCTIONS } from "@/config/lead-functions";
import { MASLEKA_ENABLED } from "@/config/masleka";
import { CONTENT_IMAGES, UPLOAD_PROVIDER } from "@/config/upload-provider";
import { FunctionContentAdminService, type FunctionsClient } from "./base44/FunctionContentAdminService";
import { SupabaseAccountService, type SupabaseRpcClient } from "./supabase/SupabaseAccountService";
import { SupabaseAuthService, type SupabaseAuthClient } from "./supabase/SupabaseAuthService";
import { Base44AgentService } from "./base44/Base44AgentService";
import { Base44ContentAdminService } from "./base44/Base44ContentAdminService";
import { Base44ContentService } from "./base44/Base44ContentService";
import { Base44LeadAdminService } from "./base44/Base44LeadAdminService";
import { Base44LeadService } from "./base44/Base44LeadService";
import { Base44SupportService } from "./base44/Base44SupportService";
import { Base44UploadService } from "./base44/Base44UploadService";
import { SupabaseAgentService } from "./supabase/SupabaseAgentService";
import { SupabaseContentAdminService } from "./supabase/SupabaseContentAdminService";
import { SupabaseContentService } from "./supabase/SupabaseContentService";
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
import { UnconfiguredAuthService } from "./unconfigured/UnconfiguredAuthService";
import { UnconfiguredMaslekaService } from "./unconfigured/UnconfiguredMaslekaService";
import { RoutedAgentService } from "./RoutedAgentService";
import type { Services } from "./index";
import { SupabaseAgencyService, type SupabaseAgencyClient } from "./supabase/SupabaseAgencyService";
import type {
  AccountPort,
  AgencyPort,
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
 * in both SDKs (~100 KB gzipped), which an anonymous visitor reading the home
 * page never needs. See the comment at the top of index.ts.
 *
 * Everything else imports the ports. Swapping Base44 for another backend, or a
 * fake in a test, means changing this file and nothing else.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = base44 as any;

/**
 * Table reads, on Supabase when it is configured.
 *
 * Every write already mirrors into these tables, so the data is there and
 * current. A build without Supabase reads Base44 as before. Content and leads
 * are data, not identity, so a missing client means "the old path", not
 * "broken", unlike `authPort` below.
 */
const tables: SupabaseLeadTableClient | null = supabase ? (supabase as unknown as SupabaseLeadTableClient) : null;

const contentPort: ContentPort = tables ? new SupabaseContentService(tables) : new Base44ContentService(client);

/**
 * Content admin: writes go through a backend function authenticated by the
 * Supabase session; reads come from `tables` like the public ones.
 *
 * The browser cannot write Base44 directly: its rules want a Base44 admin
 * session, and the only identity on offer now is Supabase's, which is refused
 * with 403 before the shadow write is even reached. So the writes go through a
 * backend function, which holds both credentials and needs no browser identity
 * — only proof of who is asking.
 */
const adminReads: ContentAdminPort = tables ? new SupabaseContentAdminService(tables) : new Base44ContentAdminService(client);
const sessionToken = async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null;

/**
 * …and with `VITE_CONTENT_WRITES=supabase`, the writes go to the `content-admin`
 * Edge Function instead, Supabase only — see src/config/content-writes.ts for
 * why that waits for Phase 3.
 */
const contentAdmin: ContentAdminPort =
  CONTENT_WRITES === "supabase" && supabase
    ? new EdgeContentAdminService(supabase as unknown as ContentFunctionsClient, adminReads, sessionToken)
    : new FunctionContentAdminService(client as unknown as FunctionsClient, adminReads, sessionToken);

/** The admin's leads: read and written in Supabase when it is configured, else through Base44 as before. */
const leadsAdminPort: LeadAdminPort = tables
  ? new SupabaseLeadAdminService(tables, supabase as unknown as ContentFunctionsClient | null, sessionToken)
  : new Base44LeadAdminService(client);

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
 * The personal area, on Supabase — the same rule as `authPort`, so the page
 * asks the system that knows who the visitor is.
 */
/**
 * The accounts screen reads Supabase only: a build without it has no accounts
 * to list (Base44 never kept them), so the screen shows its empty state.
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

const accountPort: AccountPort = supabase
  ? new SupabaseAccountService(supabase as unknown as SupabaseRpcClient)
  : new UnconfiguredAccountService();

/**
 * Public images (blog covers, testimonial photos), into the public
 * content-images bucket when `VITE_CONTENT_IMAGES=supabase`, else Base44.
 * Never the claim-documents bucket: it is private, and an image put there
 * would be unreadable to every visitor.
 */
const uploadPort: UploadPort =
  CONTENT_IMAGES === "supabase" && supabase
    ? new SupabaseImageUploadService(supabase as unknown as SupabaseImageStorageClient)
    : new Base44UploadService(client);

/**
 * Where a claim document lands, from whichever provider is switched on.
 *
 * Falls back to Base44 when Supabase is unconfigured — a checkout without
 * Supabase credentials should still accept a claim's attachments.
 */
const claimDocumentsPort: UploadPort =
  UPLOAD_PROVIDER === "supabase" && supabase
    ? new SupabaseUploadService(supabase as unknown as SupabaseStorageClient)
    : new Base44UploadService(client);

/**
 * Claims go to the `submit-claim` Edge Function when Supabase is configured.
 * Leads, interviews and hand-offs follow `VITE_LEAD_FUNCTIONS`: Base44's
 * functions by default, the Supabase Edge Functions once it says "supabase".
 */
const base44Leads = new Base44LeadService(client);
const leadPort: LeadPort = supabase
  ? new SupabaseLeadService(supabase as unknown as SupabaseFunctionsClient, base44Leads, LEAD_FUNCTIONS === "supabase")
  : base44Leads;

const base44Support = new Base44SupportService(client);
const supportPort: SupportPort =
  supabase && LEAD_FUNCTIONS === "supabase"
    ? new SupabaseSupportService(supabase as unknown as SupabaseFunctionsClient)
    : base44Support;

/**
 * The clearinghouse pipeline: on Supabase only when the switch is on AND a
 * client exists. Otherwise a stand-in that is never available and never
 * touches the network, so a dark build calls no `masleka-*` function.
 */
const maslekaPort: MaslekaPort =
  MASLEKA_ENABLED && supabase
    ? new SupabaseMaslekaService(supabase as unknown as SupabaseMaslekaClient)
    : new UnconfiguredMaslekaService();

/**
 * The on-site agents: the `chat` Edge Function for those named in
 * `VITE_CHAT_AGENTS` (empty by default), Base44 for the rest.
 */
const agentPort: AgentPort = new RoutedAgentService(
  new Base44AgentService(client),
  supabase ? new SupabaseAgentService(supabase as unknown as SupabaseFunctionsClient) : null,
  CHAT_AGENTS,
);

export const services: Services = {
  leads: leadPort,
  content: contentPort,
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
  masleka: maslekaPort,
};

