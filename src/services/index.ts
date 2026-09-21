import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { AUTH_PROVIDER } from "@/config/auth-provider";
import { DualWriteContentAdminService } from "./dual/DualWriteContentAdminService";
import { SupabaseContentAdminService } from "./supabase/SupabaseContentAdminService";
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
 * Base44 stays authoritative; Supabase is written alongside it and keyed on
 * `base44_id`, because the ids handed to the shadow are Base44's and mean
 * nothing to Postgres. Both of those swap together at the flip.
 *
 * The auth condition is not belt-and-braces. Writing a post or a testimonial
 * requires `is_admin()`, which needs a Supabase session — with Base44 still
 * answering "who is signed in", the browser's client is anonymous and every
 * shadow write is refused with 42501. Installing the decorator then would look
 * like success and copy nothing: Base44 takes the write, the visitor is told it
 * worked, and a warning lands where nobody reads it. So the shadow goes in only
 * once there is an identity behind it.
 */
const contentAdmin: ContentAdminPort = (() => {
  const base44Admin = new Base44ContentAdminService(client);
  if (!supabase || AUTH_PROVIDER !== "supabase") return base44Admin;

  return new DualWriteContentAdminService(
    base44Admin,
    new SupabaseContentAdminService(supabase, "base44_id"),
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
