import type { EscalationRequest, InterviewSummary, Lead } from "./ports";

/**
 * The request bodies the lead functions take, built in one place so the
 * adapter and its tests agree on what is sent.
 */

export function leadBody(lead: Lead): Record<string, unknown> {
  return {
    name: lead.name,
    phone: lead.phone,
    email: lead.email ?? "",
    source: lead.source,
    topic: lead.topic ?? "",
    timing: lead.timing ?? "",
    message: lead.message ?? "",
    notes: lead.notes ?? "",
    scheduledAt: lead.scheduledAt ?? "",
    channel: lead.channel ?? "",
    campaign: lead.campaign ?? "",
    landingPath: lead.landingPath ?? "",
  };
}

export function interviewBody(summary: InterviewSummary): Record<string, unknown> {
  return {
    source: "interview",
    stage: summary.stage ?? "complete",
    name: summary.name,
    phone: summary.phone,
    email: summary.email ?? "",
    track: summary.track ?? "",
    meetingTopic: summary.meetingTopic ?? "",
    timing: summary.timing ?? "",
    notes: summary.notes ?? "",
    scheduledAt: summary.scheduledAt ?? "",
    summary: summary.summary ?? "",
    profile: summary.profile ?? {},
    channel: summary.channel ?? "",
    campaign: summary.campaign ?? "",
    landingPath: summary.landingPath ?? "",
    conversationRef: summary.conversationRef ?? "",
  };
}

export function escalationBody(request: EscalationRequest): Record<string, unknown> {
  return {
    reason: request.reason,
    summary: request.summary,
    agent: request.agent ?? "",
    name: request.name ?? "",
    phone: request.phone ?? "",
    email: request.email ?? "",
    topic: "",
    consentVersion: request.consentVersion ?? "",
    consentAt: request.consentAt ?? "",
    channel: request.channel ?? "",
    campaign: request.campaign ?? "",
    landingPath: request.landingPath ?? "",
  };
}
