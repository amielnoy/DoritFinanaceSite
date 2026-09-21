import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { AUTH_PROVIDER } from "@/config/auth-provider";
import { FunctionContentAdminService, type FunctionsClient } from "./base44/FunctionContentAdminService";
import { SupabaseAuthService, type SupabaseAuthClient } from "./supabase/SupabaseAuthService";
import { appParams } from "@/lib/app-params";
import { Base44AgentService } from "./base44/Base44AgentService";
import { Base44AuthService } from "./base44/Base44AuthService";
import { Base44ContentAdminService } from "./base44/Base44ContentAdminService";
import { Base44ContentService } from "./base44/Base44ContentService";
import { Base44LeadAdminService } from "./base44/Base44LeadAdminService";
import { Base44LeadService } from "./base44/Base44LeadService";
import { Base44SupportService } from "./base44/Base44SupportService";
import { Base44UploadService } from "./base44/Base44UploadService";
import type {
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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = base44 as any;

/**
 * Content admin, during the migration.
 *
 * With Base44 answering "who is signed in", the browser writes Base44 directly,
 * exactly as it always has, and Supabase is left alone — an anonymous client
 * cannot satisfy `is_admin()` and every shadow write would be refused.
 *
 * With Supabase answering, the browser cannot write Base44 either: its rules
 * want a Base44 admin session and a Supabase one is refused with 403, before
 * the shadow write is even reached. So the writes move to a backend function,
 * which holds both credentials and needs no browser identity — only proof of
 * who is asking. Reads stay anonymous on Base44 either way, because posts and
 * testimonials are public.
 */
const contentAdmin: ContentAdminPort = (() => {
  const base44Admin = new Base44ContentAdminService(client);
  if (AUTH_PROVIDER !== "supabase") return base44Admin;

  return new FunctionContentAdminService(
    client as unknown as FunctionsClient,
    base44Admin,
    async () => (await supabase?.auth.getSession())?.data.session?.access_token ?? null,
  );
})();

/**
 * Identity, from whichever provider is switched on.
 *
 * Falls back to Base44 when Supabase is unconfigured rather than throwing: a
 * checkout without Supabase credentials should still sign people in, and an
 * auth provider that fails to construct takes the whole app with it.
 */
const authPort: AuthPort =
  AUTH_PROVIDER === "supabase" && supabase
    // The cast is narrowing, not widening: `SupabaseAuthClient` describes the
    // handful of calls this adapter makes, and the real client does satisfy it.
    // Matching them structurally makes tsc unfold PostgREST's generics until it
    // gives up (TS2589), so the shape is asserted once here instead of being
    // re-derived at every call.
    ? new SupabaseAuthService(supabase as unknown as SupabaseAuthClient)
    : new Base44AuthService(client, () => !!appParams.token);

export const services: Services = {
  leads: new Base44LeadService(client),
  content: new Base44ContentService(client),
  agents: new Base44AgentService(client),
  uploads: new Base44UploadService(client),
  support: new Base44SupportService(client),
  auth: authPort,
  leadsAdmin: new Base44LeadAdminService(client),
  contentAdmin,
};

export * from "./ports";
