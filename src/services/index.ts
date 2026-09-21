import { base44 } from "@/api/base44Client";
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
 * The dual-write decorator is deliberately NOT installed yet, and the reason is
 * worth writing down because everything else is ready.
 *
 * The browser holds an anonymous Supabase client — identity still belongs to
 * Base44 until the auth half of this migration lands — while writing a post or
 * a testimonial requires `is_admin()` under row-level security. So every shadow
 * write is refused with 42501, verified against a real database rather than
 * assumed. Wiring it anyway would "work": Base44 still takes the write, the
 * visitor sees success, and a warning is logged where nobody reads it, while
 * Supabase quietly receives nothing at all. A migration that looks finished and
 * has copied no data is worse than one that is obviously unstarted.
 *
 * Two ways out, both real work and neither yet chosen: route these writes
 * through a backend function holding the service key, or move auth first so the
 * browser carries a Supabase session that `is_admin()` can recognise. Until
 * then this stays exactly what it was.
 *
 * The decorator and the Supabase adapter are finished and tested, and the
 * translation they perform is proven against Postgres. Only the credential the
 * browser can offer is missing.
 */
export const services: Services = {
  leads: new Base44LeadService(client),
  content: new Base44ContentService(client),
  agents: new Base44AgentService(client),
  uploads: new Base44UploadService(client),
  support: new Base44SupportService(client),
  auth: new Base44AuthService(client, () => !!appParams.token),
  leadsAdmin: new Base44LeadAdminService(client),
  contentAdmin: new Base44ContentAdminService(client),
};

export * from "./ports";
