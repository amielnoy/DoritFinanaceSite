import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { services } from "@/services";
import type { Article, ArticleDraft, LeadRecord, LeadStatus, TestimonialDraft } from "@/services";

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
};

export function useLeads() {
  return useQuery<LeadRecord[]>({
    queryKey: adminKeys.leads,
    queryFn: () => services.leadsAdmin.list(),
  });
}

export function useSetLeadStatus() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStatus }) =>
      services.leadsAdmin.setStatus(id, status),
    onSuccess: () => client.invalidateQueries({ queryKey: adminKeys.leads }),
  });
}

export function useRemoveLead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => services.leadsAdmin.remove(id),
    onSuccess: () => client.invalidateQueries({ queryKey: adminKeys.leads }),
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
    mutationFn: ({ id, draft }: { id?: string; draft: ArticleDraft }) =>
      id ? services.contentAdmin.updateArticle(id, draft) : services.contentAdmin.createArticle(draft),
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
