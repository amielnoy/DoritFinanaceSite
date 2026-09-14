import { base44 } from "@/api/base44Client";
import { Base44AgentService } from "./base44/Base44AgentService";
import { Base44ContentAdminService } from "./base44/Base44ContentAdminService";
import { Base44ContentService } from "./base44/Base44ContentService";
import { Base44LeadAdminService } from "./base44/Base44LeadAdminService";
import { Base44LeadService } from "./base44/Base44LeadService";
import { Base44SupportService } from "./base44/Base44SupportService";
import { Base44UploadService } from "./base44/Base44UploadService";
import type {
  AgentPort,
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
  /** Owner-only surfaces. Reachable from the same object as the public ports,
   *  as they always were — what changed is that they now go through an
   *  interface, so the admin screens can be tested against a fake and the
   *  backend behind them can be replaced without touching a component. */
  leadsAdmin: LeadAdminPort;
  contentAdmin: ContentAdminPort;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = base44 as any;

export const services: Services = {
  leads: new Base44LeadService(client),
  content: new Base44ContentService(client),
  agents: new Base44AgentService(client),
  uploads: new Base44UploadService(client),
  support: new Base44SupportService(client),
  leadsAdmin: new Base44LeadAdminService(client),
  contentAdmin: new Base44ContentAdminService(client),
};

export * from "./ports";
