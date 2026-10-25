import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/services";
import type { Article, ArticleDraft, LeadMeetingUpdate, LeadRecord, LeadStatus, NewLeadMeeting, TestimonialDraft } from "@/services";

/**
 * The admin screens' data idiom, matching `useContent.ts` for the public site.
 *
 * `Leads` and `BlogAdmin` were the last two pages still hand-rolling
 * `load()` + `useEffect` + a `loading` flag, each with its own error handling
 * (none) and its own optimistic bookkeeping. React Query was mounted at the
 * root the whole time. Going through it here means a mutation invalidates the
 * list instead of patching a local copy, a failed write is reported rather
 * than swallowed, and the admin screens are tested the same way as the rest.
 *
 * Keys are namespaced under "admin" so nothing here can collide with — or be
 * served from — the public content cache, which must never hold a draft.
 */
export const adminKeys = {
  leads: ["admin", "leads"] as const,
  articles: ["admin", "articles"] as const,
  transcriptLeadIds: ["admin", "lead-transcript-ids"] as const,
};

export function useLeads() {
  return useQuery<LeadRecord[]>({
    queryKey: adminKeys.leads,
    queryFn: () => services.leadsAdmin.list(),
  });
}

/** The leads that have a conversation behind them. Empty while loading or if the read fails: no tab rather than a wrong one. */
export function useTranscriptLeadIds() {
  return useQuery<string[]>({
    queryKey: adminKeys.transcriptLeadIds,
    queryFn: () => services.leadsAdmin.transcriptLeadIds(),
  });
}

export function useLeadTranscript(leadId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "lead-transcript", leadId],
    queryFn: () => services.leadsAdmin.transcript(leadId),
    enabled,
  });
}

/** A lead's meetings — the drawer's "פגישות" tab. Its count shows on the tab, so it loads with the drawer. */
export const leadMeetingsKey = (leadId: string) => ["admin", "lead-meetings", leadId] as const;

export function useLeadMeetings(leadId: string, enabled = true) {
  return useQuery({
    queryKey: leadMeetingsKey(leadId),
    queryFn: () => services.leadsAdmin.meetings(leadId),
    enabled,
  });
}

/**
 * The agency's agenda — the "פגישות" tab of /admin/leads, its counts and the
 * leads table's "הפגישה הבאה". One read for all three.
 */
export const agendaKeys = {
  all: ["admin", "meetings-agenda"] as const,
  agency: (agencyId: string) => ["admin", "meetings-agenda", agencyId] as const,
};

export function useAgencyMeetings(agencyId: string, enabled = true) {
  return useQuery({
    queryKey: agendaKeys.agency(agencyId),
    queryFn: () => services.leadsAdmin.agencyMeetings(agencyId),
    enabled,
  });
}

/**
 * Every meeting write reloads that lead's meetings and the agenda, and nothing
 * else — so a change made in the drawer shows on the agenda behind it.
 */
function useMeetingWrite<T>(leadId: string, write: (input: T) => Promise<void>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: leadMeetingsKey(leadId) }),
        client.invalidateQueries({ queryKey: agendaKeys.all }),
      ]),
  });
}

export const useAddMeeting = (leadId: string) =>
  useMeetingWrite(leadId, (meeting: NewLeadMeeting) => services.leadsAdmin.addMeeting(meeting));

export const useUpdateMeeting = (leadId: string) =>
  useMeetingWrite(leadId, ({ id, update }: { id: string; update: LeadMeetingUpdate }) => services.leadsAdmin.updateMeeting(id, update));

export const useHandleMeetingRequest = (leadId: string) =>
  useMeetingWrite(leadId, (requestId: string) => services.leadsAdmin.handleMeetingRequest(requestId));

export function useSetLeadStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStatus }) =>
      services.leadsAdmin.setStatus(id, status),
    onSuccess: () => client.invalidateQueries({ queryKey: adminKeys.leads }),
  });
}

/**
 * Give a lead to a member, or back to the queue (null) — Admin+, through
 * assign-lead. The leads and every leads counter (they share the prefix) reload.
 */
export function useAssignLead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string | null }) => services.leadsAdmin.assign(id, userId),
    // The agenda shows each meeting's assignee, so it reloads too.
    onSuccess: () =>
      Promise.all([client.invalidateQueries({ queryKey: adminKeys.leads }), client.invalidateQueries({ queryKey: agendaKeys.all })]),
  });
}

/** The accounts and their agencies, as the users screen reads them — also the assignee list. */
export function useAdminUsers(enabled = true) {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => services.usersAdmin.list(),
    enabled,
  });
}

/** "לא כפילות": clears a lead's possible-duplicate flag (Admin+). */
export function useClearDuplicate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => services.leadsAdmin.clearDuplicate(id),
    onSuccess: () => client.invalidateQueries({ queryKey: adminKeys.leads }),
  });
}

/** "מזג": folds a group of leads into one (Admin+). Nothing is deleted. */
export function useMergeLeads() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ primaryId, otherIds }: { primaryId: string; otherIds: string[] }) => services.leadsAdmin.mergeLeads(primaryId, otherIds),
    onSuccess: () => client.invalidateQueries({ queryKey: adminKeys.leads }),
  });
}

/** "ביטול מיזוג": takes one merged lead out again (Admin+). */
export function useUnmergeLead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => services.leadsAdmin.unmergeLead(id),
    onSuccess: () => client.invalidateQueries({ queryKey: adminKeys.leads }),
  });
}

export function useRemoveLead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => services.leadsAdmin.remove(id),
    // Deleting a lead deletes its meetings (on delete cascade): the agenda reloads too.
    onSuccess: () =>
      Promise.all([client.invalidateQueries({ queryKey: adminKeys.leads }), client.invalidateQueries({ queryKey: agendaKeys.all })]),
  });
}

/** Every article, drafts included — the admin list, never the public one. */
export function useAdminArticles() {
  return useQuery<Article[]>({
    queryKey: adminKeys.articles,
    queryFn: () => services.contentAdmin.listArticles(),
  });
}

export function useSaveArticle() {
  const client = useQueryClient();
  return useMutation({
    // `createArticle` returns the new id now (dual-write correlates on it) while
    // `updateArticle` returns nothing. Neither is used here, so the branches are
    // flattened to void rather than making every caller handle a union.
    mutationFn: async ({ id, draft }: { id?: string; draft: ArticleDraft }): Promise<void> => {
      if (id) return services.contentAdmin.updateArticle(id, draft);
      await services.contentAdmin.createArticle(draft);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: adminKeys.articles });
      // A publish or unpublish changes what the public blog shows too.
      client.invalidateQueries({ queryKey: ["articles"] });
    },
  });
}

export function useSetArticlePublished() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) =>
      services.contentAdmin.updateArticle(id, { published }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: adminKeys.articles });
      client.invalidateQueries({ queryKey: ["articles"] });
    },
  });
}

export function useRemoveArticle() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => services.contentAdmin.removeArticle(id),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: adminKeys.articles });
      client.invalidateQueries({ queryKey: ["articles"] });
    },
  });
}

/* Testimonials are public content with an owner-only write path, so the
   mutations invalidate the public `["testimonials"]` cache from useContent. */
export function useCreateTestimonial() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draft: TestimonialDraft) => services.contentAdmin.createTestimonial(draft),
    onSuccess: () => client.invalidateQueries({ queryKey: ["testimonials"] }),
  });
}

export function useRemoveTestimonial() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => services.contentAdmin.removeTestimonial(id),
    onSuccess: () => client.invalidateQueries({ queryKey: ["testimonials"] }),
  });
}
