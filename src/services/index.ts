import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { UPLOAD_PROVIDER } from "@/config/upload-provider";
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
import { SupabaseContentAdminService } from "./supabase/SupabaseContentAdminService";
import { SupabaseContentService } from "./supabase/SupabaseContentService";
import { SupabaseLeadAdminService } from "./supabase/SupabaseLeadAdminService";
import { SupabaseLeadService, type SupabaseFunctionsClient } from "./supabase/SupabaseLeadService";
import type { SupabaseLeadTableClient } from "./supabase/SupabaseTableClient";
import { SupabaseUploadService, type SupabaseStorageClient } from "./supabase/SupabaseUploadService";
import { UnconfiguredAccountService } from "./unconfigured/UnconfiguredAccountService";
import { UnconfiguredAuthService } from "./unconfigured/UnconfiguredAuthService";
import type {
  AccountPort,
  AgentPort,
  AuthPort,
  ContentAdminPort,
  ContentPort,
  LeadAdminPort,
  LeadPort,
  SupportPort,
  UploadPort,
} from "./ports";

/**
 * Composition root — the single place that knows the concrete implementations.
 *
 * Everything else imports the ports. Swapping Base44 for another backend, or a
 * fake in a test, means changing this file and nothing else.
 */
export interface Services {
  leads: LeadPort;
  content: ContentPort;
  agents: AgentPort;
  /** Public images — blog covers, testimonial photos. */
  uploads: UploadPort;
  /** A claim's documents: private, and never mixed with the public images. */
  claimDocuments: UploadPort;
  support: SupportPort;
  /** Who is signed in. Read by the route guards and the owner-only controls. */
  auth: AuthPort;
  /** Owner-only surfaces. Reachable from the same object as the public ports,
   *  as they always were — what changed is that they now go through an
   *  interface, so the admin screens can be tested against a fake and the
   *  backend behind them can be replaced without touching a component. */
  leadsAdmin: LeadAdminPort;
  contentAdmin: ContentAdminPort;
  /** The signed-in visitor's own enquiries — the personal area. */
  account: AccountPort;
}

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
const contentAdmin: ContentAdminPort = new FunctionContentAdminService(
  client as unknown as FunctionsClient,
  tables ? new SupabaseContentAdminService(tables) : new Base44ContentAdminService(client),
  async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null,
);

/** The admin's leads: read and written in Supabase when it is configured, else through Base44 as before. */
const leadsAdminPort: LeadAdminPort = tables
  ? new SupabaseLeadAdminService(tables, supabase as unknown as SupabaseStorageClient | null)
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
const accountPort: AccountPort = supabase
  ? new SupabaseAccountService(supabase as unknown as SupabaseRpcClient)
  : new UnconfiguredAccountService();

/**
 * Public images (blog covers, testimonial photos) stay on Base44: the only
 * Supabase bucket is the private claim-documents one, and an image put there
 * would be unreadable to every visitor.
 */
const uploadPort: UploadPort = new Base44UploadService(client);

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
 * Every other lead path still runs on Base44's functions, which hold the
 * calendar and Sheets connections, so it is passed through untouched.
 */
const base44Leads = new Base44LeadService(client);
const leadPort: LeadPort = supabase
  ? new SupabaseLeadService(supabase as unknown as SupabaseFunctionsClient, base44Leads)
  : base44Leads;

export const services: Services = {
  leads: leadPort,
  content: contentPort,
  agents: new Base44AgentService(client),
  uploads: uploadPort,
  claimDocuments: claimDocumentsPort,
  support: new Base44SupportService(client),
  auth: authPort,
  leadsAdmin: leadsAdminPort,
  contentAdmin,
  account: accountPort,
};

export * from "./ports";
