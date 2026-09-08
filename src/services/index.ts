import { base44 } from "@/api/base44Client";
import { Base44AgentService } from "./base44/Base44AgentService";
import { Base44ContentService } from "./base44/Base44ContentService";
import { Base44LeadService } from "./base44/Base44LeadService";
import { Base44UploadService } from "./base44/Base44UploadService";
import type { AgentPort, ContentPort, LeadPort, UploadPort } from "./ports";

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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = base44 as any;

export const services: Services = {
  leads: new Base44LeadService(client),
  content: new Base44ContentService(client),
  agents: new Base44AgentService(client),
  uploads: new Base44UploadService(client),
};

export * from "./ports";
