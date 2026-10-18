import { vi, type Mock } from "vitest";
import type { Services } from "@/services";
import { FALLBACK_CONTACT } from "@/services/fallback-contact";
import {
  AccountLoadError,
  MaslekaError,
  type AccountPort,
  type AgencyPort,
  type AgentPort,
  type AuthPort,
  type ContentAdminPort,
  type ContentPort,
  type LeadAdminPort,
  type LeadPort,
  type MaslekaPort,
  type SupportPort,
  type UploadPort,
  type UsersAdminPort,
} from "@/services/ports";

/**
 * A stand-in for `services` from `@/services`, at the ports. Component tests
 * never touch the network and never reach a backend's adapter: they script
 * what a port answers and assert on what the component asked of it.
 *
 *   import { servicesMock } from "./services-mock";
 *   vi.mock("@/services", async (importOriginal) => (await import("./services-mock")).servicesModule(importOriginal));
 *
 * Every method is a `vi.fn`. Unscripted, each answers what a build without
 * Supabase answers — nobody signed in, no agency, the clearinghouse
 * unavailable — and the public writes succeed, so a component that reaches a
 * port its test does not script behaves as it does on that build.
 */

/** A port's methods, each a `vi.fn` with the port's own signature. */
type Methods<P> = { [K in keyof P as P[K] extends (...args: never[]) => unknown ? K : never]-?: P[K] };
type MockedPort<P> = { [K in keyof Methods<P>]: Methods<P>[K] extends (...args: any[]) => any ? Mock<Methods<P>[K]> : never };

function port<P>(impl: Methods<P>): MockedPort<P> {
  return Object.fromEntries(
    Object.entries(impl).map(([name, fn]) => [name, vi.fn(fn as (...args: unknown[]) => unknown)]),
  ) as MockedPort<P>;
}

const signedOut = async (): Promise<never> => {
  throw new AccountLoadError("signed_out");
};
const unavailable = async (): Promise<never> => {
  throw new MaslekaError("unavailable");
};
const noUserStore = async (): Promise<never> => {
  throw new Error("אין חיבור למאגר המשתמשים.");
};

export const servicesMock = {
  leads: port<LeadPort>({
    submitLead: async () => ({ ok: true }),
    submitClaim: async () => ({ ok: true }),
    requestConsultationEvent: async () => {},
    submitInterview: async () => ({ ok: true }),
  }),
  content: port<ContentPort>({
    listArticles: async () => [],
    getArticle: async (id) => {
      throw new Error(`no article ${id}`);
    },
    listTestimonials: async () => [],
  }),
  agents: port<AgentPort>({
    start: async () => ({ id: "conv_1" }),
    send: async () => {},
    subscribe: () => () => {},
  }),
  uploads: port<UploadPort>({ upload: async () => ({ url: "https://example.test/f.png" }) }),
  claimDocuments: port<UploadPort>({ upload: async () => ({ url: "https://example.test/f.png" }) }),
  support: port<SupportPort>({
    escalate: async () => ({ ok: true, recorded: true, contact: FALLBACK_CONTACT, acknowledgement: "דורית תחזור אליך." }),
  }),
  auth: port<AuthPort>({
    hasStoredToken: () => false,
    getPublicSettings: async () => ({}),
    me: async () => {
      throw Object.assign(new Error("Authentication is not configured"), { status: 403, data: { extra_data: { reason: "auth_required" } } });
    },
    logout: () => {},
    redirectToLogin: () => {},
    signInWithGoogle: async () => {},
    signInWithPassword: async () => {},
  }),
  leadsAdmin: port<LeadAdminPort>({
    list: async () => [],
    setStatus: async () => {},
    remove: async () => {},
    documentLink: async (ref) => ref,
    assign: async () => ({ mailed: false }),
    countUnassigned: async () => 0,
    transcript: async () => [],
    transcriptLeadIds: async () => [],
    countNew: async () => 0,
    meetings: async () => [],
    addMeeting: async () => {},
    updateMeeting: async () => {},
    handleMeetingRequest: async () => {},
  }),
  contentAdmin: port<ContentAdminPort>({
    listArticles: async () => [],
    createArticle: async () => "article-1",
    updateArticle: async () => {},
    removeArticle: async () => {},
    listTestimonials: async () => [],
    createTestimonial: async () => "t-1",
    removeTestimonial: async () => {},
  }),
  account: port<AccountPort>({
    myEnquiries: signedOut,
    mySnapshot: signedOut,
    respondToRecommendation: signedOut,
    myMeetings: signedOut,
    requestMeetingChange: signedOut,
  }),
  usersAdmin: port<UsersAdminPort>({
    list: async () => [],
    organizations: async () => [],
    invite: noUserStore,
    setRole: noUserStore,
    remove: noUserStore,
    leave: noUserStore,
    transferOwnership: noUserStore,
  }),
  agency: port<AgencyPort>({
    myAgencies: async () => [],
    myRole: async () => null,
    profile: async () => null,
    updateProfile: async () => {
      throw new Error("אין חיבור למאגר.");
    },
  }),
  masleka: port<MaslekaPort>({
    submitCode: unavailable,
    list: unavailable,
    create: unavailable,
    relink: unavailable,
    reissue: unavailable,
    reveal: unavailable,
    markSubmitted: unavailable,
    listSnapshots: unavailable,
    getSnapshot: unavailable,
    listReviews: unavailable,
    decide: unavailable,
    listPublishedItems: unavailable,
    publish: unavailable,
    unpublish: unavailable,
    markAnswersSeen: unavailable,
  }),
} satisfies Services;

/** The `vi.mock("@/services", …)` factory: the module as it is, with `services` swapped for `servicesMock`. */
export async function servicesModule(importOriginal: <T>() => Promise<T>) {
  return { ...(await importOriginal<typeof import("@/services")>()), services: servicesMock };
}

/**
 * Back to the answers above. The config's `clearMocks` empties the recorded
 * calls before each case; this also drops a `mockResolvedValue` a case set, so
 * one case's script cannot leak into the next.
 */
export function resetServicesMock(): void {
  for (const methods of Object.values(servicesMock)) {
    for (const method of Object.values(methods) as Mock[]) method.mockReset();
  }
}
