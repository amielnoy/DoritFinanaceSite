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
import { SupabaseUploadService, type SupabaseStorageClient } from "./supabase/SupabaseUploadService";
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
  uploads: UploadPort;
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
 * Content admin, unconditionally on Supabase.
 *
 * The browser cannot write Base44 directly: its rules want a Base44 admin
 * session, and the only identity on offer now is Supabase's, which is refused
 * with 403 before the shadow write is even reached. So the writes go through a
 * backend function, which holds both credentials and needs no browser identity
 * — only proof of who is asking. Reads stay anonymous on Base44, because posts
 * and testimonials are public.
 */
const contentAdmin: ContentAdminPort = new FunctionContentAdminService(
  client as unknown as FunctionsClient,
  new Base44ContentAdminService(client),
  async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null,
);

/**
 * Identity, unconditionally on Supabase.
 */
const authPort: AuthPort =
  // The cast is narrowing, not widening: `SupabaseAuthClient` describes the
  // handful of calls this adapter makes, and the real client does satisfy it.
  // Matching them structurally makes tsc unfold PostgREST's generics until it
  // gives up (TS2589), so the shape is asserted once here instead of being
  // re-derived at every call.
  new SupabaseAuthService(supabase as unknown as SupabaseAuthClient);

/**
 * The personal area, unconditionally on Supabase — the same rule as
 * `authPort`, so the page asks the system that knows who the visitor is.
 */
const accountPort: AccountPort = new SupabaseAccountService(supabase as unknown as SupabaseRpcClient);

/**
 * Where a claim document lands, from whichever provider is switched on.
 *
 * Falls back to Base44 when Supabase is unconfigured, same reasoning as
 * `authPort`: a checkout without Supabase credentials should still accept a
 * claim's attachments.
 */
const uploadPort: UploadPort =
  UPLOAD_PROVIDER === "supabase" && supabase
    ? new SupabaseUploadService(supabase as unknown as SupabaseStorageClient)
    : new Base44UploadService(client);

export const services: Services = {
  leads: new Base44LeadService(client),
  content: new Base44ContentService(client),
  agents: new Base44AgentService(client),
  uploads: uploadPort,
  support: new Base44SupportService(client),
  auth: authPort,
  leadsAdmin: new Base44LeadAdminService(client),
  contentAdmin,
  account: accountPort,
};

export * from "./ports";
